import type { Db } from "mongodb";
import { config } from "../../../config/env.js";
import { logger } from "../../../infra/logger.js";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import type { ErrorEntry } from "../../../shared-kernel/errorEntry.js";
import { writeAuditLog } from "../../../shared-kernel/auditLog.js";
import { COLLECTIONS } from "../../../shared-kernel/collectionNames.js";
import { CouponApiError } from "../infrastructure/couponS2sClient.js";
import type { CouponS2sClient } from "../infrastructure/couponS2sClient.js";
import { findPendingRedemptions, markConfirmed, markMailGranted, recordReserved } from "../infrastructure/couponRedemptionStore.js";
import { sendMail } from "../../mailbox/application/mailboxService.js";
import type { MailAttachments } from "../../mailbox/domain/mail.js";
import type { MailboxRepository } from "../../mailbox/domain/mailboxRepository.js";

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * `confirm()`을 짧게 몇 번 더 시도해본다(최초 1회 + 백오프 재시도, 총
 * `config.couponConfirmRetryDelaysMs.length + 1`회).
 * 전부 실패해도 예외를 던지지 않는다 — 보상은 이미 지급됐고, 그 이후는 매일 새벽 4시 주기
 * 재처리 배치(`reconcileUnconfirmedCoupons`)가 마저 처리한다. 네트워크 순단처럼 금방 풀리는
 * 실패는 여기서 끝내고, 배치까지 기다리게 하지 않으려는 목적.
 * @returns confirm이 실제로 성공했는지 여부(호출부가 `markConfirmed` 기록 여부를 판단하는 데 씀)
 * @author trisakion
 */
async function confirmWithRetry(couponClient: CouponS2sClient, code: string, playerId: string): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      await couponClient.confirm(code, playerId);
      return true;
    } catch (err) {
      if (attempt >= config.couponConfirmRetryDelaysMs.length) {
        logger.error(`쿠폰 confirm 실패(보상은 이미 지급됨, 재처리 배치가 마저 처리함): code=${code}, playerId=${playerId}`, err);
        return false;
      }
      await sleep(config.couponConfirmRetryDelaysMs[attempt]);
    }
  }
}

/** coupon_platform이 반환하는 result 코드를 이 프로젝트의 COUPON 에러 대역으로 옮기는 매핑. */
const COUPON_RESULT_CODE_MAP: Record<number, ErrorEntry> = {
  31005: ERROR_MAP.COUPON.NOT_FOUND,
  33001: ERROR_MAP.COUPON.ALREADY_USED,
  33002: ERROR_MAP.COUPON.UNAVAILABLE,
  33003: ERROR_MAP.COUPON.LIMIT_EXCEEDED,
  30001: ERROR_MAP.COUPON.VALIDATION_FAILED,
};

/**
 * `reserve()`가 반환한 `reward_data`(캠페인 생성 시점에 정한 자유 형식 JSON)에서 이 프로젝트가
 * 아는 필드만 뽑아 우편 첨부물로 옮긴다. coupon_platform은 게임 도메인을 모르므로 이 필드명
 * (`gold`/`enhancementStone`/`diamond`/`cardTemplateIds`)은 이 프로젝트가 캠페인 생성 시점에
 * 직접 정한 스키마다 — `MailAttachments`와 동일한 필드명을 그대로 써서 별도 변환 테이블 없이
 * 매핑한다. 알 수 없는/타입이 안 맞는 필드는 조용히 무시한다.
 * @param rewardData `CouponReserveResult.reward_data`
 * @returns 우편 첨부물
 * @author trisakion
 */
function toMailAttachments(rewardData: unknown): MailAttachments {
  const raw = (rewardData ?? {}) as Record<string, unknown>;
  const attachments: MailAttachments = {};
  if (typeof raw.gold === "number") attachments.gold = raw.gold;
  if (typeof raw.enhancementStone === "number") attachments.enhancementStone = raw.enhancementStone;
  if (typeof raw.diamond === "number") attachments.diamond = raw.diamond;
  if (Array.isArray(raw.cardTemplateIds) && raw.cardTemplateIds.every((id) => typeof id === "string"))
    attachments.cardTemplateIds = raw.cardTemplateIds as string[];
  return attachments;
}

