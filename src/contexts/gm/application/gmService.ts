import type { Db } from "mongodb";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { COLLECTIONS } from "../../../shared-kernel/collectionNames.js";
import { config } from "../../../config/env.js";
import { mongoLogClient } from "../../../infra/mongoLog.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { bumpMasterDataVersion } from "../../../shared-kernel/masterData/masterDataVersion.js";
import type { CardTemplate } from "../../../shared-kernel/masterData/cardTemplate.js";
import type { Grade } from "../../../shared-kernel/masterData/grade.js";
import type { Element } from "../../../shared-kernel/masterData/element.js";
import type { GradeConfig } from "../../../shared-kernel/masterData/gradeConfig.js";
import type { AttendanceBookDef } from "../../attendance/domain/attendanceBookDef.js";
import type { AttendanceCatchupPrice } from "../../attendance/domain/attendanceCatchupPrice.js";
import type { AttendanceReward } from "../../attendance/domain/attendanceReward.js";
import {
  findBookDefByDefId,
  findBookDefById,
  findCatchupPriceRows,
  findOverlappingGeneralDef,
  findRewardRows,
  renameDefIdInRows,
  replaceRewardRowsForDay,
  updateBookDefById,
  upsertBookDef,
  upsertCatchupPriceRow,
} from "../../attendance/infrastructure/attendanceStore.js";
import type { EnhancementRule } from "../../enhancement/domain/enhancementRule.js";
import type { GradeUpgradeSynthesisRule, EnhanceMaterialSynthesisRule, SynthesisRule } from "../../synthesis/domain/synthesisRule.js";
import type { StageConfig } from "../../battleStage/domain/stageConfig.js";
import type { CardDropRuleDoc } from "../../battleStage/domain/cardDrop.js";
import type { Player } from "../../player/domain/player.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";

/** playerId 없이 전체 조회할 때 한 번에 반환할 최대 인원 — 무제한 컬렉션 스캔 방지. */
const GM_PLAYER_LIST_LIMIT = 200;

/** GM 운영자가 조회하는 플레이어 요약.
 * @author trisakion
 */
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

/** GM 운영자가 조회하는 플레이어 보유 카드 한 장 — 마스터 데이터(카드 원형) 조인 포함.
 * @author trisakion
 */
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
 * gm_platform이 조회하는 시드데이터(마스터데이터) 9종 — 컬렉션을 그대로 덤프한다.
 * 이제 전부 저장 API가 있다(아래 {@link saveCardTemplatesForGm}/{@link saveGradeConfigsForGm}/
 * {@link saveEnhancementRulesForGm}/{@link saveSynthesisRulesForGm}/{@link saveStageConfigsForGm}/
 * {@link saveStageCardDropsForGm} 및 출석부 저장 함수 3종).
 * @returns 전체 카드 원형 목록
 * @author trisakion
 * @modified 2026-09-17 trisakion 출석부 정의/보상/캐치업가격 GM 조회 3종 추가로 "6종"→"9종" 문구 갱신
 * @modified 2026-09-29 trisakion 카드 원형 저장 API(saveCardTemplatesForGm) 추가로 "조회만 지원" 대상에서 카드 원형 제외
 * @modified 2026-09-29 trisakion 강화 규칙 저장 API(saveEnhancementRulesForGm) 추가로 "조회만 지원" 대상에서 강화 규칙 제외
 * @modified 2026-09-30 trisakion 등급 설정 저장 API(saveGradeConfigsForGm) 추가로 "조회만 지원" 대상에서 등급 설정 제외
 * @modified 2026-09-30 trisakion 스테이지 카드 드랍 저장 API(saveStageCardDropsForGm) 추가로 "조회만 지원" 대상에서 스테이지 카드 드랍 제외
 * @modified 2026-09-30 trisakion 스테이지 설정 저장 API(saveStageConfigsForGm) 추가로 "조회만 지원" 대상에서 스테이지 설정 제외
 * @modified 2026-09-30 trisakion 합성 규칙 저장 API(saveSynthesisRulesForGm) 추가로 "조회만 지원" 대상 완전 소진(9종 전부 저장 지원)
 */
export function getCardTemplatesForGm(): CardTemplate[] {
  return masterDataCache.getAllCardTemplates();
}

/** gm_platform이 `POST /gm/save-card-templates`로 보내는 카드 원형 저장 행 하나.
 * @author trisakion
 */
export interface CardTemplateSaveRow {
  templateId: string;
  grade: Grade;
  element: Element;
  baseAttack: number;
  baseHp: number;
}

/** 카드 원형이 삭제 후보일 때 아직 쓰이고 있는지 확인하는 참조처 목록 — 하나라도 걸리면 삭제 불가.
 * @author trisakion
 */
const CARD_TEMPLATE_REFERENCE_CHECKS: Array<(db: Db, templateId: string) => Promise<boolean>> = [
  async (db, templateId) => (await db.collection(COLLECTIONS.PLAYERS).findOne({ "inventory.templateId": templateId })) !== null,
  async (db, templateId) => (await db.collection(COLLECTIONS.MASTER_STAGE_CARD_DROPS).findOne({ templateId })) !== null,
  async (db, templateId) => (await db.collection(COLLECTIONS.MASTER_ATTENDANCE_REWARDS).findOne({ cardTemplateId: templateId })) !== null,
];

