import { randomUUID } from "node:crypto";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { Card } from "../../player/domain/card.js";
import type { Player } from "../../player/domain/player.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { withOptimisticRetry } from "../../../shared-kernel/optimisticPlayerWrite.js";
import { writeAuditLog } from "../../../shared-kernel/auditLog.js";
import type { GradeUpgradeSynthesisRule, EnhanceMaterialSynthesisRule } from "../domain/synthesisRule.js";

/** 등급 승급 합성 결과. 실패 시 소재 1장만 소모되고 나머지는 인벤토리에 그대로 남는다(GAME_DESIGN.md 3절). */
export interface GradeUpgradeResult {
  success: boolean;
  resultCardId?: string;
  resultTemplateId?: string;
}

/** 강화 재료 합성 결과(100% 성공, 파괴 없음). */
export interface EnhanceMaterialResult {
  enhancementLevel: number;
  gold: number;
}

/**
 * 동일 등급 카드 3장을 소모해 상위 등급 카드 승급을 시도한다(GAME_DESIGN.md 3절). 실패해도
 * 소재 중 1장만 소모되고 나머지는 환급(=애초에 제거하지 않음)된다.
 * @param playerId 합성을 시도하는 플레이어
 * @param materialCardIds 소재로 소모할 카드 ID 목록(동일 등급, 규칙이 정한 장수만큼)
 * @param playerRepository Player 영속성 포트
 * @returns 승급 결과(성공 시 결과 카드 ID/원형 포함)
 * @throws {BusinessException} 검증 실패, 카드/마스터데이터 Not Found, 승급 가능한 상위 등급 없음,
 *   재시도 초과 시 낙관적 락 충돌(COMMON.CONFLICT), 또는 같은 플레이어의 동시 요청으로
 *   Redis 락을 못 잡으면 COMMON.LOCKED(연타 방지)
 * @author trisakion
 */
export async function synthesizeGradeUpgrade(
  playerId: string,
  materialCardIds: string[],
  playerRepository: PlayerRepository,
): Promise<GradeUpgradeResult> {
  return withOptimisticRetry(playerId, playerRepository, player => applyGradeUpgrade(player, materialCardIds), {
    onSaved: result =>
      writeAuditLog("synthesis_logs", {
        actorId: playerId,
        action: "gradeUpgrade",
        changes: { materialCardIds, success: result.success, resultCardId: result.resultCardId, resultTemplateId: result.resultTemplateId },
      }),
  });
}

/**
 * 대상 카드 외 동일 원형 카드 N장 + 골드를 소모해 대상 카드의 강화 단계를 +1 시킨다(100% 성공,
 * 파괴 없음, GAME_DESIGN.md 3절). Enhancement 컨텍스트의 확률적 강화와는 별개 경로다.
 * @param playerId 합성을 시도하는 플레이어
 * @param targetCardId 강화 단계를 올릴 대상 카드
 * @param materialCardIds 대상 카드와 동일 원형인, 소모할 재료 카드 ID 목록(대상 카드 제외)
 * @param playerRepository Player 영속성 포트
 * @returns 결과 강화 단계와 남은 골드
 * @throws {BusinessException} 검증 실패, 카드/마스터데이터 Not Found, 이미 최대 강화 단계,
 *   재화 부족, 재시도 초과 시 낙관적 락 충돌(COMMON.CONFLICT), 또는 같은 플레이어의 동시
 *   요청으로 Redis 락을 못 잡으면 COMMON.LOCKED(연타 방지)
 * @author trisakion
 */
export async function synthesizeEnhanceMaterial(
  playerId: string,
  targetCardId: string,
  materialCardIds: string[],
  playerRepository: PlayerRepository,
): Promise<EnhanceMaterialResult> {
  return withOptimisticRetry(playerId, playerRepository, player => applyEnhanceMaterial(player, targetCardId, materialCardIds), {
    onSaved: result =>
      writeAuditLog("synthesis_logs", {
        actorId: playerId,
        action: "enhanceMaterial",
        changes: { targetCardId, materialCardIds, enhancementLevel: result.enhancementLevel },
      }),
  });
}

/** 소재 카드 ID 목록을 조회해 카드 엔티티 배열로 반환한다. 중복 ID나 미보유 카드는 검증 실패로 처리한다. */
function resolveMaterialCards(player: Player, materialCardIds: string[]): Card[] {
  if (new Set(materialCardIds).size !== materialCardIds.length)
    throw new BusinessException(ERROR_MAP.SYNTHESIS.VALIDATION_FAILED, { materialCardIds });

  return materialCardIds.map(cardId => {
    const card = player.inventory.findCard(cardId);
    if (!card) throw new BusinessException(ERROR_MAP.SYNTHESIS.NOT_FOUND, { cardId });
    return card;
  });
}

