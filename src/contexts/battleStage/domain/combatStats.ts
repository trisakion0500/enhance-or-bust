import type { CardTemplate } from "../../../shared-kernel/masterData/cardTemplate.js";
import type { Card } from "../../player/domain/card.js";

/** 카드 한 장의 전투 스탯(성장 보너스 적용 후). */
export interface CombatStats {
  /** 성장(레벨/강화) 보너스가 적용된 실제 공격력 */
  attack: number;
  /** 성장(레벨/강화) 보너스가 적용된 실제 체력 */
  hp: number;
}

/**
 * 카드의 레벨/강화 단계를 반영한 실제 전투 스탯을 계산한다. Enhancement(강화 1단계당 +5%)와
 * 동일한 패턴으로, 레벨도 기본값 1을 "성장 없음" 기준으로 삼아 (level-1)×2%를 적용한다
 * (GAME_DESIGN.md 4절 "레벨 1당 공격력 +2%").
 * @param card 스탯을 계산할 카드
 * @param template 카드 원형(기본 공격력/체력)
 * @returns 레벨/강화 성장이 반영된 실제 전투 스탯
 * @author trisakion
 */
export function computeCombatStats(card: Card, template: CardTemplate): CombatStats {
  const growthMultiplier = (1 + (card.level - 1) * 0.02) * (1 + card.enhancementLevel * 0.05);
  return {
    attack: Math.round(template.baseAttack * growthMultiplier),
    hp: Math.round(template.baseHp * growthMultiplier),
  };
}