/**
 * 카드 원형(`master_card_templates`) 전체를 `data` 배열 기준으로 교체 저장한다
 * (`POST /gm/save-card-templates`) — payload에 있는 templateId는 추가/수정(upsert)하고,
 * 없는 기존 templateId는 삭제 후보로 본다. 삭제 후보 중 하나라도 아직 참조되는 중이면
 * (플레이어 보유 카드/스테이지 카드 드랍/출석 보상) 아무것도 쓰지 않고 즉시
 * GM.REFERENCED_CANNOT_DELETE로 거부한다 — 운영자가 그 카드를 payload에서 빼지 않도록
 * 되돌리거나 참조를 먼저 정리한 뒤 재시도해야 한다.
 * @param db 메인 앱 DB 핸들
 * @param rows 저장할 카드 원형 전체(이 컬렉션의 최종 상태로 취급)
 * @returns 저장 후 전체 카드 원형 목록
 * @throws {BusinessException} 행 검증 실패/templateId 중복 시 GM.VALIDATION_FAILED,
 *   삭제 후보가 참조 중이면 GM.REFERENCED_CANNOT_DELETE
 * @author trisakion
 */
export async function saveCardTemplatesForGm(db: Db, rows: CardTemplateSaveRow[]): Promise<CardTemplate[]> {
  const payloadIds = rows.map(row => row.templateId);
  if (new Set(payloadIds).size !== payloadIds.length)
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { rows });

  const collection = db.collection<CardTemplate>(COLLECTIONS.MASTER_CARD_TEMPLATES);
  const existingIds = await collection.distinct("templateId");
  const payloadIdSet = new Set(payloadIds);
  const deleteCandidates = existingIds.filter(id => !payloadIdSet.has(id));

  for (const templateId of deleteCandidates) {
    for (const isReferenced of CARD_TEMPLATE_REFERENCE_CHECKS) {
      if (await isReferenced(db, templateId))
        throw new BusinessException(ERROR_MAP.GM.REFERENCED_CANNOT_DELETE, { templateId });
    }
  }

  await Promise.all(rows.map(row => collection.updateOne({ templateId: row.templateId }, { $set: row }, { upsert: true })));
  if (deleteCandidates.length > 0) await collection.deleteMany({ templateId: { $in: deleteCandidates } });
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_CARD_TEMPLATES);

  return collection.find({}, { projection: { _id: 0 } }).toArray() as Promise<CardTemplate[]>;
}

/**
 * @returns 전체 등급 설정 목록
 * @author trisakion
 */
export function getGradeConfigsForGm(): GradeConfig[] {
  return masterDataCache.getAllGradeConfigs();
}

/** gm_platform이 `POST /gm/save-grade-configs`로 보내는 등급 설정 저장 행 하나. `grade` 값은
 * gm_platform 쪽에서도 카드 원형(`save-card-templates`)의 등급 컬럼과 동일한 공통코드
 * 그룹(`CARD_GRADE`)을 참조하도록 등록해, 두 화면에서 등급 표기가 갈리지 않게 한다.
 * @author trisakion
 */
export interface GradeConfigSaveRow {
  grade: Grade;
  maxLevel: number;
  maxEnhancementLevel: number;
}

/** 등급 설정이 반드시 포함해야 하는 등급 전체 집합 — `Grade` 타입 자체가 고정된 4종
 * 리터럴이라(`grade.ts`), 카드 원형/강화 규칙과 달리 이 컬렉션은 행을 추가하거나 지울 수
 * 없다. 하나라도 빠지면 그 등급 카드의 강화/합성/레벨업 시도마다 하는
 * `masterDataCache.getGradeConfig()` 조회가 실패해 즉시 INTERNAL_ERROR로 막힌다.
 */
const REQUIRED_GRADES: Grade[] = ["N", "R", "SR", "SSR"];

/**
 * 등급 설정(`master_grade_configs`) 전체를 저장한다(`POST /gm/save-grade-configs`) — 카드
 * 원형/강화 규칙의 "전체 교체(삭제 후보 판단)"와 달리 **순수 upsert**다. `grade`가 고정된
 * 4종 리터럴이라 행을 추가/삭제할 수 없고, payload는 항상 N/R/SR/SSR을 정확히 하나씩만
 * 포함해야 한다 — 누락/중복/모르는 값은 전부 GM.VALIDATION_FAILED로 거부한다.
 * maxLevel/maxEnhancementLevel 자체의 형식 검증(양의 정수 등)은 라우트
 * (`parseGradeConfigsSave()`)가 맡는다.
 * @param db 메인 앱 DB 핸들
 * @param rows 저장할 등급 설정 전체(반드시 N/R/SR/SSR 4행)
 * @returns 저장 후 전체 등급 설정 목록
 * @throws {BusinessException} N/R/SR/SSR 4종 집합과 정확히 일치하지 않으면 GM.VALIDATION_FAILED
 * @author trisakion
 */
export async function saveGradeConfigsForGm(db: Db, rows: GradeConfigSaveRow[]): Promise<GradeConfig[]> {
  const grades = rows.map(row => row.grade);
  const isExactRequiredSet = grades.length === REQUIRED_GRADES.length
    && new Set(grades).size === grades.length
    && REQUIRED_GRADES.every(grade => grades.includes(grade));
  if (!isExactRequiredSet)
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { rows });

  const collection = db.collection<GradeConfig>(COLLECTIONS.MASTER_GRADE_CONFIGS);
  await Promise.all(rows.map(row => collection.updateOne({ grade: row.grade }, { $set: row }, { upsert: true })));
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_GRADE_CONFIGS);

  return collection.find({}, { projection: { _id: 0 } }).toArray() as Promise<GradeConfig[]>;
}

