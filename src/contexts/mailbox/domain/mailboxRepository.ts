import type { Mail } from "./mail.js";

/**
 * Mailbox 영속성 포트. ClaimMail은 본질적으로 mailbox와 players 두 컬렉션에 걸친 트랜잭션이라,
 * 이 포트의 구현체(`MongoMailboxRepository`)가 players 컬렉션 접근까지 함께 책임진다 —
 * CLAUDE.md의 "mailbox 컬렉션" 절이 이미 정한 경계다.
 * @author trisakion
 */
export interface MailboxRepository {
  /**
   * (sourceType, sourceId) 유니크 인덱스로 멱등하게 삽입한다 — 이미 같은 조합으로 발송된
   * 우편이 있으면 조용히 무시한다.
   * @param mail 발송할 우편
   */
  insertMail(mail: Mail): Promise<void>;

  /**
   * @param mailId 조회할 우편 ID
   * @returns 해당 우편, 없으면 null
   */
  findById(mailId: string): Promise<Mail | null>;

  /**
   * @param playerId 조회할 플레이어 ID
   * @returns 해당 플레이어의 만료되지 않은 우편 목록(최신순)
   */
  findByPlayer(playerId: string): Promise<Mail[]>;

  /**
   * 우편 상태 변경 + 첨부물 지급(Economy/Inventory)을 멀티도큐먼트 트랜잭션으로 원자적으로 처리한다.
   * @param mailId 수령할 우편 ID
   * @param playerId 수령을 시도하는 플레이어 ID(소유자 검증에 쓰인다)
   * @returns 수령 처리된 우편(claimedAt 채워짐)
   * @throws {BusinessException} 우편이 없거나 소유자가 아니면 MAILBOX.NOT_FOUND, 이미 수령했으면
   *   MAILBOX.ALREADY_CLAIMED, 만료됐으면 MAILBOX.EXPIRED
   */
  claimMail(mailId: string, playerId: string): Promise<Mail>;

  /** (sourceType, sourceId) 유니크 인덱스와 playerId 조회용 인덱스를 생성한다. 이미 있으면 무해한 멱등 연산. */
  ensureIndexes(): Promise<void>;

  /**
   * 만료 시각이 cutoff 이전인 우편을 수령 여부와 무관하게 전부 삭제한다(만료 우편 정리 배치 전용
   * — CLAUDE.md "우편 자동삭제 금지"는 TTL 인덱스로 즉시/암묵적 삭제하지 않는다는 뜻이지, 이렇게
   * 명시적 배치가 오래된 만료건을 정리하는 것까지 막지는 않는다).
   * @param cutoff 이 시각 이전에 만료된 우편만 삭제 대상
   * @returns 삭제된 우편 수
   */
  deleteExpiredBefore(cutoff: Date): Promise<number>;
}
