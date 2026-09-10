import type { NextFunction, Request, Response } from "express";
import { SESSION_COOKIE_NAME } from "../contexts/auth/routes/authRoutes.js";
import { resolveSession } from "../contexts/auth/infrastructure/sessionStore.js";
import { readCookie } from "./cookies.js";
import { BusinessException } from "./businessException.js";
import { ERROR_MAP } from "./errorMap.js";
import { asyncHandler } from "./errorHandler.js";
import { markDailyActive } from "./dailyActive.js";

/**
 * `sessionToken` 쿠키를 Redis 세션과 대조해 `req.playerId`를 세팅하는 인증 미들웨어.
 * 인증이 필요한 라우터 앞에 개별적으로 붙인다(전역 `app.use`가 아님) — 아직 보호 대상 라우트가
 * 없으므로 이 미들웨어 자체는 서버 조립(`server.ts`)에 연결되어 있지 않고, 첫 보호 라우트를
 * 만들 때 그 라우터에 붙인다.
 * @author trisakion
 */
export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  const playerId = token ? await resolveSession(token) : undefined;
  if (!playerId)
    throw new BusinessException(ERROR_MAP.AUTH.UNAUTHENTICATED);

  req.playerId = playerId;
  void markDailyActive(playerId); // DAU 집계용 — 실패해도 요청을 막지 않으므로 await하지 않는다
  next();
});
