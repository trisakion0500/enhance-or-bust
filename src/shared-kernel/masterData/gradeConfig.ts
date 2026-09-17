import type { Grade } from "./grade.js";

/**
 * 등급별 성장 상한 마스터 데이터(`master_grade_configs` 컬렉션). 최대 레벨/최대 강화 단계를
 * 코드 상수가 아니라 데이터로 관리해 기획자가 등급별로 독립적으로 조정할 수 있게 한다.
 * GAME_DESIGN.md 1절 "등급별 성장 상한" 참고.
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 */
export interface GradeConfig {
  /** 대상 카드 등급 */
  grade: Grade;
  /** 이 등급 카드가 도달 가능한 최대 레벨 */
  maxLevel: number;
  /** 이 등급 카드가 도달 가능한 최대 강화 단계 */
  maxEnhancementLevel: number;
}
