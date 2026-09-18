import type { AttendanceBookDef } from "./domain/attendanceBookDef.js";
import type { AttendanceCatchupPrice } from "./domain/attendanceCatchupPrice.js";
import type { AttendanceReward } from "./domain/attendanceReward.js";

/** 최초 GENERAL 출석부 defId. */
export const GENERAL_LAUNCH_DEF_ID = "general_launch";
/** 신규가입 대상 EVENT 출석부 defId — EVENT라 로테이션 없음(1회성). */
export const EVENT_NEWBIE_DEF_ID = "event_newbie_attendance";
/** targetAudience=NEW_USER EVENT 출석부 defId. */
export const EVENT_NEW_USER_DEF_ID = "event_new_user_welcome";
/** targetAudience=RETURNING_USER EVENT 출석부 defId — 마지막 로그인 후 7일 이상 미접속이 대상. */
export const EVENT_RETURNING_USER_DEF_ID = "event_returning_user_comeback";

type AttendanceBookSeed = Omit<AttendanceBookDef, "_id" | "createdAt" | "updatedAt">;

/**
 * 시드 대상 출석부 목록. enrollableStart/enrollableEnd를 둘 다 사실상 무제한(1970~9998)으로
 * 잡아 로컬 개발/e2e 테스트가 로그인 즉시 발급받을 수 있게 한다 — 실제 값은 전부 임시값
 * (`battleStage/seedData.ts`의 몬스터 기본 스탯과 동일한 성격, 정식 밸런싱은 추후).
 *  - GENERAL(`general_launch`): 30일 주기로 로테이션.
 *  - EVENT(`event_newbie_attendance`): 신규가입 대상 7일짜리, EVENT라 로테이션 없음(1회성).
 */
export const ATTENDANCE_BOOK_SEEDS: readonly AttendanceBookSeed[] = [
  {
    defId: GENERAL_LAUNCH_DEF_ID,
    type: "GENERAL",
    targetAudience: "ALL_USERS",
    // GENERAL은 상시 라인이라 사실상 무제한 로테이션이 필요 — 무제한 sentinel이 없어 충분히
    // 큰 수로 대체한다(도메인 필드 JSDoc 참고).
    maxRotationCount: 999999,
    enrollableStart: new Date("1970-01-01T00:00:00Z"),
    enrollableEnd: new Date("9998-12-31T23:59:59Z"),
    durationDays: 30,
    catchupMaxCount: 3,
  },
  {
    defId: EVENT_NEWBIE_DEF_ID,
    type: "EVENT",
    targetAudience: "ALL_USERS",
    maxRotationCount: 0,
    enrollableStart: new Date("1970-01-01T00:00:00Z"),
    enrollableEnd: new Date("9998-12-31T23:59:59Z"),
    durationDays: 7,
    catchupMaxCount: 3,
  },
  {
    defId: EVENT_NEW_USER_DEF_ID,
    type: "EVENT",
    targetAudience: "NEW_USER",
    maxRotationCount: 0,
    enrollableStart: new Date("1970-01-01T00:00:00Z"),
    enrollableEnd: new Date("9998-12-31T23:59:59Z"),
    durationDays: 7,
    catchupMaxCount: 3,
  },
  {
    defId: EVENT_RETURNING_USER_DEF_ID,
    type: "EVENT",
    targetAudience: "RETURNING_USER",
    returningInactiveDays: 7,
    maxRotationCount: 0,
    enrollableStart: new Date("1970-01-01T00:00:00Z"),
    enrollableEnd: new Date("9998-12-31T23:59:59Z"),
    durationDays: 7,
    catchupMaxCount: 3,
  },
];

/** @returns 시드 대상 출석부 정의 전체
 * @author trisakion
 */
export function buildAttendanceBookDefs(): AttendanceBookSeed[] {
  return [...ATTENDANCE_BOOK_SEEDS];
}

/**
 * @param durationDays 대상 출석부의 진행 일수
 * @returns 1~durationDays일차 골드 보상 행(day*100골드, 임시값)
 * @author trisakion
 */
export function buildAttendanceRewardRows(durationDays: number): Array<Omit<AttendanceReward, "_id" | "defId">> {
  return Array.from({ length: durationDays }, (_, i) => ({ day: i + 1, itemType: "gold" as const, amount: (i + 1) * 100, cardTemplateId: null }));
}

/**
 * @param catchupMaxCount 대상 출석부의 캐치업 최대 구매 횟수
 * @returns 회차별 캐치업 가격 행(회차 × 200골드, 임시값)
 * @author trisakion
 */
export function buildAttendanceCatchupPriceRows(catchupMaxCount: number): Array<Omit<AttendanceCatchupPrice, "_id" | "defId">> {
  return Array.from({ length: catchupMaxCount }, (_, i) => ({ purchaseIndex: i + 1, price: (i + 1) * 200 }));
}
