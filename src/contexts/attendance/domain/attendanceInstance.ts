import type { AttendanceBookType } from "./attendanceBookDef.js";
import type { AttendanceRewardItemType } from "./attendanceReward.js";

/**
 * 발급 시점 def/보상/캐치업가격을 그대로 복사한 스냅샷 — 이후 def 원본이 바뀌어도 이미 발급된
 * 인스턴스는 영향받지 않는다("핵심 원칙 — 시드 스냅샷" 절, `coupon_redemptions`와 동일 원칙).
 * @author trisakion
 */
export interface AttendanceInstanceSnapshot {
  durationDays: number;
  catchupMaxCount: number;
  rewards: Array<{ day: number; itemType: AttendanceRewardItemType; amount: number; cardTemplateId: string | null }>;
  catchupPrices: Array<{ purchaseIndex: number; price: number }>;
}

/** 인스턴스 진행 상태 — ACTIVE는 진행 중(오늘 &lt; endDate), COMPLETED는 종료(오늘 >= endDate, `markInstanceCompleted()`가 전이).
 * @author trisakion
 */
export type AttendanceInstanceStatus = "ACTIVE" | "COMPLETED";

/**
 * 플레이어별 출석부 발급 인스턴스(`attendance_instances` 컬렉션). GENERAL 1개 + EVENT N개를
 * 동시에 보유할 수 있어 Player 애그리게잇에 embedding하지 않고 Mailbox와 동일하게 별도
 * 컬렉션으로 둔다.
 * @author trisakion
 */
export interface AttendanceInstance {
  _id: string;
  playerId: string;
  defId: string;
  type: AttendanceBookType;
  snapshot: AttendanceInstanceSnapshot;
  /** 캐치업 구매 횟수 — 인스턴스 필드라 로테이션/재발급 시 자동 리셋 */
  catchupPurchaseCount: number;
  /** 발급일(로컬 YYYY-MM-DD, `dailyActive.ts`의 `todayDateString()`과 동일 형식) */
  startDate: string;
  /** 종료 경계일(로컬 YYYY-MM-DD) — 오늘 >= endDate면 COMPLETED 처리 대상 */
  endDate: string;
  /** 출석 처리된 출석부 내 일차(1-based) 목록 — `$addToSet`으로만 추가(원자적/멱등) */
  attendedDays: number[];
  status: AttendanceInstanceStatus;
  issuedAt: Date;
}
