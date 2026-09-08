import { randomUUID } from "node:crypto";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { Mail, MAIL_EXPIRY_MS } from "../domain/mail.js";
import type { MailAttachments } from "../domain/mail.js";
import type { MailboxRepository } from "../domain/mailboxRepository.js";

/**
 * 우편을 발송한다(GAME_DESIGN.md 7절 "발송 트리거" — 스테이지 클리어 보상, 강화 파괴 환급 등
 * 서버 내부 이벤트가 호출). 플레이어가 직접 호출할 수 있는 HTTP API는 없다 — 발송은 항상
 * 다른 Use-case의 결과로만 일어난다.
 * @param playerId 수신자
 * @param title 우편 제목
 * @param attachments 첨부 보상
 * @param sourceType 발송 트리거 종류(중복 발송 차단 키의 일부)
 * @param sourceId 발송 트리거 인스턴스 식별자(중복 발송 차단 키의 일부) — 이미 같은 조합으로
 *   발송된 적 있으면 조용히 무시된다(멱등)
 * @param mailboxRepository Mailbox 영속성 포트
 * @param expiryMs 발송 시각으로부터 만료까지 걸리는 시간(ms) — 실제 게임 트리거는
 *   `mailContent.ts`의 `MAIL_CONTENTS` 레지스트리 값을 넘겨야 하고, 생략 시 기본값
 *   {@link MAIL_EXPIRY_MS}가 쓰인다(레지스트리에 없는 임시/테스트용 발송)
 * @throws {BusinessException} attachments에 음수/NaN 값이 있으면 MAILBOX.VALIDATION_FAILED
 * @author trisakion
 */
export async function sendMail(
  playerId: string,
  title: string,
  attachments: MailAttachments,
  sourceType: string,
  sourceId: string,
  mailboxRepository: MailboxRepository,
  expiryMs: number = MAIL_EXPIRY_MS,
): Promise<void> {
  for (const amount of [attachments.gold, attachments.enhancementStone, attachments.diamond]) {
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0))
      throw new BusinessException(ERROR_MAP.MAILBOX.VALIDATION_FAILED, { attachments });
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + expiryMs);
  const mail = new Mail(randomUUID(), playerId, title, attachments, sourceType, sourceId, createdAt, expiresAt, null);
  await mailboxRepository.insertMail(mail);
}

/**
 * @param playerId 조회할 플레이어
 * @param mailboxRepository Mailbox 영속성 포트
 * @returns 해당 플레이어의 만료되지 않은 우편 목록(최신순)
 */
export async function listMails(playerId: string, mailboxRepository: MailboxRepository): Promise<Mail[]> {
  return mailboxRepository.findByPlayer(playerId);
}

/**
 * 우편 첨부물을 수령한다.
 * @param playerId 수령을 시도하는 플레이어
 * @param mailId 수령할 우편 ID
 * @param mailboxRepository Mailbox 영속성 포트
 * @returns 수령 처리된 우편
 * @throws {BusinessException} 우편이 없거나 소유자가 아니면 MAILBOX.NOT_FOUND, 이미 수령했으면
 *   MAILBOX.ALREADY_CLAIMED, 만료됐으면 MAILBOX.EXPIRED
 */
export async function claimMail(playerId: string, mailId: string, mailboxRepository: MailboxRepository): Promise<Mail> {
  return mailboxRepository.claimMail(mailId, playerId);
}
