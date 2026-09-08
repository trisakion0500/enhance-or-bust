import type { Grade } from "../../shared-kernel/masterData/grade.js";
import type { SynthesisRule } from "./domain/synthesisRule.js";

const GRADE_UPGRADE_PATH: Grade[] = ["N", "R", "SR", "SSR"];

/** GAME_DESIGN.md 3절 합성 시스템 그대로 — 등급 승급(80% 성공) + 강화 재료(100% 성공) 두 레시피. */
export const SYNTHESIS_RULES: SynthesisRule[] = [
  ...GRADE_UPGRADE_PATH.slice(0, -1).map(
    (sourceGrade, i): SynthesisRule => ({
      type: "gradeUpgrade",
      sourceGrade,
      resultGrade: GRADE_UPGRADE_PATH[i + 1],
      materialCount: 3,
      successRate: 0.8,
    }),
  ),
  { type: "enhanceMaterial", materialCount: 2, goldCost: 500 },
];
