import type { ErrorEntry } from "./errorEntry.js";

/**
 * 도메인 무관 공통 에러(검증 실패, Not Found, 시스템 오류) 정의. 코드 대역은 1000번대 고정.
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 */
export const COMMON_ERROR_MAP = {
  VALIDATION_FAILED:  { code: 1000,   httpStatus: 400,    message: "요청 값이 올바르지 않습니다." },
  NOT_FOUND:          { code: 1001,   httpStatus: 404,    message: "요청한 리소스를 찾을 수 없습니다." },
  CONFLICT:           { code: 1002,   httpStatus: 409,    message: "다른 요청과 충돌해 처리하지 못했습니다. 다시 시도해주세요." },
  LOCKED:             { code: 1003,   httpStatus: 429,    message: "처리 중인 요청이 있습니다. 잠시 후 다시 시도해주세요." },
  INTERNAL_ERROR:     { code: 1999,   httpStatus: 500,    message: "일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요." },
} satisfies Record<string, ErrorEntry>;
