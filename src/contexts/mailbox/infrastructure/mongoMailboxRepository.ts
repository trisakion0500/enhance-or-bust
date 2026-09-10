import { randomUUID } from "node:crypto";
import type { Collection, Db, MongoServerError } from "mongodb";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { config } from "../../../config/env.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { mongoClient } from "../../../infra/mongo.js";
import type { CardDocument, PlayerDocument } from "../../player/infrastructure/mongoPlayerRepository.js";
import { Mail } from "../domain/mail.js";
import type { MailAttachments } from "../domain/mail.js";
import type { MailboxRepository } from "../domain/mailboxRepository.js";

/** `Mail`의 MongoDB 저장 형태(`mailbox` 컬렉션 문서 스키마). */
interface MailDocument {
  _id: string;
  playerId: string;
  title: string;
  attachments: MailAttachments;
  sourceType: string;
  sourceId: string;
  createdAt: Date;
  expiresAt: Date;
  claimedAt: Date | null;
  deletedAt: Date | null;
}

/**
 * `Mail`을 `mailbox` 컬렉션에 매핑하는 MongoDB 구현체. ClaimMail은 mailbox + players 두
 * 컬렉션에 걸친 진짜 멀티도큐먼트 트랜잭션이 필요해(players는 낙관적 락 단일 문서 전략이지만,
 * 이 경우엔 별도 컬렉션과 원자적으로 묶여야 하므로 예외) 이 리포지토리가 players 컬렉션
 * 핸들도 함께 갖는다 — CLAUDE.md의 mailbox 컬렉션 절이 이미 정한 경계.
 * @author trisakion
 */
export class MongoMailboxRepository implements MailboxRepository {
  private readonly mailboxCollection: Collection<MailDocument>;
  private readonly playersCollection: Collection<PlayerDocument>;

  /** @param db 연결된 앱 DB 핸들 */
  constructor(db: Db) {
    this.mailboxCollection = db.collection<MailDocument>("mailbox");
    this.playersCollection = db.collection<PlayerDocument>("players");
  }

  async ensureIndexes(): Promise<void> {
    await this.mailboxCollection.createIndex({ sourceType: 1, sourceId: 1 }, { unique: true });
    await this.mailboxCollection.createIndex({ playerId: 1 });
  }

  async insertMail(mail: Mail): Promise<void> {
    try {
      await this.mailboxCollection.insertOne(MongoMailboxRepository.toDocument(mail));
    } catch (err) {
      // (sourceType, sourceId) 유니크 인덱스 중복 — 이미 발송된 건이라 무해하게 무시한다(멱등 발송).
      if ((err as MongoServerError).code !== 11000) throw err;
    }
  }

  async findById(mailId: string): Promise<Mail | null> {
    const doc = await this.mailboxCollection.findOne({ _id: mailId });
    return doc ? MongoMailboxRepository.toDomain(doc) : null;
  }

  async findByPlayer(playerId: string): Promise<Mail[]> {
    const docs = await this.mailboxCollection
      .find({ playerId, expiresAt: { $gt: new Date() }, deletedAt: null })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map(MongoMailboxRepository.toDomain);
  }

