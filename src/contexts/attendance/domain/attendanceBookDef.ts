/** 출석부 유형 — GENERAL은 상시 1개 라인 로테이션, EVENT는 병렬/1회성(재오픈 없음). */
export type AttendanceBookType = "GENERAL" | "EVENT";

/**
 * 출석부 정의(시드/gm_platform 관리 데이터, `attendance_book_defs` 컬렉션). 내부 PK(`_id`)와
 * 비즈니스 키(`defId`)를 분리한다 — `defId`는 gm_platform 운영 중 수정될 수 있어(아직 시작 전인
 * def에 한해) PK로 쓰면 안 된다(23_GAME_DESIGN_ATTENDANCE.md "비즈니스 키 vs 내부 PK" 절).
 * @author trisakion
 */
export interface AttendanceBookDef {
  /** 내부 PK(자동 생성) */
  _id: string;
  /** 비즈니스 키 — DB 레벨 unique 인덱스 */
  defId: string;
  type: AttendanceBookType;
  /** 발급 가능 시작 시각 — 이 시각이 지나면 def는 읽기 전용(수정 불가) */
  enrollableStart: Date;
  /** 발급 가능 종료 시각 */
  enrollableEnd: Date;
  /** 발급 후 진행 일수 */
  durationDays: number;
  /** 캐치업 최대 구매 가능 횟수 — `attendance_catchup_prices`의 defId별 행 개수와 일치해야 함 */
  catchupMaxCount: number;
  createdAt: Date;
  updatedAt: Date;
}
