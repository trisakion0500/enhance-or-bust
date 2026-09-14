import type { ErrorEntry } from "../../shared-kernel/errorEntry.js";

/**
 * coupon_platform 연동(쿠폰 코드 사용) 에러 정의. 코드 대역은 11000번대 고정.
 * @author trisakion
 */
export const COUPON_ERROR_MAP = {
  VALIDATION_FAILED: { code: 11000, httpStatus: 400, message: "요청 값이 올바르지 않습니다." },
  NOT_FOUND:         { code: 11001, httpStatus: 404, message: "존재하지 않는 쿠폰 코드입니다." },
  ALREADY_USED:      { code: 11002, httpStatus: 409, message: "이미 사용된 쿠폰 코드입니다." },
  UNAVAILABLE:       { code: 11003, httpStatus: 409, message: "지금은 사용할 수 없는 쿠폰입니다." },
  LIMIT_EXCEEDED:    { code: 11004, httpStatus: 409, message: "쿠폰 사용 한도를 초과했습니다." },
  INTERNAL_ERROR:    { code: 11999, httpStatus: 500, message: "일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요." },
} satisfies Record<string, ErrorEntry>;