/**
 * @returns 전체 강화 규칙 목록
 * @author trisakion
 */
export function getEnhancementRulesForGm(): EnhancementRule[] {
  return masterDataCache.getAllEnhancementRules();
}

/** gm_platform이 `POST /gm/save-enhancement-rules`로 보내는 강화 규칙 저장 행 하나.
 * @author trisakion
 */
export interface EnhancementRuleSaveRow {
  minTargetEnhancementLevel: number;
  maxTargetEnhancementLevel: number;
  successRate: number;
  destroyOnFailChance: number;
  goldMultiplier: number;
  stoneCost: number;
}

/**
 * 강화 규칙(`master_enhancement_rules`) 전체를 `data` 배열 기준으로 교체 저장한다
 * (`POST /gm/save-enhancement-rules`) — 카드 원형과 달리 다른 컬렉션이 이 규칙을 ID로
 * 참조하지 않는다(강화 시도 시점에 목표 단계로 즉석 조회할 뿐, {@link
 * masterDataCache.getEnhancementRuleFor}) — 그래서 삭제 가드가 필요 없고 순수 전체
 * 교체(upsert + 빠진 행 삭제)만 한다. `minTargetEnhancementLevel`을 자연키로 삼아
 * upsert/삭제 후보를 가르며, 이 값이 중복이거나 구간이 서로 겹치면(예: 1~10과 5~8)
 * GM.VALIDATION_FAILED로 거부한다 — `getEnhancementRuleFor()`가 배열 `find()`로 첫
 * 매치만 쓰기 때문에 구간이 겹치면 실제로 어떤 규칙이 적용될지 예측할 수 없어진다.
 * @param db 메인 앱 DB 핸들
 * @param rows 저장할 강화 규칙 전체(이 컬렉션의 최종 상태로 취급)
 * @returns 저장 후 전체 강화 규칙 목록
 * @throws {BusinessException} 행 검증 실패/자연키 중복/구간 겹침 시 GM.VALIDATION_FAILED
 * @author trisakion
 */
export async function saveEnhancementRulesForGm(db: Db, rows: EnhancementRuleSaveRow[]): Promise<EnhancementRule[]> {
  const keys = rows.map(row => row.minTargetEnhancementLevel);
  if (new Set(keys).size !== keys.length)
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { rows });

  const sortedByMin = [...rows].sort((a, b) => a.minTargetEnhancementLevel - b.minTargetEnhancementLevel);
  for (let i = 1; i < sortedByMin.length; i++) {
    if (sortedByMin[i].minTargetEnhancementLevel <= sortedByMin[i - 1].maxTargetEnhancementLevel)
      throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { rows });
  }

  const collection = db.collection<EnhancementRule>(COLLECTIONS.MASTER_ENHANCEMENT_RULES);
  const existingKeys = await collection.distinct("minTargetEnhancementLevel");
  const keySet = new Set(keys);
  const deleteCandidates = existingKeys.filter(key => !keySet.has(key));

  await Promise.all(rows.map(row => collection.updateOne({ minTargetEnhancementLevel: row.minTargetEnhancementLevel }, { $set: row }, { upsert: true })));
  if (deleteCandidates.length > 0) await collection.deleteMany({ minTargetEnhancementLevel: { $in: deleteCandidates } });
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_ENHANCEMENT_RULES);

  return collection.find({}, { projection: { _id: 0 } }).toArray() as Promise<EnhancementRule[]>;
}

/**
 * @returns 전체 합성 규칙 목록
 * @author trisakion
 */
export function getSynthesisRulesForGm(): readonly SynthesisRule[] {
  return masterDataCache.getSynthesisRules();
}

/** gm_platform이 `POST /gm/save-synthesis-rules`로 보내는 합성 규칙 저장 행 하나 — `domain/synthesisRule.ts`의
 * 판별 유니온을 그대로 재사용한다(DB 저장 형태와 완전히 동일해 별도 필드 매핑이 필요 없음).
 * @author trisakion
 */
export type SynthesisRuleSaveRow = SynthesisRule;

/** 등급 승급 합성이 반드시 포함해야 하는 sourceGrade 집합 — SSR은 더 승급할 상위 등급이
 * 없어 대상에서 제외된다(등급 설정의 `REQUIRED_GRADES`와 달리 4종이 아니라 3종). */
const REQUIRED_GRADE_UPGRADE_SOURCE_GRADES: Grade[] = ["N", "R", "SR"];

/** sourceGrade별로 허용되는 유일한 resultGrade — GAME_DESIGN.md 3절의 "동일 등급 3장 →
 * 상위 등급 1장" 순서(N→R→SR→SSR)를 코드로 고정한다. GM이 자유롭게 resultGrade를 지정하면
 * N 3장으로 SSR을 만드는 등 설계와 어긋난 조합이 저장될 수 있어, materialCount/successRate만
 * 튜닝 가능하게 하고 승급 경로 자체는 잠근다(2026-09-30 AskUserQuestion으로 확인한 결정). */
const NEXT_GRADE: Record<Grade, Grade | undefined> = { N: "R", R: "SR", SR: "SSR", SSR: undefined };

