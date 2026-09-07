import { randomUUID } from "node:crypto";
import type { Response } from "express";
import { Router } from "express";
import { loginWithGoogleAuthCode, loginWithGoogleIdToken } from "../application/authService.js";
import { BusinessException } from "../common/businessException.js";
import { ERROR_MAP } from "../common/errorMap.js";
import { asyncHandler } from "../common/errorHandler.js";
import { config } from "../config/env.js";
import type { PlayerRepository } from "../domain/player/playerRepository.js";
import { generateGoogleAuthUrl } from "../infra/googleAuth.js";

/** 세션 토큰을 담는 쿠키 이름. */
export const SESSION_COOKIE_NAME = "sessionToken";

/** Authorization Code Flow CSRF 방지용 state를 담는 임시 쿠키 이름. */
const OAUTH_STATE_COOKIE_NAME = "oauthState";

/** 로컬 http 개발 환경에선 secure 쿠키가 저장되지 않아 배포(HTTPS) 환경에서만 켠다. */
const isSecureCookie = process.env.NODE_ENV === "production";

/**
 * `Cookie` 헤더에서 값 하나만 읽는다. 현재 쿠키 파싱이 필요한 곳이 이 라우터의 state 검증 하나뿐이라
 * `cookie-parser` 의존성을 추가하는 대신 최소 구현으로 둔다.
 * @param cookieHeader `req.headers.cookie` 원본
 * @param name 찾을 쿠키 이름
 * @returns 쿠키 값, 없으면 undefined
 */
function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  return cookieHeader
    ?.split("; ")
    .find(pair => pair.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/**
 * 인증 라우터. 프론트가 로그인 UI 초기화에 쓸 설정 조회(`GET /auth/config`)와, `config.googleAuthFlow`에
 * 따라 Google Identity Services(`POST /auth/google`) 또는 Authorization Code Flow
 * (`GET /auth/google/login` + `GET /auth/google/callback`) 중 하나의 로그인 경로를 제공한다.
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
