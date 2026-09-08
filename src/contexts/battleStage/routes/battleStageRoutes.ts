import { Router } from "express";
import { clearStage } from "../application/battleStageService.js";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { isStringArray } from "../../../shared-kernel/requestValidation.js";
import { requireAuth } from "../../../shared-kernel/sessionAuth.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import type { MailboxRepository } from "../../mailbox/domain/mailboxRepository.js";

/**
 * 전투/스테이지 라우터. 다른 보호 라우트와 동일하게 세션 인증이 필요해 라우터 전체에
 * `requireAuth`를 붙인다.
 * @param playerRepository Player 영속성 포트(DI)
 * @param mailboxRepository Mailbox 영속성 포트(DI) — 클리어 보상 발송에 사용
 * @returns 등록된 Express Router
 * @author trisakion
 */
export function createBattleStageRoutes(playerRepository: PlayerRepository, mailboxRepository: MailboxRepository): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/battle-stage/:stageId/clear", asyncHandler(async (req, res) => {
    const stageId = Number(req.params.stageId);
    const { squadCardIds } = req.body ?? {};
    if (!Number.isInteger(stageId) || stageId < 1 || !isStringArray(squadCardIds))
      throw new BusinessException(ERROR_MAP.BATTLE_STAGE.VALIDATION_FAILED, { params: req.params, body: req.body });

    const result = await clearStage(req.playerId, stageId, squadCardIds, playerRepository, mailboxRepository);
    res.json({ result: 0, ...result });
  }));

  return router;
}