/**
 * 합성 규칙(`master_synthesis_rules`) 전체를 저장한다(`POST /gm/save-synthesis-rules`) — 등급
 * 설정과 같은 이유(고정된 리터럴 집합이라 행을 추가/삭제할 수 없음)로 **순수 upsert**다.
 * payload는 항상 gradeUpgrade 3행(sourceGrade N/R/SR 각 하나씩, resultGrade는 {@link NEXT_GRADE}
 * 순서 고정) + enhanceMaterial 1행, 정확히 4행이어야 한다 — 집합이 안 맞거나 resultGrade가
 * 고정 순서와 다르면 전부 GM.VALIDATION_FAILED로 거부한다. materialCount/successRate/goldCost
 * 자체의 형식 검증(범위/정수)은 라우트(`parseSynthesisRulesSave()`)가 맡는다. 자연키는
 * gradeUpgrade는 `sourceGrade`, enhanceMaterial은 `type`(싱글턴) — 둘 다 다른 컬렉션이
 * ID로 참조하지 않아(합성 시도 시점에 즉석 조회할 뿐, {@link masterDataCache.getSynthesisRules})
 * 삭제 가드는 필요 없다.
 * @param db 메인 앱 DB 핸들
 * @param rows 저장할 합성 규칙 전체(항상 gradeUpgrade 3행 + enhanceMaterial 1행)
 * @returns 저장 후 전체 합성 규칙 목록
 * @throws {BusinessException} 필요한 행 집합과 정확히 일치하지 않거나 resultGrade가 고정
 *   순서와 다르면 GM.VALIDATION_FAILED
 * @author trisakion
 */
export async function saveSynthesisRulesForGm(db: Db, rows: SynthesisRuleSaveRow[]): Promise<SynthesisRule[]> {
  const gradeUpgradeRows = rows.filter((row): row is GradeUpgradeSynthesisRule => row.type === "gradeUpgrade");
  const enhanceMaterialRows = rows.filter((row): row is EnhanceMaterialSynthesisRule => row.type === "enhanceMaterial");
  const sourceGrades = gradeUpgradeRows.map(row => row.sourceGrade);

  const isExactRequiredSet = rows.length === REQUIRED_GRADE_UPGRADE_SOURCE_GRADES.length + 1
    && enhanceMaterialRows.length === 1
    && new Set(sourceGrades).size === sourceGrades.length
    && REQUIRED_GRADE_UPGRADE_SOURCE_GRADES.every(grade => sourceGrades.includes(grade));
  if (!isExactRequiredSet)
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { rows });

  for (const row of gradeUpgradeRows) {
    if (row.resultGrade !== NEXT_GRADE[row.sourceGrade])
      throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { row });
  }

  const collection = db.collection<SynthesisRule>(COLLECTIONS.MASTER_SYNTHESIS_RULES);
  await Promise.all(gradeUpgradeRows.map(row =>
    collection.updateOne({ type: "gradeUpgrade", sourceGrade: row.sourceGrade }, { $set: row }, { upsert: true }),
  ));
  await collection.updateOne({ type: "enhanceMaterial" }, { $set: enhanceMaterialRows[0] }, { upsert: true });
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_SYNTHESIS_RULES);

  return collection.find({}, { projection: { _id: 0 } }).toArray() as Promise<SynthesisRule[]>;
}

/**
 * @returns 전체 스테이지 설정 목록
 * @author trisakion
 */
export function getStageConfigsForGm(): StageConfig[] {
  return masterDataCache.getAllStageConfigs();
}

/** gm_platform이 `POST /gm/save-stage-configs`로 보내는 스테이지 설정 저장 행 하나.
 * @author trisakion
 */
export interface StageConfigSaveRow {
  stageId: number;
  monsterHp: number;
  monsterAttack: number;
  monsterDefense: number;
  monsterElement: Element;
  rewardGold: number;
  rewardExp: number;
  enhancementStoneDropRate: number;
  enhancementStoneMin: number;
  enhancementStoneMax: number;
  farmRewardRate: number;
  cardDropRateFirstClear: number;
  cardDropRateFarm: number;
}

/**
 * 스테이지 설정(`master_stage_configs`) 전체를 `data` 배열 기준으로 교체 저장한다
 * (`POST /gm/save-stage-configs`) — 카드 원형과 같은 전체 교체 방식(upsert + 빠진 행 삭제)이며,
 * 삭제 후보가 아직 스테이지 카드 드랍(`master_stage_card_drops`)에서 참조되고 있으면(고아 드랍
 * 행 방지, {@link saveStageCardDropsForGm}이 저장 시점에 검증하는 것과 같은 불변조건을 반대
 * 방향에서 지킨다) 아무것도 쓰지 않고 GM.REFERENCED_CANNOT_DELETE로 거부한다. 자연키는
 * `stageId` 단일 필드이며 중복은 GM.VALIDATION_FAILED로 막는다. 필드 형식 검증(범위/enum)은
 * 라우트(`parseStageConfigsSave()`)가 맡는다.
 * @param db 메인 앱 DB 핸들
 * @param rows 저장할 스테이지 설정 전체(이 컬렉션의 최종 상태로 취급)
 * @returns 저장 후 전체 스테이지 설정 목록
 * @throws {BusinessException} stageId 중복 시 GM.VALIDATION_FAILED, 삭제 후보가 카드 드랍에서
 *   참조 중이면 GM.REFERENCED_CANNOT_DELETE
 * @author trisakion
 */
