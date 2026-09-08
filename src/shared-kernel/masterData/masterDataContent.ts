/**
 * 마스터 데이터 컨텐츠(컬렉션) 종류. 컬렉션명 문자열 리터럴을 캐시/워처/폴러 세 곳에서
 * 따로 타이핑하지 않도록 한 곳에서 유니온 타입 + 목록으로 관리한다.
 * @author trisakion
 */
export type MasterDataContent =
  | "master_card_templates"
  | "master_grade_configs"
  | "master_enhancement_rules"
  | "master_synthesis_rules"
  | "master_stage_configs";

/** {@link MasterDataContent}의 전체 목록 — 전체 로드/워처 대상 컬렉션 필터링에 쓴다. */
export const MASTER_DATA_CONTENTS: readonly MasterDataContent[] = [
  "master_card_templates",
  "master_grade_configs",
  "master_enhancement_rules",
  "master_synthesis_rules",
  "master_stage_configs",
];
