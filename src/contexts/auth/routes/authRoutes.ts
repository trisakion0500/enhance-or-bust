import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { Router } from "express";
import { completeRegistration, loginWithGoogleIdToken, loginWithSocialProvider, type LoginResult } from "../application/authService.js";
import { deleteSession, resolveSession } from "../infrastructure/sessionStore.js";
import { writeAuditLog } from "../../../shared-kernel/auditLog.js";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { readCookie } from "../../../shared-kernel/cookies.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { logger } from "../../../infra/logger.js";
import { config } from "../../../config/env.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import { googleAuthCodeProvider } from "../infrastructure/googleAuth.js";
import { facebookAuthProvider } from "../infrastructure/facebookAuth.js";
import type { SocialAuthProvider } from "../infrastructure/socialAuthProvider.js";
import { resolvePendingRegistration } from "../infrastructure/pendingRegistrationStore.js";

/** 세션 토큰을 담는 쿠키 이름. */
export const SESSION_COOKIE_NAME = "sessionToken";

/** Authorization Code Flow CSRF 방지용 state를 담는 임시 쿠키 이름. */
const OAUTH_STATE_COOKIE_NAME = "oauthState";

/** 신규 가입 보류 토큰을 담는 임시 쿠키 이름 — 닉네임 입력을 기다리는 동안만 쓰인다. */
const PENDING_REGISTRATION_COOKIE_NAME = "pendingRegistrationToken";

/** 가입 보류 쿠키 유효 시간(ms) — `pendingRegistrationStore.ts`의 Redis TTL(10분)과 맞춘다. */
const PENDING_REGISTRATION_COOKIE_MAX_AGE = 10 * 60 * 1000;

/** 로컬 http 개발 환경에선 secure 쿠키가 저장되지 않아 배포(HTTPS) 환경에서만 켠다. */
const isSecureCookie = process.env.NODE_ENV === "production";

/**
 * 인증 라우터. 프론트가 로그인 UI 초기화에 쓸 설정 조회(`GET /auth/config`)와, `config.googleAuthFlow`에
 * 따라 Google Identity Services(`POST /auth/google`) 또는 Authorization Code Flow
 * (`GET /auth/google/login` + `GET /auth/google/callback`) 중 하나의 구글 로그인 경로, 그리고
 * `POST /auth/logout`(세션 무효화 + 쿠키 삭제)을 제공한다. 나머지 리다이렉트 기반 프로바이더
 * (페이스북, 향후 네이버 등)는 `socialProviders` 레지스트리에 `SocialAuthProvider` 구현체만
 * 추가하면 `GET /auth/:platformType/login`/`GET /auth/:platformType/callback`이 자동으로
 * 등록된다 — 새 프로바이더 추가 시 이 라우터 자체를 더 손댈 필요가 없다.
 * @param playerRepository Player 영속성 포트(DI)
 * @returns 등록된 Express Router
 * @author trisakion
 */