export async function saveStageConfigsForGm(db: Db, rows: StageConfigSaveRow[]): Promise<StageConfig[]> {
  const stageIds = rows.map(row => row.stageId);
  if (new Set(stageIds).size !== stageIds.length)
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { rows });

  const collection = db.collection<StageConfig>(COLLECTIONS.MASTER_STAGE_CONFIGS);
  const existingIds = await collection.distinct("stageId");
  const idSet = new Set(stageIds);
  const deleteCandidates = existingIds.filter(id => !idSet.has(id));

  const cardDropCollection = db.collection(COLLECTIONS.MASTER_STAGE_CARD_DROPS);
  for (const stageId of deleteCandidates) {
    if ((await cardDropCollection.findOne({ stageId })) !== null)
      throw new BusinessException(ERROR_MAP.GM.REFERENCED_CANNOT_DELETE, { stageId });
  }

  await Promise.all(rows.map(row => collection.updateOne({ stageId: row.stageId }, { $set: row }, { upsert: true })));
  if (deleteCandidates.length > 0) await collection.deleteMany({ stageId: { $in: deleteCandidates } });
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_STAGE_CONFIGS);

  return collection.find({}, { projection: { _id: 0 } }).toArray() as Promise<StageConfig[]>;
}

/**
 * @returns 전체 스테이지 카드 드랍 규칙 목록
 * @author trisakion
 */
export function getStageCardDropsForGm(): CardDropRuleDoc[] {
  return masterDataCache.getAllCardDropRules();
}

/** gm_platform이 `POST /gm/save-stage-card-drops`로 보내는 스테이지 카드 드랍 저장 행 하나.
 * @author trisakion
 */
export interface StageCardDropSaveRow {
  stageId: number;
  templateId: string;
  weight: number;
}

/**
 * 스테이지 카드 드랍(`master_stage_card_drops`) 전체를 `data` 배열 기준으로 교체 저장한다
 * (`POST /gm/save-stage-card-drops`) — 카드 원형과 같은 전체 교체 방식(upsert + 빠진 행
 * 삭제)이지만, 이 행 자체를 참조하는 다른 컬렉션이 없어(스테이지 클리어 시점에 즉석 조회할
 * 뿐, {@link masterDataCache.getCardDropTable}) 삭제 가드는 필요 없다 — 강화 규칙과 동일한
 * 이유. 자연키는 `(stageId, templateId)`이며 중복을 GM.VALIDATION_FAILED로 막는다. 또한
 * stageId는 `master_stage_configs`에, templateId는 `master_card_templates`에 실제로 있는
 * 값이어야 한다 — 존재하지 않는 스테이지/카드 원형을 가리키는 고아 드랍 행을 막기 위함
 * (출석부 보상 저장의 cardTemplateId 존재 검증과 동일 원칙). weight 자체의 형식 검증(양수)은
 * 라우트(`parseStageCardDropsSave()`)가 맡는다.
 * @param db 메인 앱 DB 핸들
 * @param rows 저장할 스테이지 카드 드랍 전체(이 컬렉션의 최종 상태로 취급)
 * @returns 저장 후 전체 스테이지 카드 드랍 목록
 * @throws {BusinessException} 자연키 중복/존재하지 않는 stageId·templateId 참조 시 GM.VALIDATION_FAILED
 * @author trisakion
 */
export async function saveStageCardDropsForGm(db: Db, rows: StageCardDropSaveRow[]): Promise<CardDropRuleDoc[]> {
  const keyOf = (row: { stageId: number; templateId: string }): string => `${row.stageId}:${row.templateId}`;
  const keys = rows.map(keyOf);
  if (new Set(keys).size !== keys.length)
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { rows });

  for (const row of rows) {
    if (!masterDataCache.getStageConfig(row.stageId) || !masterDataCache.getCardTemplate(row.templateId))
      throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { row });
  }

  const collection = db.collection<CardDropRuleDoc>(COLLECTIONS.MASTER_STAGE_CARD_DROPS);
  const existing = await collection.find({}, { projection: { _id: 0, stageId: 1, templateId: 1 } }).toArray();
  const keySet = new Set(keys);
  const deleteCandidates = existing.filter(doc => !keySet.has(keyOf(doc)));

  await Promise.all(rows.map(row => collection.updateOne({ stageId: row.stageId, templateId: row.templateId }, { $set: row }, { upsert: true })));
  if (deleteCandidates.length > 0)
    await collection.deleteMany({ $or: deleteCandidates.map(({ stageId, templateId }) => ({ stageId, templateId })) });
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_STAGE_CARD_DROPS);

  return collection.find({}, { projection: { _id: 0 } }).toArray() as Promise<CardDropRuleDoc[]>;
}

/**
 * @returns 전체 출석부 정의 목록
 * @author trisakion
 */
export function getAttendanceDefsForGm(): AttendanceBookDef[] {
  return masterDataCache.getAllAttendanceBookDefs();
}

/**
 * @param defId 조회 범위를 좁힐 출석부 정의 ID(선택 — 없으면 전체 반환)
 * @returns defId를 지정하면 해당 defId의 날짜별 보상 행만, 아니면 전체 목록
 * @author trisakion
 */
export function getAttendanceRewardsForGm(defId?: string): AttendanceReward[] {
  return defId ? masterDataCache.getAttendanceRewards(defId) : masterDataCache.getAllAttendanceRewards();
}

