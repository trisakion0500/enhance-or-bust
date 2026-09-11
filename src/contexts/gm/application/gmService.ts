import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import type { CardTemplate } from "../../../shared-kernel/masterData/cardTemplate.js";
import type { GradeConfig } from "../../../shared-kernel/masterData/gradeConfig.js";
import type { EnhancementRule } from "../../enhancement/domain/enhancementRule.js";
import type { SynthesisRule } from "../../synthesis/domain/synthesisRule.js";
import type { StageConfig } from "../../battleStage/domain/stageConfig.js";
import type { CardDropRuleDoc } from "../../battleStage/domain/cardDrop.js";
import type { Player } from "../../player/domain/player.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";

/** playerId 없이 전체 조회할 때 한 번에 반환할 최대 인원 — 무제한 컬렉션 스캔 방지. */
const GM_PLAYER_LIST_LIMIT = 200;

/** GM 운영자가 조회하는 플레이어 요약. */
export interface GmPlayerSummary {
  playerId: string;
  name: string;
  platformType: string;
  platformUserId: string;
  "economy.gold": number;
  "economy.enhancementStone": number;
  "economy.diamond": number;
  clearedStage: number;
  cardCount: number;
}

/** @param player 변환할 도메인 애그리게잇 */
function toSummary(player: Player): GmPlayerSummary {
  return {
    playerId: player.playerId,
    name: player.name,
    platformType: player.platformType,
    platformUserId: player.platformUserId,
    "economy.gold": player.economy.gold,
    "economy.enhancementStone": player.economy.enhancementStone,
    "economy.diamond": player.economy.diamond,
    clearedStage: player.clearedStage,
    cardCount: player.inventory.getCards().length,
  };
}

/**
 * gm_platform이 임의 playerId로 조회하는 플레이어 요약 — 세션 인증(`GET /player/me`)과 달리
 * 본인 확인이 아니라 X-API-Key로 인증된 GM 운영자의 조회라 platformType/platformUserId도 포함한다.
 * @param playerId 조회할 플레이어 ID
 * @param playerRepository Player 영속성 포트
 * @returns 플레이어 요약
 * @throws {BusinessException} 존재하지 않으면 GM.NOT_FOUND
 * @author trisakion
 */
export async function getPlayerForGm(playerId: string, playerRepository: PlayerRepository): Promise<GmPlayerSummary> {
  const player = await playerRepository.findById(playerId);
  if (!player) throw new BusinessException(ERROR_MAP.GM.NOT_FOUND, { playerId });
  return toSummary(player);
}

/**
 * gm_platform이 playerId 없이 호출했을 때 전체 플레이어를 조회한다(`GM_PLAYER_LIST_LIMIT`까지).
 * @param playerRepository Player 영속성 포트
 * @returns 플레이어 요약 목록
 * @author trisakion
 */
export async function listPlayersForGm(playerRepository: PlayerRepository): Promise<GmPlayerSummary[]> {
  const players = await playerRepository.findAll(GM_PLAYER_LIST_LIMIT);
  return players.map(toSummary);
}

/** GM 운영자가 조회하는 플레이어 보유 카드 한 장 — 마스터 데이터(카드 원형) 조인 포함. */
export interface GmCardSummary {
  cardId: string;
  templateId: string;
  grade: string;
  baseAttack: number;
  baseHp: number;
  element: string;
  level: number;
  exp: number;
  enhancementLevel: number;
}

/**
 * gm_platform이 playerId로 조회하는 플레이어 보유 카드 목록. `playerService.ts`의
 * `getPlayerSummary()` 인벤토리 조인과 동일 셰이프 — GM 조회도 등급/스탯까지 봐야
 * 유용해 마스터 데이터를 여기서도 다시 조인한다.
 * @param playerId 조회할 플레이어 ID
 * @param playerRepository Player 영속성 포트
 * @returns 보유 카드 목록
 * @throws {BusinessException} 플레이어가 없으면 GM.NOT_FOUND
 * @author trisakion
 */
export async function getPlayerCardsForGm(playerId: string, playerRepository: PlayerRepository): Promise<GmCardSummary[]> {
  const player = await playerRepository.findById(playerId);
  if (!player) throw new BusinessException(ERROR_MAP.GM.NOT_FOUND, { playerId });

  return player.inventory.getCards().map(card => {
    const template = masterDataCache.getCardTemplate(card.templateId);
    if (!template) throw new BusinessException(ERROR_MAP.GM.INTERNAL_ERROR, { templateId: card.templateId });
    return {
      cardId: card.cardId,
      templateId: card.templateId,
      grade: template.grade,
      baseAttack: template.baseAttack,
      baseHp: template.baseHp,
      element: template.element,
      level: card.level,
      exp: card.exp,
      enhancementLevel: card.enhancementLevel,
    };
  });
}

/**
 * gm_platform이 조회하는 시드데이터(마스터데이터) 6종 — 컬렉션을 그대로 덤프한다.
 * 1차는 조회만 지원하고 수정/삭제는 아직 없다(밸런스 데이터라 잘못 저장되면 파급이 커서
 * 별도 검증 설계 후 추가 예정).
 * @returns 전체 카드 원형 목록
 * @author trisakion
 */
export function getCardTemplatesForGm(): CardTemplate[] {
  return masterDataCache.getAllCardTemplates();
}

/**
 * @returns 전체 등급 설정 목록
 * @author trisakion
 */
export function getGradeConfigsForGm(): GradeConfig[] {
  return masterDataCache.getAllGradeConfigs();
}

/**
 * @returns 전체 강화 규칙 목록
 * @author trisakion
 */
export function getEnhancementRulesForGm(): EnhancementRule[] {
  return masterDataCache.getAllEnhancementRules();
}

/**
 * @returns 전체 합성 규칙 목록
 * @author trisakion
 */
export function getSynthesisRulesForGm(): readonly SynthesisRule[] {
  return masterDataCache.getSynthesisRules();
}

/**
 * @returns 전체 스테이지 설정 목록
 * @author trisakion
 */
export function getStageConfigsForGm(): StageConfig[] {
  return masterDataCache.getAllStageConfigs();
}

/**
 * @returns 전체 스테이지 카드 드랍 규칙 목록
 * @author trisakion
 */
export function getStageCardDropsForGm(): CardDropRuleDoc[] {
  return masterDataCache.getAllCardDropRules();
}
