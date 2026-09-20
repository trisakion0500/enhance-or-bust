import type { NextFunction, Request, Response } from "express";
import { isMongoHealthy } from "../infra/mongo.js";
import { isRedisHealthy } from "../infra/redis.js";
import { BusinessException } from "./businessException.js";
import { ERROR_MAP } from "./errorMap.js";

/**
 * 메인 DB(MongoDB)나 Redis가 다운된 것으로 판단되면 라우트 핸들러까지 보내지 않고 즉시
 * 503으로 거부한다(circuit breaker). 다운 중 들어오는 모든 요청이 개별적으로 재연결
 * 타임아웃을 기다리며 자원(커넥션/메모리)을 붙들고 있는 것을 막기 위함 — 이미 처리 중이던
 * 요청은 각자의 타임아웃(redis.ts의 RECONNECT_GIVE_UP_MS/mongo.ts의
 * serverSelectionTimeoutMS)대로 실패하고, 이 미들웨어는 그 이후 신규 요청만 막는다. 복구되면
 * `isMongoHealthy()`/`isRedisHealthy()`가 자동으로 true로 돌아와 별도 조치 없이 다시 열린다.
 * 로그 DB(`mongoLogClient`)는 대상이 아니다 — 로그 실패가 메인 흐름을 막으면 안 된다는
 * 원칙(CLAUDE.md 로깅 원칙)과 상충하기 때문이다.
 * @param _req 사용하지 않음(미들웨어 시그니처 유지 목적)
 * @param _res 사용하지 않음(정상 통과 시 `next()`만 호출 — 응답은 errorHandler가 대신 내려줌)
 * @param next 다운 상태가 아니면 그대로 다음 미들웨어로 진행
 * @author trisakion
 */
export function dbHealthGate(_req: Request, _res: Response, next: NextFunction): void {
  const mongoHealthy = isMongoHealthy();
  const redisHealthy = isRedisHealthy();
  // diagnostics를 실어 던지면 errorHandler가 이를 error 레벨로 로깅한다(정상 비즈니스 실패는
  // diagnostics 없이 info로 남기는 기존 컨벤션과 구분 — 이건 인프라 장애라 error가 맞다).
  if (!mongoHealthy || !redisHealthy)
    throw new BusinessException(ERROR_MAP.COMMON.SERVICE_UNAVAILABLE, { mongoHealthy, redisHealthy });
  next();
}
