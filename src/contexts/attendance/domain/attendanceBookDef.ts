/** 출석부 유형 — GENERAL은 상시 1개 라인 로테이션, EVENT는 병렬/1회성(재오픈 없음).
 * @author trisakion
 */
export type AttendanceBookType = "GENERAL" | "EVENT";

/** 발동 타입(대상자 조건) — `type`(GENERAL/EVENT)과 직교하는 별도 축
 * (23_GAME_DESIGN_ATTENDANCE.md "발동 타입(대상자 조건)" 절). 발동가능 기간 체크는 세 값
 * 공통 전제이고, `NEW_USER`/`RETURNING_USER`는 여기에 조건이 하나 더 붙는다.
 * @author trisakion
 */
export type AttendanceTargetAudience = "ALL_USERS" | "NEW_USER" | "RETURNING_USER";

/**
 * 출석부 정의(시드/gm_platform 관리 데이터, `attendance_book_defs` 컬렉션). 내부 PK(`_id`)와
 * 비즈니스 키(`defId`)를 분리한다 — `defId`는 gm_platform 운영 중 수정될 수 있어(아직 시작 전인
 * def에 한해) PK로 쓰면 안 된다(23_GAME_DESIGN_ATTENDANCE.md "비즈니스 키 vs 내부 PK" 절).
 * @author trisakion
 * @modified 2026-09-17 trisakion 발동 타입(targetAudience/returningInactiveDays) 필드 추가
 * @modified 2026-09-17 trisakion 로테이션 가능 횟수(maxRotationCount) 필드 추가 — GENERAL/EVENT 공통, type 기반 하드코딩(GENERAL 무제한/EVENT 0회) 대체
 */
export interface AttendanceBookDef {
  /** 내부 PK(자동 생성) */
  _id: string;
  /** 비즈니스 키 — DB 레벨 unique 인덱스 */
  defId: string;
  type: AttendanceBookType;
  /** 발동 타입(대상자 조건) — 기본 ALL_USERS */
  targetAudience: AttendanceTargetAudience;
  /** RETURNING_USER 전용 — 마지막 로그인으로부터 이 일수 이상 지나야 대상. 그 외 타입에서는 무의미 */
  returningInactiveDays?: number;
  /** 최초 발급 이후 재발급(로테이션) 가능 횟수 — GENERAL/EVENT 공통 관리, 0이면 재발급 불가
   * (최초 1회만 발급). "무제한"을 나타내는 별도 값은 없다 — 사실상 무제한이 필요하면 충분히
   * 큰 수를 직접 입력한다(23_GAME_DESIGN_ATTENDANCE.md "로테이션 가능 횟수" 절). */
  maxRotationCount: number;
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
