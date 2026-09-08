import { Router } from "express";
import { enhanceCard } from "../application/enhancementService.js";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { requireAuth } from "../../../shared-kernel/sessionAuth.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";

/**
 * 강화 라우터. 세션 인증이 필요한 첫 보호 라우트라, 이 라우터 전체에 `requireAuth`를 붙인다.
 * @param playerRepository Player 영속성 포트(DI)
 * @returns 등록된 Express Router
 * @author trisakion
 */
export function createEnhancementRoutes(playerRepository: PlayerRepository): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/enhancement/:cardId", asyncHandler(async (req, res) => {
    const result = await enhanceCard(req.playerId, req.params.cardId, playerRepository);
    res.json({ result: 0, ...result });
  }));

  return router;
}
