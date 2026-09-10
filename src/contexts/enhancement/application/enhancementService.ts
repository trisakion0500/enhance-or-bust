import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import type { Player } from "../../player/domain/player.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { withOptimisticRetry } from "../../../shared-kernel/optimisticPlayerWrite.js";
import { writeAuditLog } from "../../../shared-kernel/auditLog.js";

/** 강화 한 번 시도 결과. */
export interface EnhanceResult {
  /** 이번 시도의 강화 성공 여부 */
  success: boolean;
  /** 카드가 파괴됐는지(+11~15 구간 실패 시에만 10% 확률로 발생) */
  destroyed: boolean;
  /** 시도 후 카드의 강화 단계(파괴됐으면 시도 직전 단계 그대로) */
  enhancementLevel: number;
  /** 시도 후 남은 골드 */
  gold: number;
  /** 시도 후 남은 강화석 */
  enhancementStone: number;
}

/**
 * 카드 강화를 한 번 시도한다(GAME_DESIGN.md 2절 확률/비용 표 기준). 재화는 성공/실패와 무관하게
 * 시도 시점에 소모되고, +11~15 구간 실패 시에만 10% 확률로 카드가 파괴된다.
 * @param playerId 강화를 시도하는 플레이어
 * @param cardId 강화 대상 카드
 * @param playerRepository Player 영속성 포트
 * @returns 강화 결과(성공/파괴 여부, 결과 강화 단계, 남은 재화)
 * @throws {BusinessException} 플레이어/카드/마스터데이터 Not Found, 최대 강화 단계 도달, 재화 부족,
 *   재시도 초과 시 낙관적 락 충돌(COMMON.CONFLICT), 또는 같은 플레이어의 동시 요청으로
 *   Redis 락을 못 잡으면 COMMON.LOCKED(연타 방지)
 * @author trisakion
 */
export async function enhanceCard(playerId: string, cardId: string, playerRepository: PlayerRepository): Promise<EnhanceResult> {
  return withOptimisticRetry(playerId, playerRepository, player => applyEnhanceAttempt(player, cardId), {
    onSaved: result =>
      writeAuditLog("enhancement_logs", {
        actorId: playerId,
        action: "attempt",
        changes: { cardId, success: result.success, destroyed: result.destroyed, enhancementLevel: result.enhancementLevel },
      }),
  });
}

/**
 * 카드 한 장에 강화 규칙을 적용해 `player`를 제자리에서 변경한다 — 순수 계산 + 애그리게잇 상태
 * 변경까지만 하고, 영속화(재시도 포함)는 호출부({@link enhanceCard})가 책임진다.
 * @param player 강화를 시도할 플레이어(이 인스턴스를 직접 변경한다)
 * @param cardId 강화 대상 카드
 */
function applyEnhanceAttempt(player: Player, cardId: string): EnhanceResult {
  const card = player.inventory.findCard(cardId);
  if (!card) throw new BusinessException(ERROR_MAP.INVENTORY.NOT_FOUND, { cardId });

  const template = masterDataCache.getCardTemplate(card.templateId);
  if (!template) throw new BusinessException(ERROR_MAP.ENHANCEMENT.INTERNAL_ERROR, { templateId: card.templateId });

  const gradeConfig = masterDataCache.getGradeConfig(template.grade);
  if (!gradeConfig) throw new BusinessException(ERROR_MAP.ENHANCEMENT.INTERNAL_ERROR, { grade: template.grade });

  if (card.enhancementLevel >= gradeConfig.maxEnhancementLevel)
    throw new BusinessException(ERROR_MAP.ENHANCEMENT.MAX_LEVEL_REACHED, { cardId, enhancementLevel: card.enhancementLevel });

  const targetLevel = card.enhancementLevel + 1;
  const rule = masterDataCache.getEnhancementRuleFor(targetLevel);
  if (!rule) throw new BusinessException(ERROR_MAP.ENHANCEMENT.INTERNAL_ERROR, { targetLevel });

  player.economy.deductGold(rule.goldMultiplier * targetLevel);
  player.economy.deductEnhancementStone(rule.stoneCost);

  if (Math.random() < rule.successRate) {
    card.enhancementLevel = targetLevel;
    return {
      success: true,
      destroyed: false,
      enhancementLevel: card.enhancementLevel,
      gold: player.economy.gold,
      enhancementStone: player.economy.enhancementStone,
    };
  }

  const destroyed = Math.random() < rule.destroyOnFailChance;
  if (destroyed) player.inventory.removeCard(cardId);

  return {
    success: false,
    destroyed,
    enhancementLevel: card.enhancementLevel,
    gold: player.economy.gold,
    enhancementStone: player.economy.enhancementStone,
  };
}
