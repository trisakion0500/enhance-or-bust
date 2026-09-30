import { randomUUID } from "node:crypto";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { Card } from "../../player/domain/card.js";
import type { Player } from "../../player/domain/player.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { withOptimisticRetry } from "../../../shared-kernel/optimisticPlayerWrite.js";
import { pickCustomBoxTemplate, pickGrade, pickUniformCardTemplate } from "../domain/randomBoxDraw.js";
import type { RandomBoxType } from "../domain/randomBoxType.js";
import { writeAuditLog } from "../../../shared-kernel/auditLog.js";
import { COLLECTIONS } from "../../../shared-kernel/collectionNames.js";

/** 랜덤박스 뽑기 결과 — 종류(gradeRate/custom) 무관 공통 형태.
 * @author trisakion
 */
export interface RandomBoxDrawResult {
  resultCardId: string;
  resultTemplateId: string;
  diamond: number;
}

/**
 * 등급비율(gradeRate) 상자를 다이아로 직접 뽑는다(GAME_DESIGN.md 7-1절) — 강화/합성과 동일하게
 * Player 애그리게잇 낙관적 락 재조회·재시도로 다이아 차감+카드 지급을 원자 처리한다(우편을
 * 거치지 않음).
 * @param playerId 뽑기를 시도하는 플레이어
 * @param boxId 상자 인스턴스 ID
 * @param playerRepository Player 영속성 포트
 * @returns 뽑기 결과(결과 카드, 남은 다이아)
 * @throws {BusinessException} 상자 없음/비활성(RANDOM_BOX.NOT_FOUND), 상자 확률 테이블이
 *   비어있거나 뽑힌 등급에 카드 원형이 없음(RANDOM_BOX.INTERNAL_ERROR, 운영 실수 — 재추첨/
 *   폴백 없음), 다이아 부족(ECONOMY.INSUFFICIENT_BALANCE), 재시도 초과 시 낙관적 락 충돌
 *   (COMMON.CONFLICT), 또는 같은 플레이어의 동시 요청으로 Redis 락을 못 잡으면
 *   COMMON.LOCKED(연타 방지)
 * @author trisakion
 */
export async function drawGradeRateBox(
  playerId: string,
  boxId: string,
  playerRepository: PlayerRepository,
): Promise<RandomBoxDrawResult> {
  return withOptimisticRetry(playerId, playerRepository, player => applyGradeRateDraw(player, boxId), {
    onSaved: result =>
      writeAuditLog(COLLECTIONS.LOG_RANDOM_BOX, {
        actorId: playerId,
        action: "draw",
        changes: { boxType: "gradeRate", boxId, resultCardId: result.resultCardId, resultTemplateId: result.resultTemplateId },
      }),
  });
}

/**
 * 커스텀(custom) 상자를 다이아로 직접 뽑는다(GAME_DESIGN.md 7-1절).
 * @param playerId 뽑기를 시도하는 플레이어
 * @param boxId 상자 인스턴스 ID
 * @param playerRepository Player 영속성 포트
 * @returns 뽑기 결과(결과 카드, 남은 다이아)
 * @throws {BusinessException} 상자 없음/비활성(RANDOM_BOX.NOT_FOUND), 상자 풀이 비어있음
 *   (RANDOM_BOX.INTERNAL_ERROR, 운영 실수), 다이아 부족(ECONOMY.INSUFFICIENT_BALANCE),
 *   재시도 초과 시 낙관적 락 충돌(COMMON.CONFLICT), 또는 같은 플레이어의 동시 요청으로
 *   Redis 락을 못 잡으면 COMMON.LOCKED(연타 방지)
 * @author trisakion
 */
export async function drawCustomBox(
  playerId: string,
  boxId: string,
  playerRepository: PlayerRepository,
): Promise<RandomBoxDrawResult> {
  return withOptimisticRetry(playerId, playerRepository, player => applyCustomDraw(player, boxId), {
    onSaved: result =>
      writeAuditLog(COLLECTIONS.LOG_RANDOM_BOX, {
        actorId: playerId,
        action: "draw",
        changes: { boxType: "custom", boxId, resultCardId: result.resultCardId, resultTemplateId: result.resultTemplateId },
      }),
  });
}

