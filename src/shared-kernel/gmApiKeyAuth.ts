import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config/env.js";
import { BusinessException } from "./businessException.js";
import { ERROR_MAP } from "./errorMap.js";

/**
 * gm_platform이 등록된 프로젝트(api_base_url)를 호출할 때 실어 보내는 X-API-Key 헤더를
 * 상수 시간 비교로 검증한다 — gm_platform의 test_game_server/rag_server가 쓰는
 * apiKeyAuth.ts와 동일한 패턴(참고만 했고 gm_platform 소스는 건드리지 않음).
 * config.gmPlatformApiKey가 설정되지 않으면(로컬 개발용) 검증을 건너뛴다.
 * 헤더 누락·길이 불일치·값 불일치 모두 동일한 401로 응답해 실패 원인을 노출하지 않는다.
 * @param req Express 요청
 * @param _res 사용하지 않음(에러는 throw로 asyncHandler/errorHandler에 위임)
 * @param next 다음 미들웨어 함수
 * @author trisakion
 */
export function gmApiKeyAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!config.gmPlatformApiKey) {
    next();
    return;
  }

  const header = req.header("X-API-Key") ?? "";
  const expected = Buffer.from(config.gmPlatformApiKey);
  const actual = Buffer.from(header);
  if (!header || expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new BusinessException(ERROR_MAP.GM.UNAUTHORIZED);

  next();
}
