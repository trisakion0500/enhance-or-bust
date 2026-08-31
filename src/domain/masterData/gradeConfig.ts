import type { Grade } from "./grade.js";

/**
 * 등급별 성장 상한 마스터 데이터(`grade_configs` 컬렉션). 최대 레벨/최대 강화 단계를
 * 코드 상수가 아니라 데이터로 관리해 기획자가 등급별로 독립적으로 조정할 수 있게 한다.
 * GAME_DESIGN.md 1절 "등급별 성장 상한" 참고.
 * @author trisakion
 */
export interface GradeConfig {
  grade: Grade;
  maxLevel: number;
  maxEnhancementLevel: number;
}
