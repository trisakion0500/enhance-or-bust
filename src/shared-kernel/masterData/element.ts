/**
 * 카드/몬스터 원소 속성(3원소 상성). fire → grass → water → fire 순으로 서로 물고 문다.
 * `CardTemplate`과 `StageConfig`(몬스터) 양쪽에서 참조하므로 shared-kernel에 둔다.
 * @author trisakion
 */
export type Element = "fire" | "water" | "grass";

/** key가 value를 상대로 유리하다(공격 시 1.2배). */
const ADVANTAGE: Record<Element, Element> = { fire: "grass", grass: "water", water: "fire" };

/**
 * @param attacker 공격측 원소
 * @param defender 방어측 원소
 * @returns 유리 1.2, 불리 0.8, 그 외(동일 원소 포함) 1.0
 */
export function elementMultiplier(attacker: Element, defender: Element): number {
  if (ADVANTAGE[attacker] === defender) return 1.2;
  if (ADVANTAGE[defender] === attacker) return 0.8;
  return 1.0;
}
