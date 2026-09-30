import { Router } from "express";
import { drawCustomBox, drawGradeRateBox } from "../application/randomBoxService.js";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { requireAuth } from "../../../shared-kernel/sessionAuth.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";

/**
 * 랜덤박스(가챠) 라우터. 강화/합성과 동일하게 세션 인증이 필요해 라우터 전체에
 * `requireAuth`를 붙인다.
 * @param playerRepository Player 영속성 포트(DI)
 * @returns 등록된 Express Router
 * @author trisakion
 */
export function createRandomBoxRoutes(playerRepository: PlayerRepository): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/random-box/grade-rate/:boxId/draw", asyncHandler(async (req, res) => {
    const result = await drawGradeRateBox(req.playerId, req.params.boxId, playerRepository);
    res.json({ result: 0, ...result });
  }));

  router.post("/random-box/custom/:boxId/draw", asyncHandler(async (req, res) => {
    const result = await drawCustomBox(req.playerId, req.params.boxId, playerRepository);
    res.json({ result: 0, ...result });
  }));

  return router;
}