function applyGradeUpgrade(player: Player, materialCardIds: string[]): GradeUpgradeResult {
  const materials = resolveMaterialCards(player, materialCardIds);

  const templates = materials.map(card => {
    const template = masterDataCache.getCardTemplate(card.templateId);
    if (!template) throw new BusinessException(ERROR_MAP.SYNTHESIS.INTERNAL_ERROR, { templateId: card.templateId });
    return template;
  });

  const grade = templates[0].grade;
  if (templates.some(template => template.grade !== grade))
    throw new BusinessException(ERROR_MAP.SYNTHESIS.VALIDATION_FAILED, { materialCardIds, reason: "grade mismatch" });

  const rule = masterDataCache
    .getSynthesisRules()
    .find((r): r is GradeUpgradeSynthesisRule => r.type === "gradeUpgrade" && r.sourceGrade === grade);
  if (!rule) throw new BusinessException(ERROR_MAP.SYNTHESIS.NO_UPGRADE_PATH, { grade });
  if (materials.length !== rule.materialCount)
    throw new BusinessException(ERROR_MAP.SYNTHESIS.VALIDATION_FAILED, { materialCardIds, expected: rule.materialCount });

  if (Math.random() >= rule.successRate) {
    player.inventory.removeCard(materialCardIds[0]);
    return { success: false };
  }

  for (const cardId of materialCardIds) player.inventory.removeCard(cardId);

  const resultTemplates = masterDataCache.getCardTemplatesByGrade(rule.resultGrade);
  if (resultTemplates.length === 0) throw new BusinessException(ERROR_MAP.SYNTHESIS.INTERNAL_ERROR, { resultGrade: rule.resultGrade });
  const resultTemplate = resultTemplates[Math.floor(Math.random() * resultTemplates.length)];

  const resultCard = new Card(randomUUID(), resultTemplate.templateId);
  player.inventory.addCard(resultCard);

  return { success: true, resultCardId: resultCard.cardId, resultTemplateId: resultCard.templateId };
}

function applyEnhanceMaterial(player: Player, targetCardId: string, materialCardIds: string[]): EnhanceMaterialResult {
  if (materialCardIds.includes(targetCardId))
    throw new BusinessException(ERROR_MAP.SYNTHESIS.VALIDATION_FAILED, { targetCardId, materialCardIds, reason: "target in materials" });

  const target = player.inventory.findCard(targetCardId);
  if (!target) throw new BusinessException(ERROR_MAP.SYNTHESIS.NOT_FOUND, { cardId: targetCardId });

  const template = masterDataCache.getCardTemplate(target.templateId);
  if (!template) throw new BusinessException(ERROR_MAP.SYNTHESIS.INTERNAL_ERROR, { templateId: target.templateId });
  const gradeConfig = masterDataCache.getGradeConfig(template.grade);
  if (!gradeConfig) throw new BusinessException(ERROR_MAP.SYNTHESIS.INTERNAL_ERROR, { grade: template.grade });

  if (target.enhancementLevel >= gradeConfig.maxEnhancementLevel)
    throw new BusinessException(ERROR_MAP.SYNTHESIS.MAX_LEVEL_REACHED, { targetCardId, enhancementLevel: target.enhancementLevel });

  const rule = masterDataCache
    .getSynthesisRules()
    .find((r): r is EnhanceMaterialSynthesisRule => r.type === "enhanceMaterial");
  if (!rule) throw new BusinessException(ERROR_MAP.SYNTHESIS.INTERNAL_ERROR, { reason: "enhanceMaterial rule missing" });

  const materials = resolveMaterialCards(player, materialCardIds);
  if (materials.length !== rule.materialCount)
    throw new BusinessException(ERROR_MAP.SYNTHESIS.VALIDATION_FAILED, { materialCardIds, expected: rule.materialCount });
  if (materials.some(card => card.templateId !== target.templateId))
    throw new BusinessException(ERROR_MAP.SYNTHESIS.VALIDATION_FAILED, { materialCardIds, reason: "template mismatch" });

  player.economy.deductGold(rule.goldCost);
  for (const cardId of materialCardIds) player.inventory.removeCard(cardId);
  target.enhancementLevel += 1;

  return { enhancementLevel: target.enhancementLevel, gold: player.economy.gold };
}