/**
 * @param defId 조회 범위를 좁힐 출석부 정의 ID(선택 — 없으면 전체 반환)
 * @returns defId를 지정하면 해당 defId의 캐치업 회차별 가격 행만, 아니면 전체 목록
 * @author trisakion
 */
export function getAttendanceCatchupPricesForGm(defId?: string): AttendanceCatchupPrice[] {
  return defId ? masterDataCache.getAttendanceCatchupPrices(defId) : masterDataCache.getAllAttendanceCatchupPrices();
}

/** gm_platform이 `POST /gm/save-attendance-def`로 보내는 저장 요청 — def 본문만 담는다. 날짜별
 * 보상/캐치업 가격은 별도 API(`save-attendance-rewards`/`save-attendance-catchup-prices`)로
 * 나눠 저장한다(출석부 저장 → 보상 저장 → 캐치업 가격 저장 순서). `id`가 있으면 수정(내부 PK로
 * 대상 식별), 없으면 신규 등록.
 * @author trisakion
 */
export interface AttendanceBookDefSaveInput {
  id?: string;
  defId: string;
  name: string;
  type: AttendanceBookDef["type"];
  targetAudience: AttendanceBookDef["targetAudience"];
  returningInactiveDays?: number;
  maxRotationCount: number;
  enrollableStart: Date;
  enrollableEnd: Date;
  durationDays: number;
  catchupMaxCount: number;
}

/**
 * 출석부 정의 본문만 등록/수정한다(`POST /gm/save-attendance-def`) — 신규 def는 append-only 등록,
 * 기존 def 수정은 아직 시작 전(`enrollableStart` 이전)인 경우만 허용한다
 * (23_GAME_DESIGN_ATTENDANCE.md "핵심 원칙 — 시드 스냅샷"/"gm_platform 관리 규칙 요약" 절).
 * 검증 순서: (1) targetAudience=RETURNING_USER면 returningInactiveDays 필수 → 그 외 값은
 * 저장 시 무시(정책 문서가 "구현 시 택일"로 열어둔 부분, 무시 쪽으로 결정) (2) 수정인데
 * 대상 없음 → ATTENDANCE.NOT_FOUND, 이미 시작됨 → DEF_LOCKED (3) defId가 이미 다른 문서에서
 * 쓰이는 중 → DEF_DUPLICATE (4) GENERAL이면 다른 GENERAL def와 기간 겹침 → DEF_OVERLAP.
 * 보상/캐치업 행과의 일치 검증(`durationDays`/`catchupMaxCount`)은 여기서 하지 않는다 — 행은
 * 별도 API로 나중에 저장되므로 이 시점엔 비교할 대상이 없고, 기존 행이 있는 def의
 * `durationDays`를 바꾸는 수정도 막으면 "def를 먼저 고쳐야 행을 다시 저장할 수 있는" 순환이 된다.
 * 일치 검증은 행을 저장하는 쪽(`saveAttendanceRewardsForGm`/`saveAttendanceCatchupPricesForGm`)이
 * 맡는다. defId 자체를 바꾸는 수정이면 기존 보상/캐치업 행의 defId도 함께 바꾼다(고아 행 방지,
 * `renameDefIdInRows()` 참고).
 * @param db 메인 앱 DB 핸들
 * @param input 저장할 출석부 정의
 * @returns 저장된 출석부 정의(내부 PK 포함)
 * @throws {BusinessException} 위 검증 순서 참고
 * @author trisakion
 */
export async function saveAttendanceBookDefForGm(db: Db, input: AttendanceBookDefSaveInput): Promise<AttendanceBookDef> {
  if (input.targetAudience === "RETURNING_USER" && input.returningInactiveDays === undefined)
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { input });

  const existing = input.id ? await findBookDefById(db, input.id) : null;
  if (input.id && !existing)
    throw new BusinessException(ERROR_MAP.ATTENDANCE.NOT_FOUND, { input });
  if (existing && existing.enrollableStart.getTime() <= Date.now())
    throw new BusinessException(ERROR_MAP.ATTENDANCE.DEF_LOCKED, { input });

  if (!existing || existing.defId !== input.defId) {
    const conflict = await findBookDefByDefId(db, input.defId);
    if (conflict)
      throw new BusinessException(ERROR_MAP.ATTENDANCE.DEF_DUPLICATE, { input });
  }

  if (input.type === "GENERAL") {
    const overlap = await findOverlappingGeneralDef(db, input.enrollableStart, input.enrollableEnd, existing?._id);
    if (overlap)
      throw new BusinessException(ERROR_MAP.ATTENDANCE.DEF_OVERLAP, { input });
  }

  const bookDefFields: Omit<AttendanceBookDef, "_id" | "createdAt" | "updatedAt"> = {
    defId: input.defId,
    name: input.name,
    type: input.type,
    targetAudience: input.targetAudience,
    maxRotationCount: input.maxRotationCount,
    enrollableStart: input.enrollableStart,
    enrollableEnd: input.enrollableEnd,
    durationDays: input.durationDays,
    catchupMaxCount: input.catchupMaxCount,
    ...(input.targetAudience === "RETURNING_USER" ? { returningInactiveDays: input.returningInactiveDays } : {}),
  };

  if (existing) {
    await updateBookDefById(db, existing._id, bookDefFields);
    if (existing.defId !== input.defId)
      await renameDefIdInRows(db, existing.defId, input.defId);
  } else {
    await upsertBookDef(db, bookDefFields);
  }

  return (await findBookDefByDefId(db, input.defId))!;
}

