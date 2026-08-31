import type { Collection, Db } from "mongodb";
import { BusinessException } from "../common/businessException.js";
import { ERROR_MAP } from "../common/errorMap.js";
import { Card } from "../domain/player/card.js";
import { Economy } from "../domain/player/economy.js";
import { Inventory } from "../domain/player/inventory.js";
import { Player } from "../domain/player/player.js";
import type { PlayerRepository } from "../domain/player/playerRepository.js";

/** `Card` 엔티티의 MongoDB 저장 형태 — 필드는 같지만 메서드 없는 순수 데이터 셰이프. */
interface CardDocument {
  cardId: string;
  templateId: string;
  level: number;
  exp: number;
  enhancementLevel: number;
}

/** `Player` 애그리게잇의 MongoDB 저장 형태(`players` 컬렉션 문서 스키마). */
interface PlayerDocument {
  _id: string;
  version: number;
  inventory: CardDocument[];
  economy: { gold: number; enhancementStone: number; diamond: number };
  clearedStage: number;
}

/**
 * `Player` 애그리게잇을 `players` 컬렉션 단일 문서에 매핑하는 MongoDB 구현체.
 * CLAUDE.md의 MongoDB 모델링 전략(낙관적 락, 트랜잭션 없음)을 그대로 따른다 — 조건부
 * 업데이트(쿼리에 `version` 포함)로 원자성을 확보하고, 실패하면 호출부가 재조회 후 재시도한다.
 * @author trisakion
 */
export class MongoPlayerRepository implements PlayerRepository {
  private readonly collection: Collection<PlayerDocument>;

  /** @param db 연결된 앱 DB 핸들 — 테스트 시 가짜 Db로 교체 가능하도록 주입받는다. */
  constructor(db: Db) {
    this.collection = db.collection<PlayerDocument>("players");
  }

  /**
   * @param playerId 조회할 플레이어 ID
   * @returns 해당 플레이어, 없으면 null
   */
  async findById(playerId: string): Promise<Player | null> {
    const doc = await this.collection.findOne({ _id: playerId });
    return doc ? MongoPlayerRepository.toDomain(doc) : null;
  }

  /**
   * @param player 저장할 플레이어(이 인스턴스의 version이 기대 버전으로 쓰인다)
   * @throws {BusinessException} `player.version`이 DB의 현재 버전과 다르면(동시 수정 충돌) COMMON.CONFLICT
   */
  async save(player: Player): Promise<void> {
    const doc = MongoPlayerRepository.toDocument(player);
    const result = await this.collection.updateOne(
      { _id: player.playerId, version: player.version },
      { $set: { inventory: doc.inventory, economy: doc.economy, clearedStage: doc.clearedStage }, $inc: { version: 1 } },
    );

    if (result.matchedCount === 0)
      throw new BusinessException(ERROR_MAP.COMMON.CONFLICT, { playerId: player.playerId, expectedVersion: player.version });
  }

  /**
   * @param doc DB에서 읽은 원본 문서
   * @returns 매핑된 도메인 애그리게잇
   */
  private static toDomain(doc: PlayerDocument): Player {
    const cards = doc.inventory.map(c => new Card(c.cardId, c.templateId, c.level, c.exp, c.enhancementLevel));
    const inventory = new Inventory(cards);
    const economy = new Economy(doc.economy.gold, doc.economy.enhancementStone, doc.economy.diamond);
    return new Player(doc._id, doc.version, inventory, economy, doc.clearedStage);
  }

  /**
   * @param player 변환할 도메인 애그리게잇
   * @returns DB에 저장할 문서 형태
   */
  private static toDocument(player: Player): PlayerDocument {
    return {
      _id: player.playerId,
      version: player.version,
      inventory: player.inventory.getCards().map(card => ({
        cardId: card.cardId,
        templateId: card.templateId,
        level: card.level,
        exp: card.exp,
        enhancementLevel: card.enhancementLevel,
      })),
      economy: {
        gold: player.economy.gold,
        enhancementStone: player.economy.enhancementStone,
        diamond: player.economy.diamond,
      },
      clearedStage: player.clearedStage,
    };
  }
}
