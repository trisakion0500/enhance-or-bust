import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import type { PlayerRepository } from "../domain/playerRepository.js";

/**
 * 인벤토리 카드 한 장을 카드 원형(마스터 데이터)과 조인한 요약. 프론트가 별도로 마스터
 * 데이터를 조회하지 않아도 되도록 서버가 미리 조인해 내려준다.
 * @author trisakion
 */
export interface CardSummary {
  /** 카드 인스턴스 고유 ID */
  cardId: string;
  /** 원형(CardTemplate) 참조 ID */
  templateId: string;
  /** 카드 등급(마스터 데이터에서 조인) */
  grade: string;
  /** 기본 공격력(마스터 데이터에서 조인, 레벨/강화 성장 미반영) */
  baseAttack: number;
  /** 기본 체력(마스터 데이터에서 조인, 레벨/강화 성장 미반영) */
  baseHp: number;
  /** 원소 속성(마스터 데이터에서 조인) */
  element: string;
  /** 현재 레벨 */
  level: number;
  /** 현재 레벨에서 누적된 EXP */
  exp: number;
  /** 강화 단계(+0~15) */
  enhancementLevel: number;
}

/**
 * 플레이어 자기 자신의 상태 요약 — `GET /player/me` 응답 셰이프.
 * @author trisakion
 */
export interface PlayerSummary {
  /** 닉네임 */
  name: string;
  /** 프로필 사진 URL — 구글 프로필에 없으면 undefined */
  picture: string | undefined;
  /** 보유 재화 */
  economy: { gold: number; enhancementStone: number; diamond: number };
  /** 클리어한 최대 스테이지 */
  clearedStage: number;
  /** 보유 카드 목록(마스터 데이터 조인 포함) */
  inventory: CardSummary[];
}

/**
 * 로그인한 플레이어 자신의 상태(재화/clearedStage/보유 카드)를 조회한다. 인벤토리 각 카드는
 * `masterDataCache`의 카드 원형과 조인해 등급/공격력/체력/속성까지 포함시킨다 — 프론트가
 * 별도 마스터 데이터 엔드포인트 없이 이 응답 하나로 인벤토리 화면을 그릴 수 있게 하기 위함.
 * @param playerId 조회할 플레이어(세션에서 이미 검증된 값)
 * @param playerRepository Player 영속성 포트
 * @returns 플레이어 상태 요약
 * @throws {BusinessException} 세션은 유효한데 플레이어 문서가 없는 이례적 상황이면 COMMON.NOT_FOUND
 * @author trisakion
 */
export async function getPlayerSummary(playerId: string, playerRepository: PlayerRepository): Promise<PlayerSummary> {
  const player = await playerRepository.findById(playerId);
  if (!player) throw new BusinessException(ERROR_MAP.COMMON.NOT_FOUND, { playerId });

  const inventory = player.inventory.getCards().map(card => {
    const template = masterDataCache.getCardTemplate(card.templateId);
    if (!template) throw new BusinessException(ERROR_MAP.COMMON.INTERNAL_ERROR, { templateId: card.templateId });
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

  return {
    name: player.name,
    picture: player.picture,
    economy: { gold: player.economy.gold, enhancementStone: player.economy.enhancementStone, diamond: player.economy.diamond },
    clearedStage: player.clearedStage,
    inventory,
  };
}