/**
 * 보상/캐치업 행 저장이 공통으로 쓰는 선행 검증 — 출석부가 존재하고 아직 시작 전인지 확인하고
 * 그 정의를 반환한다.
 * @param db 메인 앱 DB 핸들
 * @param defId 대상 출석부 비즈니스 키
 * @returns 저장 대상 출석부 정의
 * @throws {BusinessException} 없으면 ATTENDANCE.NOT_FOUND, 이미 시작됐으면 DEF_LOCKED
 * @author trisakion
 */
async function findEditableBookDef(db: Db, defId: string): Promise<AttendanceBookDef> {
  const def = await findBookDefByDefId(db, defId);
  if (!def)
    throw new BusinessException(ERROR_MAP.ATTENDANCE.NOT_FOUND, { defId });
  if (def.enrollableStart.getTime() <= Date.now())
    throw new BusinessException(ERROR_MAP.ATTENDANCE.DEF_LOCKED, { defId });
  return def;
}

/** `POST /gm/save-attendance-rewards`가 받는 하루치 보상 — gm_platform 입력칸이 배열을 못 다뤄서 아이템
 * 종류별 수량 칸으로 나눴다. 0/생략은 "그 아이템 없음", 카드는 원형+장수를 함께 준다(하루 카드 1종).
 * @author trisakion
 */
export interface AttendanceDayRewardInput {
  day: number;
  gold: number;
  enhancementStone: number;
  diamond: number;
  cardTemplateId?: string;
  cardCount: number;
}

/**
 * 출석부의 한 일차 보상을 통째로 교체 저장한다(`POST /gm/save-attendance-rewards`) — 그 일차의 기존 행은
 * 전부 지우고 입력값으로 다시 채우며(전부 0이면 그 일차 보상 삭제), 다른 일차는 건드리지 않는다.
 * 검증: 출석부 존재/시작 전, `day`가 1~`durationDays` 정수(범위 밖은 DEF_MISMATCH), 수량은 0 이상 정수,
 * 카드는 원형과 장수(1 이상)가 함께 있어야 하고 원형은 실제 카드 마스터에 있어야 함(VALIDATION_FAILED).
 * 보상 행 전체가 1~`durationDays`를 다 채웠는지는 여기서 강제하지 않는다 — 하루씩 저장하는 구조상
 * 저장 시점에 알 수 없어, 운영자가 조회 그리드로 확인한다.
 * @param db 메인 앱 DB 핸들
 * @param defId 대상 출석부 비즈니스 키
 * @param input 그 일차의 보상 입력값
 * @returns 저장 후 그 출석부의 보상 행 전체(day 오름차순)
 * @throws {BusinessException} NOT_FOUND / DEF_LOCKED / DEF_MISMATCH / VALIDATION_FAILED
 * @author trisakion
 */
export async function saveAttendanceRewardsForGm(db: Db, defId: string, input: AttendanceDayRewardInput): Promise<AttendanceReward[]> {
  const def = await findEditableBookDef(db, defId);

  if (!Number.isInteger(input.day) || input.day < 1 || input.day > def.durationDays)
    throw new BusinessException(ERROR_MAP.ATTENDANCE.DEF_MISMATCH, { defId, durationDays: def.durationDays, day: input.day });

  const amounts = [input.gold, input.enhancementStone, input.diamond, input.cardCount];
  if (amounts.some(amount => !Number.isInteger(amount) || amount < 0))
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { input });
  if (input.cardTemplateId ? input.cardCount < 1 || !masterDataCache.getCardTemplate(input.cardTemplateId) : input.cardCount > 0)
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { input });

  const rows: Array<Omit<AttendanceReward, "_id" | "defId" | "day">> = [];
  if (input.gold > 0) rows.push({ itemType: "gold", amount: input.gold, cardTemplateId: null });
  if (input.enhancementStone > 0) rows.push({ itemType: "enhancementStone", amount: input.enhancementStone, cardTemplateId: null });
  if (input.diamond > 0) rows.push({ itemType: "diamond", amount: input.diamond, cardTemplateId: null });
  if (input.cardTemplateId) rows.push({ itemType: "card", amount: input.cardCount, cardTemplateId: input.cardTemplateId });

  await replaceRewardRowsForDay(db, defId, input.day, rows);
  return findRewardRows(db, defId);
}

/**
 * 출석부의 캐치업 가격 1회차분을 저장한다(`POST /gm/save-attendance-catchup-prices`) — 그 회차가 없으면
 * 만들고 있으면 가격만 바꾼다. 검증: 출석부 존재/시작 전, `purchaseIndex`가 1~`catchupMaxCount` 정수
 * (범위 밖은 DEF_MISMATCH), `price`는 0 이상 정수(VALIDATION_FAILED). 모든 회차를 다 채웠는지는 여기서
 * 강제하지 않는다(회차별 저장 구조상 저장 시점에 알 수 없음 — 조회 그리드로 확인).
 * @param db 메인 앱 DB 핸들
 * @param defId 대상 출석부 비즈니스 키
 * @param purchaseIndex 저장할 구매 회차(1-based)
 * @param price 골드 가격
 * @returns 저장 후 그 출석부의 캐치업 가격 행 전체(purchaseIndex 오름차순)
 * @throws {BusinessException} NOT_FOUND / DEF_LOCKED / DEF_MISMATCH / VALIDATION_FAILED
 * @author trisakion
 */
