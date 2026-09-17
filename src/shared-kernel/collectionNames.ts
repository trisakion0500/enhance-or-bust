/**
 * MongoDB 컬렉션명을 한 곳에서 관리한다 — 여러 파일에 문자열 리터럴로 흩어져 있으면
 * 오타가 나도 타입체커가 잡지 못하고(존재하지 않거나 엉뚱한 컬렉션을 조용히 바라보게 됨),
 * 컬렉션명을 바꿀 때도 놓치는 곳이 생긴다. Redis 키를 `redisKeys.ts` 빌더 함수 하나로
 * 모으는 것과 동일한 원칙(CLAUDE.md "Redis 용도" 절). 새 컬렉션이 추가되면 이 파일에
 * 먼저 추가하고 재사용한다.
 *
 * 그룹 구분은 CLAUDE.md "마스터 데이터 로딩/리로드 전략"의 프리픽스 원칙과 동일하다:
 * 런타임 쓰기(프리픽스 없음) / `master_`(컨텐츠) / `system_`(서버 내부 운영 상태)은
 * 메인 게임 DB(`enhance_or_bust`), `log_`/`stats_`/`attempts_`는 물리적으로 분리된
 * 로그 DB(`enhance_or_bust_log`)에 있다.
 * @author trisakion
 */
export const COLLECTIONS = {
  // 메인 게임 DB — 런타임 쓰기 컬렉션
  PLAYERS: "players",
  MAILBOX: "mailbox",
  COUPON_REDEMPTIONS: "coupon_redemptions",
  // 유저별 출석부 발급 인스턴스(23_GAME_DESIGN_ATTENDANCE.md) — GENERAL 1개+EVENT N개를
  // 동시 보유해 Player 애그리게잇에 embedding하지 않고 Mailbox와 동일하게 별도 컬렉션.
  ATTENDANCE_INSTANCES: "attendance_instances",

  // 메인 게임 DB — 마스터 데이터(컨텐츠) 컬렉션. 컨텐츠 단위 취급이 필요한 9개는
  // masterDataContent.ts의 MasterDataContent 타입/MASTER_DATA_CONTENTS 목록이 이 값을 그대로 가져다 쓴다.
  MASTER_DATA_META: "master_data_meta",
  MASTER_CARD_TEMPLATES: "master_card_templates",
  MASTER_GRADE_CONFIGS: "master_grade_configs",
  MASTER_ENHANCEMENT_RULES: "master_enhancement_rules",
  MASTER_SYNTHESIS_RULES: "master_synthesis_rules",
  MASTER_STAGE_CONFIGS: "master_stage_configs",
  MASTER_STAGE_CARD_DROPS: "master_stage_card_drops",
  // 출석부 정의/날짜별 보상/캐치업 가격(23_GAME_DESIGN_ATTENDANCE.md) — 시드 스크립트가
  // 아니라 gm_platform이 운영 중 실시간으로 쓰기 때문에, 다른 master_* 컬렉션과 달리
  // DB 레벨 unique 인덱스를 둔다(attendanceStore.ts 참고). 콘텐츠 분류(프리픽스)와
  // 인덱스 전략(쓰기 패턴)은 별개 축이라 master_ 그룹에 속하는 것과 모순되지 않는다.
  MASTER_ATTENDANCE_DEFS: "master_attendance_defs",
  MASTER_ATTENDANCE_REWARDS: "master_attendance_rewards",
  MASTER_ATTENDANCE_CATCHUP_PRICES: "master_attendance_catchup_prices",

  // 메인 게임 DB — 서버 내부 운영 상태
  SYSTEM_BATCH_RUNS: "system_batch_runs",
  SYSTEM_CHANGE_STREAM_STATE: "system_change_stream_state",

  // 로그 DB — 감사 로그(컨텐츠별 분리, CLAUDE.md "감사 로그 / DAU 정책" 절)
  LOG_AUTH: "log_auth",
  LOG_ENHANCEMENT: "log_enhancement",
  LOG_SYNTHESIS: "log_synthesis",
  LOG_BATTLE_STAGE: "log_battle_stage",
  LOG_MAILBOX: "log_mailbox",
  LOG_COUPON: "log_coupon",
  LOG_ATTENDANCE: "log_attendance",

  // 로그 DB — 통계 전용(감사 로그 아님)
  STATS_DAILY_ACTIVE_PLAYERS: "stats_daily_active_players",
  ATTEMPTS_BATTLE_STAGE: "attempts_battle_stage",
} as const;
