/**
 * 커스텀(custom) 랜덤박스 정의 마스터 데이터(`master_random_box_custom_def` 컬렉션). 상자
 * 인스턴스 하나당 문서 하나 — 이벤트별로 여러 개 존재할 수 있다(예: "여름 이벤트 상자").
 * 뽑힐 수 있는 카드 원형과 가중치는 별도 컬렉션 `master_random_box_custom_pool`
 * (RandomBoxCustomPool)에 자식 행으로 둔다. GAME_DESIGN.md 7-1절 참고.
 * @author trisakion
 */
export interface RandomBoxCustomDef {
  /** 상자 인스턴스 ID(자연키) */
  boxId: string;
  /** 표시용 상자 이름(예: "여름 이벤트 상자") */
  name: string;
  /** 1회 뽑기당 다이아 비용 */
  diamondCost: number;
  /** 비활성화된 상자는 뽑기 요청/우편 지급 대상에서 제외 */
  isActive: boolean;
}