export async function saveAttendanceCatchupPricesForGm(db: Db, defId: string, purchaseIndex: number, price: number): Promise<AttendanceCatchupPrice[]> {
  const def = await findEditableBookDef(db, defId);

  if (!Number.isInteger(purchaseIndex) || purchaseIndex < 1 || purchaseIndex > def.catchupMaxCount)
    throw new BusinessException(ERROR_MAP.ATTENDANCE.DEF_MISMATCH, { defId, catchupMaxCount: def.catchupMaxCount, purchaseIndex });
  if (!Number.isInteger(price) || price < 0)
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { price });

  await upsertCatchupPriceRow(db, defId, purchaseIndex, price);
  return findCatchupPriceRows(db, defId);
}

/** gm_platform이 조회할 때 컬렉션 하나에서 한 번에 반환할 최대 로그 건수 — 무제한 스캔 방지. */
const GM_LOG_LIST_LIMIT = 200;

/**
 * GM 운영자가 조회하는 감사 로그 한 건. `changes.*`는 컬렉션/액션마다 필드가 달라(예:
 * log_synthesis의 gradeUpgrade/enhanceMaterial) 고정 필드로 선언하지 않고 인덱스 시그니처로
 * 열어둔다 — {@link flattenChanges}가 채운 점(`.`) 표기 키가 실제 필드명이다.
 * @author trisakion
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

/**
 * @param playerId 조회할 플레이어 ID
 * @param playerRepository Player 영속성 포트
 * @param fromDate 조회 시작 일시(포함, ISO 8601 문자열, 선택)
 * @param toDate 조회 종료 일시(포함, ISO 8601 문자열, 선택)
 * @returns log_auth 로그 목록
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 */
export function getAuthLogsForGm(playerId: string, playerRepository: PlayerRepository, fromDate?: string, toDate?: string): Promise<GmLogEntry[]> {
  return getAuditLogsForGm(COLLECTIONS.LOG_AUTH, playerId, playerRepository, fromDate, toDate);
}

/**
 * @param playerId 조회할 플레이어 ID
 * @param playerRepository Player 영속성 포트
 * @param fromDate 조회 시작 일시(포함, ISO 8601 문자열, 선택)
 * @param toDate 조회 종료 일시(포함, ISO 8601 문자열, 선택)
 * @returns log_enhancement 로그 목록
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 */
export function getEnhancementLogsForGm(playerId: string, playerRepository: PlayerRepository, fromDate?: string, toDate?: string): Promise<GmLogEntry[]> {
  return getAuditLogsForGm(COLLECTIONS.LOG_ENHANCEMENT, playerId, playerRepository, fromDate, toDate);
}

/**
 * @param playerId 조회할 플레이어 ID
 * @param playerRepository Player 영속성 포트
 * @param fromDate 조회 시작 일시(포함, ISO 8601 문자열, 선택)
 * @param toDate 조회 종료 일시(포함, ISO 8601 문자열, 선택)
 * @returns log_synthesis 로그 목록
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 */
export function getSynthesisLogsForGm(playerId: string, playerRepository: PlayerRepository, fromDate?: string, toDate?: string): Promise<GmLogEntry[]> {
  return getAuditLogsForGm(COLLECTIONS.LOG_SYNTHESIS, playerId, playerRepository, fromDate, toDate);
}

/**
 * @param playerId 조회할 플레이어 ID
 * @param playerRepository Player 영속성 포트
 * @param fromDate 조회 시작 일시(포함, ISO 8601 문자열, 선택)
 * @param toDate 조회 종료 일시(포함, ISO 8601 문자열, 선택)
 * @returns log_battle_stage 로그 목록
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 */
export function getBattleStageLogsForGm(playerId: string, playerRepository: PlayerRepository, fromDate?: string, toDate?: string): Promise<GmLogEntry[]> {
  return getAuditLogsForGm(COLLECTIONS.LOG_BATTLE_STAGE, playerId, playerRepository, fromDate, toDate);
}

/**
 * @param playerId 조회할 플레이어 ID
 * @param playerRepository Player 영속성 포트
 * @param fromDate 조회 시작 일시(포함, ISO 8601 문자열, 선택)
 * @param toDate 조회 종료 일시(포함, ISO 8601 문자열, 선택)
 * @returns log_mailbox 로그 목록
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 */
export function getMailboxLogsForGm(playerId: string, playerRepository: PlayerRepository, fromDate?: string, toDate?: string): Promise<GmLogEntry[]> {
  return getAuditLogsForGm(COLLECTIONS.LOG_MAILBOX, playerId, playerRepository, fromDate, toDate);
}

/**
 * @param playerId 조회할 플레이어 ID
 * @param playerRepository Player 영속성 포트
 * @param fromDate 조회 시작 일시(포함, ISO 8601 문자열, 선택)
 * @param toDate 조회 종료 일시(포함, ISO 8601 문자열, 선택)
 * @returns log_attendance 로그 목록(attend/catchup_purchase/issue/reset 액션 혼재)
 * @author trisakion
 */
export function getAttendanceLogsForGm(playerId: string, playerRepository: PlayerRepository, fromDate?: string, toDate?: string): Promise<GmLogEntry[]> {
  return getAuditLogsForGm(COLLECTIONS.LOG_ATTENDANCE, playerId, playerRepository, fromDate, toDate);
}
