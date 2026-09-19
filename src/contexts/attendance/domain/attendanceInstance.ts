import type { AttendanceBookType } from "./attendanceBookDef.js";
import type { AttendanceRewardItemType } from "./attendanceReward.js";

/**
 * 발급 시점 def/보상/캐치업가격을 그대로 복사한 스냅샷 — 이후 def 원본이 바뀌어도 이미 발급된
 * 인스턴스는 영향받지 않는다("핵심 원칙 — 시드 스냅샷" 절, `coupon_redemptions`와 동일 원칙).
 * @author trisakion
 */
export interface AttendanceInstanceSnapshot {
  /** 발급 시점 출석부 이름 — 이름 추가 이전에 발급된 인스턴스엔 없을 수 있어 표시할 때 현재 마스터 def 이름 → defId 순으로 폴백한다. */
  name?: string;
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
 * 컬렉션으로 둔다. `(playerId, defId)`당 문서가 정확히 1개만 존재하며(완전 unique 인덱스),
 * 로테이션마다 새 문서를 발급하지 않고 이 문서를 in-place로 리셋해 재사용한다 — 컬렉션이
 * 무한히 커지는 것을 막기 위한 설계이며, 리셋 직전 옛 사이클의 최종 상태는 `log_attendance`의
 * `action:"reset"` 감사 로그에 남는다(`attendanceService.ts`의 `issueInstanceIfRotationAllowed()` 참고).
 * @author trisakion
 * @modified 2026-09-18 trisakion 로테이션을 새 문서 발급에서 문서 1개 in-place 리셋으로 변경, rotationCount 필드 추가
 */
export interface AttendanceInstance {
  _id: string;
  playerId: string;
  defId: string;
  type: AttendanceBookType;
  snapshot: AttendanceInstanceSnapshot;
  /** 지금까지 이 defId로 발급된 횟수(최초 발급=1, 리셋마다 +1) — 문서를 재사용하는 방식이라
   * 컬렉션에 과거 이력이 남지 않아 카운트 쿼리로 대체할 수 없다(별도 필드로 저장). */
  rotationCount: number;
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
