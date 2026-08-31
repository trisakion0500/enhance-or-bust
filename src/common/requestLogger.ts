import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logger } from "../infra/logger.js";
import { maskSensitive } from "./maskSensitive.js";

/**
 * 요청마다 상관관계 ID를 발급해 `res.locals.requestId`에 심는다. 같은 요청의 요청/응답 로그 두 줄을
 * 이 ID로 짝짓기 위함 — 에러 핸들러 등 이후 미들웨어도 `res.locals.requestId`로 같은 ID를 재사용한다.
 * @author trisakion
 */
export function requestId(_req: Request, res: Response, next: NextFunction) {
  res.locals.requestId = randomUUID();
  res.setHeader("X-Request-Id", res.locals.requestId);
  next();
}

/**
 * 요청 진입 시점과 응답 완료 시점에 각각 한 줄씩, 같은 요청 ID로 남긴다.
 * body/query는 {@link maskSensitive}로 가린 뒤 남긴다.
 * @author trisakion
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const id = res.locals.requestId;
  const start = Date.now();
  logger.info(`[${id}] --> ${req.method} ${req.originalUrl}`, maskSensitive({ query: req.query, body: req.body }));

  res.on("finish", () => {
    logger.info(`[${id}] <-- ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });

  next();
}
