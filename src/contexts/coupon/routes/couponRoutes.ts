import { Router } from "express";
import type { Db } from "mongodb";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { requireAuth } from "../../../shared-kernel/sessionAuth.js";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { createCouponS2sClient } from "../infrastructure/couponS2sClient.js";
import { redeemCoupon } from "../application/couponService.js";
import type { MailboxRepository } from "../../mailbox/domain/mailboxRepository.js";

/**
 * 요청 바디에서 쿠폰 코드를 뽑아 검증한다.
 * @throws {BusinessException} `code`가 비어있거나 문자열이 아니면 COUPON.VALIDATION_FAILED
 * @author trisakion
 */
function parseRedeemBody(body: unknown): { code: string } {
  const { code } = (body ?? {}) as Record<string, unknown>;
  if (typeof code !== "string" || !code)
    throw new BusinessException(ERROR_MAP.COUPON.VALIDATION_FAILED, { body });
  return { code };
}

/**
 * 쿠폰 라우터 — coupon_platform(별도 포트폴리오 프로젝트) 연동. 세션 인증이 필요한 라우터라
 * 강화/합성 라우터와 동일하게 전체에 `requireAuth`를 붙인다.
 * @param mailboxRepository Mailbox 영속성 포트(DI) — 쿠폰 보상은 우편 경유로 지급된다
 * @param db 메인 앱 DB 핸들(`coupon_redemptions` 상태 기록용)
 * @returns 등록된 Express Router
 * @author trisakion
 */
export function createCouponRoutes(mailboxRepository: MailboxRepository, db: Db): Router {
  const router = Router();
  router.use(requireAuth);

  const couponClient = createCouponS2sClient();

  router.post("/coupon/redeem", asyncHandler(async (req, res) => {
    const { code } = parseRedeemBody(req.body);
    const attachments = await redeemCoupon(req.playerId, code, mailboxRepository, couponClient, db);
    res.json({ result: 0, attachments });
  }));

  return router;
}
