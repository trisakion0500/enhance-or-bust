import type { Grade } from "./grade.js";
import type { GradeConfig } from "./gradeConfig.js";
import type { CardTemplate } from "./cardTemplate.js";

/** GAME_DESIGN.md 1절 "등급별 성장 상한 초기값" 그대로. */
export const GRADE_CONFIGS: GradeConfig[] = [
  { grade: "N", maxLevel: 20, maxEnhancementLevel: 5 },
  { grade: "R", maxLevel: 40, maxEnhancementLevel: 10 },
  { grade: "SR", maxLevel: 60, maxEnhancementLevel: 15 },
  { grade: "SSR", maxLevel: 60, maxEnhancementLevel: 15 },
];

/** 등급별 기본 공격력 범위(GAME_DESIGN.md 1절) — 샘플 템플릿 생성에 쓰인다. */
const ATTACK_RANGE: Record<Grade, [min: number, max: number]> = {
  N: [10, 20],
  R: [25, 40],
  SR: [50, 80],
  SSR: [100, 150],
};

/** @returns 등급별 10개씩, 등급 공격력 범위에 균등분포한 샘플 카드 원형 40개 */
export function buildCardTemplates(): CardTemplate[] {
  const templates: CardTemplate[] = [];
  for (const grade of Object.keys(ATTACK_RANGE) as Grade[]) {
    const [min, max] = ATTACK_RANGE[grade];
    for (let i = 0; i < 10; i++) {
      const baseAttack = Math.round(min + ((max - min) * i) / 9);
      templates.push({ templateId: `${grade}_${String(i + 1).padStart(2, "0")}`, grade, baseAttack });
    }
  }
  return templates;
}
