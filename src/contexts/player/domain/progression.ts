import type { Card } from "./card.js";

/** @returns 해당 레벨에서 다음 레벨로 올라가는 데 필요한 EXP(GAME_DESIGN.md 4절: 50 × level^1.5) */
function requiredExpForLevel(level: number): number {
  return Math.round(50 * level ** 1.5);
}

/** 카드 한 번의 EXP 획득 결과. */
export interface AddExpResult {
  /** 이번 EXP 획득으로 레벨이 한 번이라도 올랐는지 */
  leveledUp: boolean;
  /** 이번 EXP 획득으로 오른 레벨 수(0이면 레벨업 없음) */
  levelsGained: number;
}

/**
 * 카드에 EXP를 더하고, 필요 EXP를 채울 때마다 반복해서 레벨업시킨다(제자리 변경). 이미
 * 등급별 최대 레벨이면 EXP를 그대로 버린다 — 최대 레벨 도달 후에는 더 성장하지 않는다.
 * @param card EXP를 적용할 카드(이 인스턴스를 직접 변경한다)
 * @param expGained 획득한 EXP
 * @param maxLevel 이 카드 등급의 최대 레벨(GradeConfig.maxLevel)
 * @returns 레벨업 여부와 오른 레벨 수
 * @author trisakion
 */
export function addExp(card: Card, expGained: number, maxLevel: number): AddExpResult {
  if (card.level >= maxLevel) return { leveledUp: false, levelsGained: 0 };

  card.exp += expGained;
  let levelsGained = 0;
  while (card.level < maxLevel) {
    const required = requiredExpForLevel(card.level);
    if (card.exp < required) break;
    card.exp -= required;
    card.level += 1;
    levelsGained++;
  }
  if (card.level >= maxLevel) card.exp = 0;

  return { leveledUp: levelsGained > 0, levelsGained };
}