function applyGradeRateDraw(player: Player, boxId: string): RandomBoxDrawResult {
  const def = masterDataCache.getRandomBoxGradeRateDef(boxId);
  if (!def || !def.isActive) throw new BusinessException(ERROR_MAP.RANDOM_BOX.NOT_FOUND, { boxId });

  player.economy.deductDiamond(def.diamondCost);
  const templateId = resolveRandomBoxDraw("gradeRate", boxId);
  const card = new Card(randomUUID(), templateId);
  player.inventory.addCard(card);

  return { resultCardId: card.cardId, resultTemplateId: templateId, diamond: player.economy.diamond };
}

function applyCustomDraw(player: Player, boxId: string): RandomBoxDrawResult {
  const def = masterDataCache.getRandomBoxCustomDef(boxId);
  if (!def || !def.isActive) throw new BusinessException(ERROR_MAP.RANDOM_BOX.NOT_FOUND, { boxId });

  player.economy.deductDiamond(def.diamondCost);
  const templateId = resolveRandomBoxDraw("custom", boxId);
  const card = new Card(randomUUID(), templateId);
  player.inventory.addCard(card);

  return { resultCardId: card.cardId, resultTemplateId: templateId, diamond: player.economy.diamond };
}

/**
 * 상자 종류+ID로 실제 뽑기를 수행해 결과 카드 원형 ID를 반환한다 — 유저 직접 뽑기(다이아 소모)와
 * 우편 수령 시점 개봉(무료, `MongoMailboxRepository.claimMail()`) 양쪽에서 재사용하는 공용
 * 뽑기 로직이다. 다이아 차감/카드 지급/영속화는 호출부 책임이고, 이 함수는 순수하게
 * "무엇이 뽑혔는지"만 결정한다.
 * @param boxType 상자 종류
 * @param boxId 상자 인스턴스 ID
 * @returns 뽑힌 카드 원형 ID
 * @throws {BusinessException} 상자 없음/비활성(RANDOM_BOX.NOT_FOUND), 확률테이블/풀이 비어있거나
 *   뽑힌 등급에 카드 원형이 없음(RANDOM_BOX.INTERNAL_ERROR, 운영 실수 — 재추첨/폴백 없음)
 * @author trisakion
 */
export function resolveRandomBoxDraw(boxType: RandomBoxType, boxId: string): string {
  if (boxType === "gradeRate") {
    const def = masterDataCache.getRandomBoxGradeRateDef(boxId);
    if (!def || !def.isActive) throw new BusinessException(ERROR_MAP.RANDOM_BOX.NOT_FOUND, { boxId });

    const rateTable = masterDataCache.getRandomBoxGradeRates(boxId);
    if (rateTable.length === 0)
      throw new BusinessException(ERROR_MAP.RANDOM_BOX.INTERNAL_ERROR, { boxId, reason: "empty rate table" });

    const grade = pickGrade(rateTable);
    const candidates = masterDataCache
      .getAllCardTemplates()
      .filter(template => template.grade === grade)
      .map(template => template.templateId);
    if (candidates.length === 0)
      throw new BusinessException(ERROR_MAP.RANDOM_BOX.INTERNAL_ERROR, { boxId, grade, reason: "no card templates in grade" });

    return pickUniformCardTemplate(candidates);
  }

  const def = masterDataCache.getRandomBoxCustomDef(boxId);
  if (!def || !def.isActive) throw new BusinessException(ERROR_MAP.RANDOM_BOX.NOT_FOUND, { boxId });

  const pool = masterDataCache.getRandomBoxCustomPool(boxId);
  if (pool.length === 0)
    throw new BusinessException(ERROR_MAP.RANDOM_BOX.INTERNAL_ERROR, { boxId, reason: "empty pool" });

  return pickCustomBoxTemplate(pool);
}
