import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { config } from "../../../config/env.js";
import { mongoLogClient } from "../../../infra/mongoLog.js";
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

/** gm_platform이 조회할 때 컬렉션 하나에서 한 번에 반환할 최대 로그 건수 — 무제한 스캔 방지. */
const GM_LOG_LIST_LIMIT = 200;

/**
 * GM 운영자가 조회하는 감사 로그 한 건. `changes.*`는 컬렉션/액션마다 필드가 달라(예:
 * log_synthesis의 gradeUpgrade/enhanceMaterial) 고정 필드로 선언하지 않고 인덱스 시그니처로
 * 열어둔다 — {@link flattenChanges}가 채운 점(`.`) 표기 키가 실제 필드명이다.
 */
export type GmLogEntry = {
  actorId: string;
  action: string;
  occurredAt: Date;
} & Record<string, unknown>;

/**
 * 중첩 객체를 gm_platform 그리드가 1차원으로 그릴 수 있도록 점(`.`) 표기 키로 재귀
 * 평탄화한다(`toSummary()`의 `economy.gold` 평탄화와 동일 원칙 — 여기서는 필드 종류가
 * 컬렉션/액션마다 달라 수동 나열 대신 재귀로 일반화). 배열은 그리드 셀에 콤마 목록으로
 * 표시돼도 무방해 더 내려가지 않고 값 그대로 둔다.
 * @param obj 평탄화할 객체
 * @param prefix 재귀 호출 중 누적되는 키 접두사
 * @returns 점 표기 키로 평탄화된 객체
 * @author trisakion
 */
function flattenChanges(obj: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const flatKey = `${prefix}.${key}`;
    if (value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date))
      Object.assign(result, flattenChanges(value as Record<string, unknown>, flatKey));
    else
      result[flatKey] = value;
  }
  return result;
}

/**
 * gm_platform이 playerId(+선택적 기간)로 조회하는 감사 로그(`log_auth` 등) — 컬렉션별 export
 * 함수 5개가 이 헬퍼를 재사용한다. playerId 오타로 "로그가 없다"와 "플레이어가 없다"가
 * 헷갈리지 않도록 조회 전에 플레이어 존재를 먼저 확인한다(`getPlayerCardsForGm`과 동일 원칙).
 * @param collection 조회할 로그 컬렉션 이름
 * @param playerId 조회할 플레이어 ID
 * @param playerRepository Player 영속성 포트
 * @param fromDate 조회 시작 일시(포함, ISO 8601 문자열, 선택)
 * @param toDate 조회 종료 일시(포함, ISO 8601 문자열, 선택)
 * @returns occurredAt 내림차순, 최대 GM_LOG_LIST_LIMIT건
 * @throws {BusinessException} 플레이어가 없으면 GM.NOT_FOUND, 날짜 형식이 올바르지 않으면 GM.VALIDATION_FAILED
 * @author trisakion
 */
async function getAuditLogsForGm(
  collection: string,
  playerId: string,
  playerRepository: PlayerRepository,
  fromDate?: string,
  toDate?: string,
): Promise<GmLogEntry[]> {
  const player = await playerRepository.findById(playerId);
  if (!player) throw new BusinessException(ERROR_MAP.GM.NOT_FOUND, { playerId });

  const occurredAt: Record<string, Date> = {};
  if (fromDate !== undefined) {
    const from = new Date(fromDate);
    if (Number.isNaN(from.getTime())) throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { fromDate });
    occurredAt.$gte = from;
  }
  if (toDate !== undefined) {
    const to = new Date(toDate);
    if (Number.isNaN(to.getTime())) throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { toDate });
    occurredAt.$lte = to;
  }

  const docs = await mongoLogClient
    .db(config.mongoAppDatabaseLog)
    .collection<{ actorId: string; action: string; changes: Record<string, unknown>; occurredAt: Date }>(collection)
    .find({ actorId: playerId, ...(Object.keys(occurredAt).length ? { occurredAt } : {}) })
    .sort({ occurredAt: -1 })
    .limit(GM_LOG_LIST_LIMIT)
    .toArray();

  return docs.map(({ actorId, action, changes, occurredAt }) => ({
    actorId,
    action,
    occurredAt,
    ...flattenChanges(changes, "changes"),
  }));
}

/** @returns log_auth 로그 목록 @author trisakion */
export function getAuthLogsForGm(playerId: string, playerRepository: PlayerRepository, fromDate?: string, toDate?: string): Promise<GmLogEntry[]> {
  return getAuditLogsForGm("log_auth", playerId, playerRepository, fromDate, toDate);
}

/** @returns log_enhancement 로그 목록 @author trisakion */
export function getEnhancementLogsForGm(playerId: string, playerRepository: PlayerRepository, fromDate?: string, toDate?: string): Promise<GmLogEntry[]> {
  return getAuditLogsForGm("log_enhancement", playerId, playerRepository, fromDate, toDate);
}

/** @returns log_synthesis 로그 목록 @author trisakion */
export function getSynthesisLogsForGm(playerId: string, playerRepository: PlayerRepository, fromDate?: string, toDate?: string): Promise<GmLogEntry[]> {
  return getAuditLogsForGm("log_synthesis", playerId, playerRepository, fromDate, toDate);
}

/** @returns log_battle_stage 로그 목록 @author trisakion */
export function getBattleStageLogsForGm(playerId: string, playerRepository: PlayerRepository, fromDate?: string, toDate?: string): Promise<GmLogEntry[]> {
  return getAuditLogsForGm("log_battle_stage", playerId, playerRepository, fromDate, toDate);
}

/** @returns log_mailbox 로그 목록 @author trisakion */
export function getMailboxLogsForGm(playerId: string, playerRepository: PlayerRepository, fromDate?: string, toDate?: string): Promise<GmLogEntry[]> {
  return getAuditLogsForGm("log_mailbox", playerId, playerRepository, fromDate, toDate);
}