  async claimMail(mailId: string, playerId: string): Promise<Mail> {
    const session = mongoClient.startSession();
    try {
      let claimedDoc: MailDocument | undefined;

      await session.withTransaction(async () => {
        const mailDoc = await this.mailboxCollection.findOne({ _id: mailId }, { session });
        if (!mailDoc || mailDoc.playerId !== playerId)
          throw new BusinessException(ERROR_MAP.MAILBOX.NOT_FOUND, { mailId, playerId });
        if (mailDoc.claimedAt)
          throw new BusinessException(ERROR_MAP.MAILBOX.ALREADY_CLAIMED, { mailId });
        if (mailDoc.expiresAt.getTime() <= Date.now())
          throw new BusinessException(ERROR_MAP.MAILBOX.EXPIRED, { mailId });

        const claimedAt = new Date();
        const newCards: CardDocument[] = (mailDoc.attachments.cardTemplateIds ?? []).map(templateId => ({
          cardId: randomUUID(),
          templateId,
          level: 1,
          exp: 0,
          enhancementLevel: 0,
        }));

        if (newCards.length > 0) {
          const player = await this.playersCollection.findOne({ _id: playerId }, { session });
          if (!player) throw new BusinessException(ERROR_MAP.COMMON.NOT_FOUND, { playerId });
          // 인벤토리 상한 초과가 예상되면 우편은 그대로 두고(claimedAt 미변경, 지급 없음) 거부한다 —
          // 이 우편은 계속 미수령 상태로 남아 나중에 슬롯을 비운 뒤 다시 수령을 시도할 수 있다.
          if (player.inventory.length + newCards.length > config.inventorySlotCap)
            throw new BusinessException(ERROR_MAP.MAILBOX.INVENTORY_FULL, { playerId, mailId, current: player.inventory.length, incoming: newCards.length });
        }

        const playerUpdate = await this.playersCollection.updateOne(
          { _id: playerId },
          {
            $inc: {
              "economy.gold": mailDoc.attachments.gold ?? 0,
              "economy.enhancementStone": mailDoc.attachments.enhancementStone ?? 0,
              "economy.diamond": mailDoc.attachments.diamond ?? 0,
              version: 1,
            },
            ...(newCards.length > 0 ? { $push: { inventory: { $each: newCards } } } : {}),
          },
          { session },
        );
        if (playerUpdate.matchedCount === 0)
          throw new BusinessException(ERROR_MAP.COMMON.NOT_FOUND, { playerId });

        await this.mailboxCollection.updateOne({ _id: mailId }, { $set: { claimedAt } }, { session });
        claimedDoc = { ...mailDoc, claimedAt };
      });

      return MongoMailboxRepository.toDomain(claimedDoc!);
    } finally {
      await session.endSession();
    }
  }

  async deleteMail(mailId: string, playerId: string): Promise<void> {
    // 검증(소유자/수령 여부)을 실제 쓰기의 필터 조건에도 그대로 실어, 조회와 쓰기 사이에 상태가
    // 바뀌어도(TOCTOU) 조건을 벗어난 문서는 애초에 갱신되지 않게 한다.
    const result = await this.mailboxCollection.updateOne(
      { _id: mailId, playerId, claimedAt: { $ne: null } },
      { $set: { deletedAt: new Date() } },
    );
    if (result.matchedCount > 0) return;

    // 여기 도달했다는 건 조건 중 하나가 깨졌다는 뜻 — 정확한 에러 코드를 돌려주기 위해서만 재조회한다.
    const mailDoc = await this.mailboxCollection.findOne({ _id: mailId });
    if (!mailDoc || mailDoc.playerId !== playerId)
      throw new BusinessException(ERROR_MAP.MAILBOX.NOT_FOUND, { mailId, playerId });
    if (!mailDoc.claimedAt)
      throw new BusinessException(ERROR_MAP.MAILBOX.NOT_CLAIMED, { mailId });
  }

  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const result = await this.mailboxCollection.deleteMany({ expiresAt: { $lt: cutoff } });
    return result.deletedCount;
  }

  /**
   * @param doc DB에서 읽은 원본 문서
   * @returns 매핑된 도메인 엔티티
   */
  private static toDomain(doc: MailDocument): Mail {
    return new Mail(doc._id, doc.playerId, doc.title, doc.attachments, doc.sourceType, doc.sourceId, doc.createdAt, doc.expiresAt, doc.claimedAt, doc.deletedAt);
  }

  /**
   * @param mail 변환할 도메인 엔티티
   * @returns DB에 저장할 문서 형태
   */
  private static toDocument(mail: Mail): MailDocument {
    return {
      _id: mail.mailId,
      playerId: mail.playerId,
      title: mail.title,
      attachments: mail.attachments,
      sourceType: mail.sourceType,
      sourceId: mail.sourceId,
      createdAt: mail.createdAt,
      expiresAt: mail.expiresAt,
      claimedAt: mail.claimedAt,
      deletedAt: mail.deletedAt,
    };
  }
}
