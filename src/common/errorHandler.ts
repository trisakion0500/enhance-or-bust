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
 * Express는 등록된 미들웨어 함수의 인자 개수(arity)로 에러 미들웨어인지 판별한다 — 정확히 4개일 때만
 * 에러 발생 시 호출 대상으로 인식하므로, `_req`/`_next`를 안 쓰더라도 시그니처에서 생략하면 안 된다.
 * @param err 라우트/미들웨어에서 던져진 에러
 * @param _req 사용하지 않음(위 이유로 시그니처 유지 목적)
 * @param res 응답 객체
 * @param _next 사용하지 않음(위 이유로 시그니처 유지 목적)
 * @author trisakion
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const requestId = res.locals.requestId;

  if (err instanceof BusinessException) {
    // 예상된 실패라 throw 지점이 에러 코드만으로 특정 가능 — err 객체 대신 code/message만 남겨 콜스택은 찍지 않는다.
    // 디버깅에 컨텍스트가 더 필요한 경우는 diagnostics로 남기고, 그때만 error 레벨로 로깅한다.
    const { code, message, httpStatus } = err.entry;
    if (err.diagnostics)
      logger.error(`[${requestId}] ${code} ${message}`, err.diagnostics);
    else
      logger.info(`[${requestId}] ${code} ${message}`);
    res.status(httpStatus).json({ result: code, message });
    return;
  }

  logger.error(`[${requestId}] unhandled error`, err);
  const { code, message, httpStatus } = ERROR_MAP.COMMON.INTERNAL_ERROR;
  res.status(httpStatus).json({ result: code, message });
}
