import type { Db } from "mongodb";
import { COLLECTIONS } from "../../../shared-kernel/collectionNames.js";
import type { MailAttachments } from "../../mailbox/domain/mail.js";

/**
 * 쿠폰 사용 건 하나의 진행 상태. `_id`를 coupon_platform의 `coupon_code_usage_id`로 고정해
 * 같은 소모 건에 대해 몇 번을 다시 호출해도(재시도 등) 항상 같은 문서로 수렴한다(멱등).
 * @author trisakion
 */
interface CouponRedemptionDocument {
  _id: string;
  playerId: string;
  code: string;
  attachments: MailAttachments;
  reservedAt: Date;
  /** 우편(Mailbox) 발송이 끝난 시각, 아직이면 null. */
  mailGrantedAt: Date | null;
  /** coupon_platform에 confirm 보고가 끝난 시각, 아직이면 null. */
  confirmedAt: Date | null;
}

/**
 * coupon_platform이 `reserve()` 성공(=쿠폰 사용 확정)을 응답한 직후 그 사실을 즉시 이 DB에
 * 남긴다 — 이후 보상 지급(sendMail)/confirm 보고 중 어느 단계에서 서버가 죽어도, 이 레코드가
 * 남아있는 한 재처리 배치(`couponService.ts`의 `reconcileUnconfirmedCoupons()`)가
 * `mailGrantedAt`/`confirmedAt`만 보고 정확히 어디서부터 이어서 처리할지 판단할 수 있다.
 * `$setOnInsert`로 upsert해 이미 존재하는 레코드(재시도)의 진행 상태 필드를 덮어쓰지 않는다.
 *
 * 부수 효과로, 이 컬렉션이 곧 이 게임서버 쪽에서 독립적으로 집계 가능한 쿠폰 사용 이력이 된다 —
 * coupon_platform 자체 집계와 대조해 불일치를 찾는 운영 용도로도 쓸 수 있다.
 * @param db 메인 앱 DB 핸들
 * @param usageId coupon_platform의 `coupon_code_usage_id`(문자열로 변환)
 * @param playerId 플레이어 ID
 * @param code 쿠폰 코드
 * @param attachments 지급될 첨부물(reward_data를 매핑한 값)
 * @author trisakion
 */
export async function recordReserved(
  db: Db,
  usageId: string,
  playerId: string,
  code: string,
  attachments: MailAttachments,
): Promise<void> {
  await db.collection<CouponRedemptionDocument>(COLLECTIONS.COUPON_REDEMPTIONS).updateOne(
    { _id: usageId },
    { $setOnInsert: { _id: usageId, playerId, code, attachments, reservedAt: new Date(), mailGrantedAt: null, confirmedAt: null } },
    { upsert: true },
  );
}

/**
 * 우편 발송이 끝났음을 기록한다(sendMail 자체가 sourceId로 이미 중복 방지하므로 여러 번
 * 불러도 무해).
 * @author trisakion
 */
export async function markMailGranted(db: Db, usageId: string): Promise<void> {
  await db.collection<CouponRedemptionDocument>(COLLECTIONS.COUPON_REDEMPTIONS).updateOne({ _id: usageId }, { $set: { mailGrantedAt: new Date() } });
}

/**
 * confirm 보고가 끝났음을 기록한다.
 * @author trisakion
 */
export async function markConfirmed(db: Db, usageId: string): Promise<void> {
  await db.collection<CouponRedemptionDocument>(COLLECTIONS.COUPON_REDEMPTIONS).updateOne({ _id: usageId }, { $set: { confirmedAt: new Date() } });
}

/**
 * 아직 confirm 보고가 끝나지 않은 레코드를 전부 조회한다(재처리 배치 대상 — 우편이 아직
 * 발송되지 않은 건도 포함, `mailGrantedAt`으로 구분). coupon_platform의 `getUnconfirmed()`
 * API에 의존하지 않는다 — 그쪽 응답엔 `coupon_code_usage_id`가 없어 이 컬렉션 없이는 우편의
 * sourceId를 재구성할 방법이 없었다(예전 설계의 문제).
 * @author trisakion
 */
export async function findPendingRedemptions(db: Db): Promise<CouponRedemptionDocument[]> {
  return db.collection<CouponRedemptionDocument>(COLLECTIONS.COUPON_REDEMPTIONS).find({ confirmedAt: null }).toArray();
}

/**
 * `coupon_redemptions` 조회 인덱스를 보장한다(서버 기동 시 1회 호출, `playerRepository.ensureIndexes()`와 동일 패턴).
 * @author trisakion
 */
export async function ensureCouponRedemptionIndexes(db: Db): Promise<void> {
  await db.collection(COLLECTIONS.COUPON_REDEMPTIONS).createIndex({ confirmedAt: 1 });
}
