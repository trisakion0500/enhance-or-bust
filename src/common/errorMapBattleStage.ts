import type { ErrorEntry } from "./errorEntry.js";

/**
 * 전투/스테이지 에러(검증 실패, Not Found, 시스템 오류) 정의. 코드 대역은 8000번대 고정.
 * @author trisakion
 */
export const BATTLE_STAGE_ERROR_MAP = {
  VALIDATION_FAILED:  { code: 8000,   httpStatus: 400,    message: "요청 값이 올바르지 않습니다." },
  NOT_FOUND:          { code: 8001,   httpStatus: 404,    message: "요청한 리소스를 찾을 수 없습니다." },
  INTERNAL_ERROR:     { code: 8999,   httpStatus: 500,    message: "일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요." },
} satisfies Record<string, ErrorEntry>;
