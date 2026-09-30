import type { ErrorEntry } from "../../shared-kernel/errorEntry.js";

/**
 * 랜덤박스(가챠) 에러(Not Found, 시스템 오류) 정의. 코드 대역은 13000번대 고정.
 * @author trisakion
 */
export const RANDOM_BOX_ERROR_MAP = {
  NOT_FOUND:      { code: 13000, httpStatus: 404, message: "존재하지 않거나 비활성화된 상자입니다." },
  INTERNAL_ERROR: { code: 13999, httpStatus: 500, message: "일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요." },
} satisfies Record<string, ErrorEntry>;
