/**
 * 강화 단계 구간별 성공률/비용 규칙(`enhancement_rules` 컬렉션). 구간마다 문서 하나
 * (GAME_DESIGN.md 2절 기준 +0~5/+6~10/+11~15 총 3개). 등급과 무관하게 공통 적용되며,
 * 실제 도달 가능한 최대 강화 단계만 `GradeConfig`를 따른다. 구간 비교 대상은
 * {@link Card.enhancementLevel}(카드의 현재 강화 단계)이 아니라 시도해서 도달하려는
 * 목표 단계(현재 단계+1)다 — GAME_DESIGN.md의 비용 공식("100 × 목표단계")도 목표
 * 단계 기준이라 맞춰뒀다. `goldMultiplier`는 그
 * 목표 단계를 곱해야 실제 필요 골드가 나온다(예: +6 시도 시 300×6) — 구간 내에서도
 * 단계마다 비용이 달라 고정값이 아니라 배율로 저장한다.
 * @author trisakion
 */
export interface EnhancementRule {
  /** 이 규칙이 적용되는 목표 강화 단계({@link Card.enhancementLevel}+1) 구간 하한(포함) */
  minTargetEnhancementLevel: number;
  /** 이 규칙이 적용되는 목표 강화 단계({@link Card.enhancementLevel}+1) 구간 상한(포함) */
  maxTargetEnhancementLevel: number;
  /** 강화 성공 확률(0~1) */
  successRate: number;
  /** 강화 실패 시 카드가 파괴될 확률(0~1) — 이 구간에서 파괴가 없으면 0 */
  destroyOnFailChance: number;
  /** 목표 단계에 곱해 실제 필요 골드를 구하는 배율(예: 300 × 목표단계) */
  goldMultiplier: number;
  /** 시도당 필요 강화석 개수 */
  stoneCost: number;
}
