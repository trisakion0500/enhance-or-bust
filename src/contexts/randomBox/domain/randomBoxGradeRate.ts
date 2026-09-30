/**
 * 등급비율(gradeRate) 랜덤박스의 등급별 확률 행(`master_random_box_grade_rate` 컬렉션) —
 * `(boxId, grade)`당 문서 하나. 같은 boxId 내 rate 합은 100이어야 한다(GM 저장 API에서 검증).
 * GAME_DESIGN.md 7-1절 참고.
 * @author trisakion
 */
export interface RandomBoxGradeRate {
  /** 대상 상자 인스턴스 ID — `RandomBoxGradeRateDef.boxId` */
  boxId: string;
  /** 등급 코드 — `Grade` 리터럴 타입을 쓰지 않고 자유 문자열로 둔다. 나중에 새 등급(예: S)이
   * 추가돼도 이 컬렉션에 행 하나만 늘리면 되고 코드 변경이 필요 없다(7-1절 확정 사항) */
  grade: string;
  /** 이 등급이 뽑힐 확률(정수 %, 0~100) */
  rate: number;
}
