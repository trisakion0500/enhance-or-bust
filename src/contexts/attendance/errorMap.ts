import type { ErrorEntry } from "../../shared-kernel/errorEntry.js";

/**
 * 출석보상(23_GAME_DESIGN_ATTENDANCE.md) 에러 정의. 코드 대역은 12000번대 고정.
 * @author trisakion
 */
export const ATTENDANCE_ERROR_MAP = {
  VALIDATION_FAILED:     { code: 12000, httpStatus: 400, message: "요청 값이 올바르지 않습니다." },
  NOT_FOUND:              { code: 12001, httpStatus: 404, message: "존재하지 않는 출석부입니다." },
  ALREADY_GRANTED:        { code: 12002, httpStatus: 409, message: "이미 지급된 날짜입니다." },
  GOLD_INSUFFICIENT:      { code: 12003, httpStatus: 409, message: "골드가 부족합니다." },
  CATCHUP_LIMIT_EXCEEDED: { code: 12004, httpStatus: 409, message: "캐치업 구매 가능 횟수를 초과했습니다." },
  INSTANCE_NOT_ACTIVE:    { code: 12005, httpStatus: 409, message: "이미 종료된 출석부입니다." },
  DEF_OVERLAP:            { code: 12006, httpStatus: 409, message: "기존 출석부 기간과 겹칩니다." },
  DEF_DUPLICATE:          { code: 12007, httpStatus: 409, message: "이미 등록된 출석부입니다." },
  DEF_LOCKED:             { code: 12008, httpStatus: 409, message: "이미 시작된 출석부는 수정할 수 없습니다." },
  DEF_MISMATCH:           { code: 12009, httpStatus: 400, message: "보상/캐치업 행 구성이 설정값과 일치하지 않습니다." },
  INTERNAL_ERROR:         { code: 12999, httpStatus: 500, message: "일시적인 서버 오류입니다. 잠시 후 다시 시도해주세요." },
} satisfies Record<string, ErrorEntry>;
