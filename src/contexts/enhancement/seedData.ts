import type { EnhancementRule } from "./domain/enhancementRule.js";

/** GAME_DESIGN.md 2절 강화 확률/비용 표 그대로. */
export const ENHANCEMENT_RULES: EnhancementRule[] = [
  { minTargetEnhancementLevel: 1, maxTargetEnhancementLevel: 5, successRate: 1.0, destroyOnFailChance: 0, goldMultiplier: 100, stoneCost: 1 },
  { minTargetEnhancementLevel: 6, maxTargetEnhancementLevel: 10, successRate: 0.7, destroyOnFailChance: 0, goldMultiplier: 300, stoneCost: 2 },
  { minTargetEnhancementLevel: 11, maxTargetEnhancementLevel: 15, successRate: 0.4, destroyOnFailChance: 0.1, goldMultiplier: 800, stoneCost: 3 },
];
