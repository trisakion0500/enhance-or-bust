import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { Router } from "express";
import { loginWithGoogleAuthCode, loginWithGoogleIdToken } from "../application/authService.js";
import { deleteSession } from "../infrastructure/sessionStore.js";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { readCookie } from "../../../shared-kernel/cookies.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { config } from "../../../config/env.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import { generateGoogleAuthUrl } from "../infrastructure/googleAuth.js";

/** 세션 토큰을 담는 쿠키 이름. */
export const SESSION_COOKIE_NAME = "sessionToken";

/** Authorization Code Flow CSRF 방지용 state를 담는 임시 쿠키 이름. */
const OAUTH_STATE_COOKIE_NAME = "oauthState";

/** 로컬 http 개발 환경에선 secure 쿠키가 저장되지 않아 배포(HTTPS) 환경에서만 켠다. */
const isSecureCookie = process.env.NODE_ENV === "production";

/**
 * 인증 라우터. 프론트가 로그인 UI 초기화에 쓸 설정 조회(`GET /auth/config`)와, `config.googleAuthFlow`에
 * 따라 Google Identity Services(`POST /auth/google`) 또는 Authorization Code Flow
 * (`GET /auth/google/login` + `GET /auth/google/callback`) 중 하나의 로그인 경로, 그리고
 * `POST /auth/logout`(세션 무효화 + 쿠키 삭제)을 제공한다.
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

  // 세션 쿠키가 없거나 이미 만료된 토큰이어도 그냥 성공으로 처리한다(로그아웃은 멱등해야 함 —
  // 두 번 눌러도, 이미 만료된 뒤에 눌러도 에러가 아니라 "로그아웃된 상태"로 수렴).
  router.post("/auth/logout", asyncHandler(async (req, res) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    if (token) await deleteSession(token);
    res.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, sameSite: "lax", secure: isSecureCookie });
    res.json({ result: 0 });
  }));

  if (config.googleAuthFlow === "authorization_code") {
    router.get("/auth/google/login", (_req, res) => {
      const state = randomUUID();
      res.cookie(OAUTH_STATE_COOKIE_NAME, state, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 5 * 60 * 1000,
        secure: isSecureCookie,
      });
      res.redirect(generateGoogleAuthUrl(state));
    });

    router.get("/auth/google/callback", asyncHandler(async (req, res) => {
      const { code, state } = req.query;
      const expectedState = readCookie(req.headers.cookie, OAUTH_STATE_COOKIE_NAME);
      if (typeof code !== "string" || !code || typeof state !== "string" || !expectedState || state !== expectedState)
        throw new BusinessException(ERROR_MAP.AUTH.VALIDATION_FAILED, { query: req.query });

      res.clearCookie(OAUTH_STATE_COOKIE_NAME);
      const sessionToken = await loginWithGoogleAuthCode(code, playerRepository);
      issueSessionCookie(res, sessionToken);
      res.redirect("/");
    }));
  } else {
    router.post("/auth/google", asyncHandler(async (req, res) => {
      const { credential } = req.body ?? {};
      if (typeof credential !== "string" || !credential)
        throw new BusinessException(ERROR_MAP.AUTH.VALIDATION_FAILED, { body: req.body });

      const sessionToken = await loginWithGoogleIdToken(credential, playerRepository);
      issueSessionCookie(res, sessionToken);
      res.json({ result: 0 });
    }));
  }

  return router;
}
