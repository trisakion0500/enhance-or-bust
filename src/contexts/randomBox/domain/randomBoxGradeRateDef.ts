/**
 * 등급비율(gradeRate) 랜덤박스 정의 마스터 데이터(`master_random_box_grade_rate_def` 컬렉션).
 * 상자 인스턴스 하나당 문서 하나 — 같은 종류라도 여러 개 존재할 수 있다(비싼 상자는 고등급
 * 확률이 높고, 싼 상자는 낮은 식의 가격 티어). 등급별 확률은 별도 컬렉션
 * `master_random_box_grade_rate`(RandomBoxGradeRate)에 자식 행으로 둔다.
 * GAME_DESIGN.md 7-1절 참고.
 * @author trisakion
 */
export interface RandomBoxGradeRateDef {
  /** 상자 인스턴스 ID(자연키) */
  boxId: string;
  /** 표시용 상자 이름(예: "고급 상자", "일반 상자") */
  name: string;
  /** 1회 뽑기당 다이아 비용 */
  diamondCost: number;
  /** 비활성화된 상자는 뽑기 요청/우편 지급 대상에서 제외 */
  isActive: boolean;
}
