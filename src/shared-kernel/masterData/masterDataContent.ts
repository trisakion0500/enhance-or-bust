import { COLLECTIONS } from "../collectionNames.js";

/**
 * 마스터 데이터 컨텐츠(컬렉션) 종류. 실제 컬렉션명 리터럴의 유일한 출처는
 * `collectionNames.ts`의 `COLLECTIONS`이고, 이 타입/목록은 그중 `master_` 9개만 모아
 * 캐시/워처/폴러가 컨텐츠 단위(유니온 타입 + 순회 목록)로 다루기 편하게 재구성한 것이다.
 * 출석부 3종(`MASTER_ATTENDANCE_*`)은 gm_platform이 시드 스크립트 없이 실시간으로 쓰지만,
 * 워처는 쓰기 주체와 무관하게 `event.ns.coll`만 보므로 이 목록에 넣는 것만으로 자동으로
 * Change Stream/폴링 대상이 된다.
 * @author trisakion
 */
export type MasterDataContent =
  | typeof COLLECTIONS.MASTER_CARD_TEMPLATES
  | typeof COLLECTIONS.MASTER_GRADE_CONFIGS
  | typeof COLLECTIONS.MASTER_ENHANCEMENT_RULES
  | typeof COLLECTIONS.MASTER_SYNTHESIS_RULES
  | typeof COLLECTIONS.MASTER_STAGE_CONFIGS
  | typeof COLLECTIONS.MASTER_STAGE_CARD_DROPS
  | typeof COLLECTIONS.MASTER_ATTENDANCE_DEFS
  | typeof COLLECTIONS.MASTER_ATTENDANCE_REWARDS
  | typeof COLLECTIONS.MASTER_ATTENDANCE_CATCHUP_PRICES;

/** {@link MasterDataContent}의 전체 목록 — 전체 로드/워처 대상 컬렉션 필터링에 쓴다. */
export const MASTER_DATA_CONTENTS: readonly MasterDataContent[] = [
  COLLECTIONS.MASTER_CARD_TEMPLATES,
  COLLECTIONS.MASTER_GRADE_CONFIGS,
  COLLECTIONS.MASTER_ENHANCEMENT_RULES,
  COLLECTIONS.MASTER_SYNTHESIS_RULES,
  COLLECTIONS.MASTER_STAGE_CONFIGS,
  COLLECTIONS.MASTER_STAGE_CARD_DROPS,
  COLLECTIONS.MASTER_ATTENDANCE_DEFS,
  COLLECTIONS.MASTER_ATTENDANCE_REWARDS,
  COLLECTIONS.MASTER_ATTENDANCE_CATCHUP_PRICES,
];
