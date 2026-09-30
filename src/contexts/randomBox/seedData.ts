import type { RandomBoxGradeRateDef } from "./domain/randomBoxGradeRateDef.js";
import type { RandomBoxGradeRate } from "./domain/randomBoxGradeRate.js";
import type { RandomBoxCustomDef } from "./domain/randomBoxCustomDef.js";
import type { RandomBoxCustomPool } from "./domain/randomBoxCustomPool.js";

/** GAME_DESIGN.md 1절 가챠 확률(N/R/SR/SSR = 60/30/8/2%) 그대로 — 등급비율 상자 기본 1종.
 * diamondCost는 확정된 밸런스 값이 없어 임시값(다른 마스터 데이터 "임시값" 표기와 동일 원칙).
 * @author trisakion
 */
export const RANDOM_BOX_GRADE_RATE_DEF: RandomBoxGradeRateDef = {
  boxId: "basic_grade_rate",
  name: "기본 상자",
  diamondCost: 100,
  isActive: true,
};

/** {@link RANDOM_BOX_GRADE_RATE_DEF}의 등급별 확률 행.
 * @author trisakion
 */
export const RANDOM_BOX_GRADE_RATES: RandomBoxGradeRate[] = [
  { boxId: RANDOM_BOX_GRADE_RATE_DEF.boxId, grade: "N", rate: 60 },
  { boxId: RANDOM_BOX_GRADE_RATE_DEF.boxId, grade: "R", rate: 30 },
  { boxId: RANDOM_BOX_GRADE_RATE_DEF.boxId, grade: "SR", rate: 8 },
  { boxId: RANDOM_BOX_GRADE_RATE_DEF.boxId, grade: "SSR", rate: 2 },
];

/** 커스텀 상자 샘플 1종 — 등급 개념과 무관하게 관리자가 원형+가중치를 직접 지정한다는 것을
 * 보여주는 예시 데이터. `shared-kernel/masterData/seedData.ts`의 `buildCardTemplates()`가
 * 항상 만드는 N_01/R_01/SR_01 원형을 그대로 참조한다.
 * @author trisakion
 */
export const RANDOM_BOX_CUSTOM_DEF: RandomBoxCustomDef = {
  boxId: "sample_custom",
  name: "샘플 이벤트 상자",
  diamondCost: 150,
  isActive: true,
};

/** {@link RANDOM_BOX_CUSTOM_DEF}의 원형별 가중치 행.
 * @author trisakion
 */
export const RANDOM_BOX_CUSTOM_POOL: RandomBoxCustomPool[] = [
  { boxId: RANDOM_BOX_CUSTOM_DEF.boxId, templateId: "N_01", weight: 70 },
  { boxId: RANDOM_BOX_CUSTOM_DEF.boxId, templateId: "R_01", weight: 25 },
  { boxId: RANDOM_BOX_CUSTOM_DEF.boxId, templateId: "SR_01", weight: 5 },
];
