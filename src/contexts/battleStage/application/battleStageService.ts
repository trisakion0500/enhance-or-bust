import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import type { Player } from "../../player/domain/player.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { addExp } from "../../player/domain/progression.js";
import { computeCombatStats } from "../domain/combatStats.js";
import { simulateBattle } from "../domain/battleSimulator.js";
import type { RoundLog } from "../domain/battleSimulator.js";

/** 낙관적 락 충돌 시 재조회 후 재시도할 최대 횟수(강화/합성 API와 동일한 정책). */
const MAX_OPTIMISTIC_LOCK_RETRIES = 5;

/** 출전 스쿼드 최대 장수 — 초기 표준값(TBD). */
const SQUAD_MAX_SIZE = 5;

/** 출전 카드 1장이 이번 전투로 얻은 EXP 결과. */
export interface ExpGainResult {
  /** EXP를 얻은 카드 ID */
  cardId: string;
  /** 이번에 지급된 EXP(파밍이면 farmRewardRate만큼 축소된 값) */
  exp: number;
  /** 이 카드가 이번 EXP 획득으로 레벨업했는지 */
  leveledUp: boolean;
  /** 이 카드가 이번에 오른 레벨 수(0이면 레벨업 없음) */
  levelsGained: number;
}

/** 스테이지 클리어 시도 결과. */
export interface ClearStageResult {
  /** 승리 여부 */
  won: boolean;
  /** 라운드별 진행 로그 */
  rounds: RoundLog[];
  /** 이번에 지급된 골드(패배 시 0) */
  rewardGold: number;
  /** 이번에 지급된 강화석(드랍 실패 또는 패배 시 0) */
  rewardEnhancementStone: number;
  /** 출전 카드별 EXP 획득 결과(패배 시 빈 배열) */
  expGained: ExpGainResult[];
  /** 이 시도 이후 플레이어의 최종 clearedStage(최초 클리어가 아니면 변화 없음) */
  clearedStage: number;
  /** 이 시도 이후 플레이어의 최종 보유 골드 */
  gold: number;
  /** 이 시도 이후 플레이어의 최종 보유 강화석 */
  enhancementStone: number;
}

/**
 * 스테이지에 출전 스쿼드로 도전한다(GAME_DESIGN.md 6절 개정안). 서버가 카드 스탯으로 직접
 * 전투를 시뮬레이션해 판정하며, 패배 시에는 상태 변경이 없어 저장을 생략한다.
 * @param playerId 도전하는 플레이어
 * @param stageId 도전할 스테이지 번호
 * @param squadCardIds 출전시킬 카드 ID 목록(1~5장, 보유 카드 중에서)
 * @param playerRepository Player 영속성 포트
 * @returns 전투 결과(승패, 라운드 로그, 보상)
 * @throws {BusinessException} 검증 실패, 아직 도전 불가능한 스테이지(STAGE_LOCKED), 카드/스테이지
 *   Not Found, 또는 재시도 초과 시 낙관적 락 충돌(COMMON.CONFLICT)
 * @author trisakion
 */
export async function clearStage(
  playerId: string,
  stageId: number,
  squadCardIds: string[],
  playerRepository: PlayerRepository,
): Promise<ClearStageResult> {
  for (let attempt = 0; attempt < MAX_OPTIMISTIC_LOCK_RETRIES; attempt++) {
    const player = await playerRepository.findById(playerId);
    if (!player) throw new BusinessException(ERROR_MAP.COMMON.NOT_FOUND, { playerId });

    const { result, mutated } = applyClearStage(player, stageId, squadCardIds);
    if (!mutated) return result;

    try {
      await playerRepository.save(player);
      return result;
    } catch (err) {
      if (!(err instanceof BusinessException) || err.entry !== ERROR_MAP.COMMON.CONFLICT) throw err;
    }
  }

  throw new BusinessException(ERROR_MAP.COMMON.CONFLICT, { playerId, stageId });
}

