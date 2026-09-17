/** 출석 보상 아이템 종류 — 기존 Economy/Inventory 카탈로그를 그대로 참조(별도 아이템 마스터 없음). */
export type AttendanceRewardItemType = "gold" | "enhancementStone" | "diamond" | "card";

/**
 * 출석부 날짜별 보상 행(`attendance_rewards` 컬렉션) — `(defId, day)`당 아이템 종류 수만큼
 * 행이 여러 개일 수 있는 flat row 구조. gm_platform이 "day별 아이템 배열" 같은 1:n 중첩
 * 구조를 다루지 못해(기획자가 JSON을 직접 편집해야 함) 이렇게 분리한다
 * (23_GAME_DESIGN_ATTENDANCE.md "날짜별 보상 구성" 절).
 * @author trisakion
 */
export interface AttendanceReward {
  _id: string;
  defId: string;
  /** 출석부 내 일차(1부터 시작 — 캘린더 날짜가 아니라 발급일 기준 경과일) */
  day: number;
  itemType: AttendanceRewardItemType;
  /** gold/enhancementStone/diamond는 수량, card는 장수 */
  amount: number;
  /** itemType === "card"일 때만 값, 그 외 null */
  cardTemplateId: string | null;
}
