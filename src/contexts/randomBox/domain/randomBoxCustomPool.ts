/**
 * 커스텀(custom) 랜덤박스의 카드 원형별 가중치 행(`master_random_box_custom_pool` 컬렉션) —
 * `(boxId, templateId)`당 문서 하나. 등급 개념과 무관하게 관리자가 원형 ID와 상대 가중치를
 * 직접 지정한다(합계가 특정 값일 필요 없음 — cardDrop.ts의 `pickWeightedCardTemplate`과
 * 동일한 가중치 룰렛 방식). GAME_DESIGN.md 7-1절 참고.
 * @author trisakion
 */
export interface RandomBoxCustomPool {
  /** 대상 상자 인스턴스 ID — `RandomBoxCustomDef.boxId` */
  boxId: string;
  /** 뽑힐 수 있는 카드 원형 ID */
  templateId: string;
  /** 상대 가중치(정수) */
  weight: number;
}
