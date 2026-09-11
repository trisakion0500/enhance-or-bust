import type { ErrorEntry } from "../../shared-kernel/errorEntry.js";

/**
 * 인증 에러(구글 토큰 검증 실패, 세션 미인증 등) 정의. 코드 대역은 9000번대 고정.
 * @author trisakion
 */
export const AUTH_ERROR_MAP = {
  VALIDATION_FAILED:    { code: 9000,   httpStatus: 400,    message: "요청 값이 올바르지 않습니다." },
  INVALID_GOOGLE_TOKEN: { code: 9001,   httpStatus: 401,    message: "구글 로그인 검증에 실패했습니다." },
  UNAUTHENTICATED:      { code: 9002,   httpStatus: 401,    message: "로그인이 필요합니다." },
  INVALID_FACEBOOK_TOKEN: { code: 9003, httpStatus: 401,    message: "페이스북 로그인 검증에 실패했습니다." },
  REGISTRATION_EXPIRED: { code: 9004,   httpStatus: 401,    message: "가입 세션이 만료되었습니다. 처음부터 다시 로그인해주세요." },
  INTERNAL_ERROR:       { code: 9999,   httpStatus: 500,    message: "일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요." },
} satisfies Record<string, ErrorEntry>;