/**
 * 쿠폰 코드를 사용(redeem)한다 — coupon_platform의 S2S API(reserve/confirm)를 호출해 소모를
 * 확정하고, 응답의 `reward_data`를 우편(Mailbox)으로 지급한다(스테이지 클리어 보상과 동일하게
 * 우편 경유 — 재화/카드 지급 경로를 통일해두면 인벤토리 슬롯 상한 검증 등을 다시 만들 필요가 없다).
 *
 * **reserve 성공 직후 가장 먼저 하는 일은 `recordReserved()`로 이 DB에 상태 레코드를 남기는
 * 것**이다(`couponRedemptionStore.ts`) — coupon_platform이 "사용됨"으로 확정한 순간과 우리
 * 쪽이 실제로 보상을 지급하는 순간 사이에 서버가 죽는 극히 드문 크래시가 있어도, 이 레코드
 * 덕분에 재처리 배치(`reconcileUnconfirmedCoupons`)가 무엇이 빠졌는지 정확히 알 수 있다 —
 * 예전에는 이 기록이 없어 coupon_platform의 `getUnconfirmed()` 응답만으로 보정하려 했는데,
 * 그 응답엔 `coupon_code_usage_id`가 없어 원래 발송 때 쓴 우편 sourceId를 재구성할 수
 * 없었다(그래서 크래시 케이스를 배치가 영영 놓칠 수 있는 문제가 있었음, 지금은 해결됨).
 *
 * 멱등성: coupon_platform의 `reserve()`가 `coupon_code_usage_id`를 항상 같은 소모 건에 대해
 * 동일하게 반환하므로(그쪽 서버의 멱등 보장), 그 값을 그대로 우편의 `sourceId`로 써서 우리 쪽
 * SendMail도 같은 소모 건에 대해 중복 지급하지 않는다.
 *
 * `confirm()`은 지급 결과 보고일 뿐이라 실패해도 이미 보낸 우편에는 영향이 없다 — 짧은 백오프로
 * 몇 번 더 즉시 재시도해보고(`confirmWithRetry`), 그마저 실패하면 매일 새벽 4시 주기 재처리
 * 배치가 마저 처리한다.
 * @param playerId 쿠폰을 사용하는 플레이어
 * @param code 쿠폰 코드
 * @param mailboxRepository Mailbox 영속성 포트
 * @param couponClient coupon_platform S2S 클라이언트
 * @param db 메인 앱 DB 핸들(`coupon_redemptions` 상태 기록용)
 * @returns 지급된(우편으로 발송된) 첨부물
 * @throws {BusinessException} coupon_platform이 반환한 result 코드에 따라 COUPON.NOT_FOUND/
 *   ALREADY_USED/UNAVAILABLE/LIMIT_EXCEEDED, 그 외(인증/네트워크 오류 등)는 COUPON.INTERNAL_ERROR
 * @author trisakion
 */
export async function redeemCoupon(
  playerId: string,
  code: string,
  mailboxRepository: MailboxRepository,
  couponClient: CouponS2sClient,
  db: Db,
): Promise<MailAttachments> {
  let usageId: string;
  let attachments: MailAttachments;
  try {
    const reserveResult = await couponClient.reserve(code, playerId);
    usageId = String(reserveResult.coupon_code_usage_id);
    attachments = toMailAttachments(reserveResult.reward_data);
  } catch (err) {
    if (err instanceof CouponApiError)
      throw new BusinessException(COUPON_RESULT_CODE_MAP[err.resultCode] ?? ERROR_MAP.COUPON.INTERNAL_ERROR, { code, resultCode: err.resultCode });
    throw new BusinessException(ERROR_MAP.COUPON.INTERNAL_ERROR, { code, err });
  }

  await recordReserved(db, usageId, playerId, code, attachments);

  const inserted = await sendMail(playerId, "쿠폰 보상", attachments, "coupon", usageId, mailboxRepository);
  await markMailGranted(db, usageId);
  // 재시도(예: 클라이언트 더블클릭)로 인한 멱등 스킵까지 로그로 남기면 중복 기록이 되므로,
  // 실제로 새로 지급됐을 때만 남긴다(mailboxService.ts의 sendMail과 동일 기준).
  if (inserted)
    await writeAuditLog(COLLECTIONS.LOG_COUPON, { actorId: playerId, action: "redeem", changes: { code, usageId, attachments } });

  if (await confirmWithRetry(couponClient, code, playerId)) await markConfirmed(db, usageId);

  return attachments;
}

