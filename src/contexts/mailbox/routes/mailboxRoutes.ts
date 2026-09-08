import { Router } from "express";
import { claimMail, listMails } from "../application/mailboxService.js";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { requireAuth } from "../../../shared-kernel/sessionAuth.js";
import type { MailboxRepository } from "../domain/mailboxRepository.js";

/**
 * 우편함 라우터. 다른 보호 라우트와 동일하게 세션 인증이 필요해 라우터 전체에 `requireAuth`를
 * 붙인다. 발송(SendMail)은 플레이어가 직접 호출하는 API가 아니라서 라우트가 없다 —
 * `mailboxService.sendMail()`을 다른 Use-case가 내부적으로 호출한다.
 * @param mailboxRepository Mailbox 영속성 포트(DI)
 * @returns 등록된 Express Router
 * @author trisakion
 */
export function createMailboxRoutes(mailboxRepository: MailboxRepository): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/mailbox", asyncHandler(async (req, res) => {
    const mails = await listMails(req.playerId, mailboxRepository);
    res.json({ result: 0, mails });
  }));

  router.post("/mailbox/:mailId/claim", asyncHandler(async (req, res) => {
    const mail = await claimMail(req.playerId, req.params.mailId, mailboxRepository);
    res.json({ result: 0, mail });
  }));

  return router;
}