/**
 * 스테이지 클리어 시도 한 번을 `player`에 적용한다 — 순수 계산 + 애그리게잇 상태 변경까지만
 * 하고, 영속화(재시도 포함)는 호출부({@link clearStage})가 책임진다.
 * @param player 도전할 플레이어(승리 시 이 인스턴스를 직접 변경한다)
 * @param stageId 도전할 스테이지 번호
 * @param squadCardIds 출전시킬 카드 ID 목록
 * @returns 응답으로 돌려줄 결과와, 실제로 `player`가 변경돼 저장이 필요한지 여부(패배 시 false)
 */
function applyClearStage(player: Player, stageId: number, squadCardIds: string[]): { result: ClearStageResult; mutated: boolean } {
  if (squadCardIds.length === 0 || squadCardIds.length > SQUAD_MAX_SIZE || new Set(squadCardIds).size !== squadCardIds.length)
    throw new BusinessException(ERROR_MAP.BATTLE_STAGE.VALIDATION_FAILED, { squadCardIds });

  if (stageId > player.clearedStage + 1)
    throw new BusinessException(ERROR_MAP.BATTLE_STAGE.STAGE_LOCKED, { stageId, clearedStage: player.clearedStage });

  const stage = masterDataCache.getStageConfig(stageId);
  if (!stage) throw new BusinessException(ERROR_MAP.BATTLE_STAGE.NOT_FOUND, { stageId });

  const squad = squadCardIds.map(cardId => {
    const card = player.inventory.findCard(cardId);
    if (!card) throw new BusinessException(ERROR_MAP.BATTLE_STAGE.NOT_FOUND, { cardId });
    const template = masterDataCache.getCardTemplate(card.templateId);
    if (!template) throw new BusinessException(ERROR_MAP.BATTLE_STAGE.INTERNAL_ERROR, { templateId: card.templateId });
    return { card, template, ...computeCombatStats(card, template) };
  });

  const battle = simulateBattle(
    squad.map(member => ({ cardId: member.card.cardId, attack: member.attack, hp: member.hp, element: member.template.element })),
    { hp: stage.monsterHp, attack: stage.monsterAttack, defense: stage.monsterDefense, element: stage.monsterElement },
  );

  if (!battle.won) {
    return {
      mutated: false,
      result: {
        won: false,
        rounds: battle.rounds,
        rewardGold: 0,
        rewardEnhancementStone: 0,
        expGained: [],
        clearedStage: player.clearedStage,
        gold: player.economy.gold,
        enhancementStone: player.economy.enhancementStone,
      },
    };
  }

  const isFirstClear = stageId === player.clearedStage + 1;
  const rate = isFirstClear ? 1 : stage.farmRewardRate;

  const rewardGold = Math.round(stage.rewardGold * rate);
  player.economy.addGold(rewardGold);

  let rewardEnhancementStone = 0;
  if (Math.random() < stage.enhancementStoneDropRate) {
    const amount = stage.enhancementStoneMin + Math.floor(Math.random() * (stage.enhancementStoneMax - stage.enhancementStoneMin + 1));
    rewardEnhancementStone = Math.round(amount * rate);
    player.economy.addEnhancementStone(rewardEnhancementStone);
  }

  const expPerCard = Math.round(stage.rewardExp * rate);
  const expGained = squad.map(({ card, template }) => {
    const gradeConfig = masterDataCache.getGradeConfig(template.grade);
    if (!gradeConfig) throw new BusinessException(ERROR_MAP.BATTLE_STAGE.INTERNAL_ERROR, { grade: template.grade });
    const { leveledUp, levelsGained } = addExp(card, expPerCard, gradeConfig.maxLevel);
    return { cardId: card.cardId, exp: expPerCard, leveledUp, levelsGained };
  });

  if (isFirstClear) player.clearedStage = stageId;

  return {
    mutated: true,
    result: {
      won: true,
      rounds: battle.rounds,
      rewardGold,
      rewardEnhancementStone,
      expGained,
      clearedStage: player.clearedStage,
      gold: player.economy.gold,
      enhancementStone: player.economy.enhancementStone,
    },
  };
}
