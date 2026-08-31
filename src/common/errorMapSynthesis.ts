import type { ErrorEntry } from "./errorEntry.js";

/**
 * 합성 에러(검증 실패, Not Found, 시스템 오류) 정의. 코드 대역은 4000번대 고정.
 * @author trisakion
 */
export const SYNTHESIS_ERROR_MAP = {
  VALIDATION_FAILED:  { code: 4000,   httpStatus: 400,    message: "요청 값이 올바르지 않습니다." },
  NOT_FOUND:          { code: 4001,   httpStatus: 404,    message: "요청한 리소스를 찾을 수 없습니다." },
  INTERNAL_ERROR:     { code: 4999,   httpStatus: 500,    message: "일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요." },
} satisfies Record<string, ErrorEntry>;