/**
 * `redeemCoupon()`의 즉시 재시도(`confirmWithRetry`)까지 실패해 `coupon_redemptions`에
 * `confirmedAt: null`로 남은 건을 재처리한다(크론 배치, `index.ts`에서 주기 실행) — 즉시
 * 재시도는 수 초 내 순단만 커버하므로, 그보다 긴 장애(coupon_platform 재기동 등)는 이 배치가
 * 담당한다.
 *
 * `mailGrantedAt`이 아직 null인 레코드(=reserve는 확정됐지만 우편 발송 전에 서버가 죽은
 * 크래시 케이스)는 여기서 처음으로 `sendMail()`을 시도해 실제로 지급한다 — 그 외(우편은 이미
 * 나갔고 confirm 보고만 밀린 통상적인 경우)는 곧바로 `confirm()`만 다시 부른다.
 *
 * confirm은 몇 번을 다시 불러도 무해(멱등)하고 sendMail도 같은 sourceId면 멱등이므로 —
 * ClaimMail의 `$inc` 원자 증가와 같은 이유로 — 인스턴스 간 중복 실행 방지 락을 두지 않는다.
 * 여러 서버 인스턴스가 동시에 같은 크론 주기에 이 배치를 돌려도 결과가 달라지지 않는다.
 *
 * "증분 재시도": 매 실행마다 이 시점에 `coupon_redemptions`에 실제로 남아있는 미확인 잔량만
 * 조회해 처리한다 — 이전 실행에서 confirm까지 끝난 건은 조회 조건(`confirmedAt: null`)에서
 * 자연히 빠지므로, 별도 커서/오프셋을 우리가 따로 들고 있을 필요가 없다.
 * @param couponClient coupon_platform S2S 클라이언트
 * @param mailboxRepository Mailbox 영속성 포트(크래시로 미지급된 건을 보정 지급하기 위함)
 * @param db 메인 앱 DB 핸들
 * @returns 재시도 시도/확정/실패 건수와, 그중 실제로 보정 지급(크래시 복구)이 발생한 건수
 * @author trisakion
 */
export async function reconcileUnconfirmedCoupons(
  couponClient: CouponS2sClient,
  mailboxRepository: MailboxRepository,
  db: Db,
): Promise<{ attempted: number; confirmed: number; failed: number; recovered: number }> {
  const pending = await findPendingRedemptions(db);
  let confirmed = 0;
  let failed = 0;
  let recovered = 0;

  for (const record of pending) {
    try {
      if (!record.mailGrantedAt) {
        const inserted = await sendMail(record.playerId, "쿠폰 보상", record.attachments, "coupon", record._id, mailboxRepository);
        await markMailGranted(db, record._id);
        if (inserted) {
          recovered++;
          logger.warn(`[coupon_reconcile] 미지급 상태로 남아있던 쿠폰 보상 보정 지급: code=${record.code}, playerId=${record.playerId}`);
          await writeAuditLog(COLLECTIONS.LOG_COUPON, { actorId: record.playerId, action: "redeem", changes: { code: record.code, usageId: record._id, attachments: record.attachments } });
        }
      }

      await couponClient.confirm(record.code, record.playerId);
      await markConfirmed(db, record._id);
      confirmed++;
    } catch (err) {
      failed++;
      logger.error(`쿠폰 재처리 실패: code=${record.code}, playerId=${record.playerId}`, err);
    }
  }

  if (pending.length > 0)
    logger.info(`[coupon_reconcile] 미확인 쿠폰 재처리: 시도 ${pending.length}건, 확정 ${confirmed}건, 보정지급 ${recovered}건, 실패 ${failed}건`);

  return { attempted: pending.length, confirmed, failed, recovered };
}