export function createAuthRoutes(playerRepository: PlayerRepository): Router {
  const router = Router();

  // 구글 client ID는 프론트 GIS 초기화에 그대로 노출되는 공개값이라(비밀값 아님) 여기서 내려줘도 안전하다.
  router.get("/auth/config", (_req, res) => {
    res.json({ googleClientId: config.googleClientId, authFlow: config.googleAuthFlow });
  });

  function issueSessionCookie(res: Response, sessionToken: string) {
    res.cookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: config.sessionTtlSec * 1000,
      secure: isSecureCookie,
    });
  }

  function issuePendingRegistrationCookie(res: Response, token: string) {
    res.cookie(PENDING_REGISTRATION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: PENDING_REGISTRATION_COOKIE_MAX_AGE,
      secure: isSecureCookie,
    });
  }

  /**
   * 구글/페이스북 Authorization Code Flow 콜백 공통 처리 — state 검증, 로그인 함수 호출까지
   * 두 프로바이더가 동일해 이 헬퍼 하나로 합친다. 브라우저 최상위 탐색(주소 이동)으로 오는
   * 요청이라 실패 시 `errorHandler`의 날것 JSON 응답 대신 로그인 화면으로 리다이렉트한다
   * (사용자가 JSON을 볼 이유가 없음) — 실패 원인은 여기서 직접 로깅해 디버깅 가시성을 유지한다.
   * 신규 가입자는 세션 대신 가입 보류 쿠키를 발급하고 `/?register=1`로 보내 닉네임 입력을 받는다.
   * @param req Express 요청(콜백 쿼리 `code`/`state`)
   * @param res Express 응답
   * @param login 검증된 code를 받아 로그인을 시도하는 함수(프로바이더별 구현)
   */
  async function handleOAuthCallback(req: Request, res: Response, login: (code: string) => Promise<LoginResult>): Promise<void> {
    const { code, state } = req.query;
    const expectedState = readCookie(req.headers.cookie, OAUTH_STATE_COOKIE_NAME);
    res.clearCookie(OAUTH_STATE_COOKIE_NAME);

    if (typeof code !== "string" || !code || typeof state !== "string" || !expectedState || state !== expectedState) {
      logger.info(`[${res.locals.requestId}] OAuth 콜백 state 검증 실패, 로그인 화면으로 리다이렉트`);
      res.redirect("/?loginError=1");
      return;
    }

    try {
      const result = await login(code);
      if (result.status === "pending") {
        issuePendingRegistrationCookie(res, result.token);
        res.redirect("/?register=1");
        return;
      }
      issueSessionCookie(res, result.sessionToken);
      res.redirect("/");
    } catch (err) {
      logger.info(`[${res.locals.requestId}] OAuth 로그인 실패, 로그인 화면으로 리다이렉트`, err instanceof BusinessException ? err.entry : err);
      res.redirect("/?loginError=1");
    }
  }

  // 세션 쿠키가 없거나 이미 만료된 토큰이어도 그냥 성공으로 처리한다(로그아웃은 멱등해야 함 —
  // 두 번 눌러도, 이미 만료된 뒤에 눌러도 에러가 아니라 "로그아웃된 상태"로 수렴).
  router.post("/auth/logout", asyncHandler(async (req, res) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    if (token) {
      const playerId = await resolveSession(token);
      await deleteSession(token);
      if (playerId) await writeAuditLog("log_auth", { actorId: playerId, action: "logout", changes: {} });
    }
    res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: isSecureCookie });
    res.json({ result: 0 });
  }));

  // 리다이렉트 기반 프로바이더 레지스트리 — 페이스북은 토글 없이 항상 포함되고, 구글은
  // GOOGLE_AUTH_FLOW가 authorization_code일 때만 포함된다(id_token이면 GIS 전용 POST 경로를
  // 대신 등록). 새 프로바이더(네이버 등) 추가 시 이 배열에 SocialAuthProvider 구현체 하나만
  // 추가하면 되고, 아래 라우트 등록 루프는 건드릴 필요가 없다.
  const socialProviders: SocialAuthProvider[] = [facebookAuthProvider];

  if (config.googleAuthFlow === "authorization_code") {
    socialProviders.push(googleAuthCodeProvider);
  } else {
    router.post("/auth/google", asyncHandler(async (req, res) => {
      const { credential } = req.body ?? {};
      if (typeof credential !== "string" || !credential)
        throw new BusinessException(ERROR_MAP.AUTH.VALIDATION_FAILED, { body: req.body });

      const result = await loginWithGoogleIdToken(credential, playerRepository);
      if (result.status === "pending") {
        issuePendingRegistrationCookie(res, result.token);
        res.json({ result: 0, pendingRegistration: true, defaultName: result.defaultName });
        return;
      }
      issueSessionCookie(res, result.sessionToken);
      res.json({ result: 0 });
    }));
  }

  // 신규 가입자는 닉네임을 입력받기 전까지 Player를 만들지 않는다 — 이 두 엔드포인트가 그
  // "가입 보류" 구간을 담당한다(CLAUDE.md "인증 전략"). 토큰은 URL이 아니라 httpOnly 쿠키로만
  // 오간다(referrer로 새는 것을 피하기 위함) — GIS/리다이렉트 두 로그인 방식 모두 이 두
  // 엔드포인트로 합류한다.
  router.get("/auth/register/pending", asyncHandler(async (req, res) => {
    const token = readCookie(req.headers.cookie, PENDING_REGISTRATION_COOKIE_NAME);
    if (!token) throw new BusinessException(ERROR_MAP.AUTH.REGISTRATION_EXPIRED, {});
    const pending = await resolvePendingRegistration(token);
    if (!pending) throw new BusinessException(ERROR_MAP.AUTH.REGISTRATION_EXPIRED, {});
    res.json({ result: 0, defaultName: pending.name });
  }));

  router.post("/auth/register/complete", asyncHandler(async (req, res) => {
    const token = readCookie(req.headers.cookie, PENDING_REGISTRATION_COOKIE_NAME);
    const { name } = req.body ?? {};
    if (!token) throw new BusinessException(ERROR_MAP.AUTH.REGISTRATION_EXPIRED, {});
    if (typeof name !== "string") throw new BusinessException(ERROR_MAP.AUTH.VALIDATION_FAILED, { body: req.body });

    const sessionToken = await completeRegistration(token, name, playerRepository);
    res.clearCookie(PENDING_REGISTRATION_COOKIE_NAME);
    issueSessionCookie(res, sessionToken);
    res.json({ result: 0 });
  }));

  // CSRF state 쿠키는 프로바이더마다 따로 두지 않고 공용 oauthState 쿠키를 재사용한다 — 한
  // 브라우저에서 동시에 두 플로우를 진행할 일이 없어 네임스페이스 분리가 불필요하다.
  for (const provider of socialProviders) {
    router.get(`/auth/${provider.platformType}/login`, (_req, res) => {
      const state = randomUUID();
      res.cookie(OAUTH_STATE_COOKIE_NAME, state, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 5 * 60 * 1000,
        secure: isSecureCookie,
      });
      res.redirect(provider.generateAuthUrl(state));
    });

    router.get(`/auth/${provider.platformType}/callback`, asyncHandler((req, res) =>
      handleOAuthCallback(req, res, code => loginWithSocialProvider(provider, code, playerRepository)),
    ));
  }

  return router;
}
