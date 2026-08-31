import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger } from "../infra/logger.js";
import { BusinessException } from "./businessException.js";
import { ERROR_MAP } from "./errorMap.js";

/**
 * async 라우트 핸들러를 감싸 reject를 `next(err)`로 넘긴다. Express 4는 async 핸들러의 rejection을
 * 자동으로 잡지 못해서, 이 래퍼 없이는 {@link errorHandler}까지 에러가 도달하지 않는다.
 * @param fn 감쌀 async 라우트 핸들러
 * @returns Express가 바로 등록할 수 있는 핸들러
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 전역 Express 에러 미들웨어. {@link BusinessException}은 들고 있는 `entry`대로 그대로 응답하고,
 * 그 외 미분류 예외는 스택트레이스 등 내부 정보를 응답에 노출하지 않고 공통 INTERNAL_ERROR로 감싼다.
 * @param err 라우트/미들웨어에서 던져진 에러
 * @param _req 사용하지 않음(Express 에러 미들웨어 시그니처 고정 인자 4개 필요)
 * @param res 응답 객체
 * @param _next 사용하지 않음
 * @author trisakion
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof BusinessException) {
    const { code, message, httpStatus } = err.entry;
    if (err.diagnostics)
      logger.error(code, err.diagnostics);
    res.status(httpStatus).json({ result: code, message });
    return;
  }

  logger.error("unhandled error", err);
  const { code, message, httpStatus } = ERROR_MAP.COMMON.INTERNAL_ERROR;
  res.status(httpStatus).json({ result: code, message });
}
