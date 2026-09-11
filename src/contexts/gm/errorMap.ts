import type { ErrorEntry } from "../../shared-kernel/errorEntry.js";

/**
 * gm_platform 연동(X-API-Key로 인증하는 GM 운영 API) 에러 정의. 코드 대역은 10000번대 고정.
 * @author trisakion
 */
export const GM_ERROR_MAP = {
  VALIDATION_FAILED: { code: 10000, httpStatus: 400, message: "요청 값이 올바르지 않습니다." },
  UNAUTHORIZED:      { code: 10001, httpStatus: 401, message: "인증에 실패했습니다." },
  NOT_FOUND:         { code: 10002, httpStatus: 404, message: "요청한 플레이어를 찾을 수 없습니다." },
  INTERNAL_ERROR:    { code: 10999, httpStatus: 500, message: "일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요." },
} satisfies Record<string, ErrorEntry>;
