import { BusinessException } from "../../common/businessException.js";
import { ERROR_MAP } from "../../common/errorMap.js";
import type { Card } from "./card.js";

/**
 * 플레이어가 보유한 카드 목록. 슬롯 상한 검증은 여기서 하지 않는다 — 구체적 상한 수치가
 * 아직 GAME_DESIGN.md에 TBD이고, "차단"과 "결과 지급"이 서로 다른 코드 경로를 타야 해서
 * (CLAUDE.md "Inventory 슬롯 상한 구현 노트") 이 엔티티 하나로 판단할 문제가 아니다.
 * @author trisakion
 */
export class Inventory {
  /** @param cards 보유 카드 목록(기본 빈 배열) */
  constructor(private readonly cards: Card[] = []) {}

  /** @returns 보유 카드 전체(읽기 전용 — 추가/삭제는 addCard/removeCard로만) */
  getCards(): readonly Card[] {
    return this.cards;
  }

  /**
   * @param cardId 찾을 카드 ID
   * @returns 일치하는 카드, 없으면 undefined
   */
  findCard(cardId: string): Card | undefined {
    return this.cards.find(card => card.cardId === cardId);
  }

  /** @param card 추가할 카드 */
  addCard(card: Card): void {
    this.cards.push(card);
  }

  /**
   * @param cardId 제거할 카드 ID
   * @throws {BusinessException} 이미 없는 카드면 INVENTORY.NOT_FOUND
   */
  removeCard(cardId: string): void {
    const index = this.cards.findIndex(card => card.cardId === cardId);
    if (index === -1)
      throw new BusinessException(ERROR_MAP.INVENTORY.NOT_FOUND, { cardId });
    this.cards.splice(index, 1);
  }
}
