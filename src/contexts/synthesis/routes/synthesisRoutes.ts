import { Router } from "express";
import { synthesizeEnhanceMaterial, synthesizeGradeUpgrade } from "../application/synthesisService.js";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { requireAuth } from "../../../shared-kernel/sessionAuth.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";

/** 배열인지, 원소가 전부 non-empty string인지 검증한다(두 합성 라우트가 공통으로 쓰는 요청 검증). */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === "string" && v.length > 0);
}

/**
 * 합성 라우터. 강화 라우터와 동일하게 세션 인증이 필요해 라우터 전체에 `requireAuth`를 붙인다.
 * @param playerRepository Player 영속성 포트(DI)
 * @returns 등록된 Express Router
 * @author trisakion
 */
export function createSynthesisRoutes(playerRepository: PlayerRepository): Router {
  const router = Router();
  router.use(requireAuth);

  router.post("/synthesis/grade-upgrade", asyncHandler(async (req, res) => {
    const { materialCardIds } = req.body ?? {};
    if (!isStringArray(materialCardIds))
      throw new BusinessException(ERROR_MAP.SYNTHESIS.VALIDATION_FAILED, { body: req.body });

    const result = await synthesizeGradeUpgrade(req.playerId, materialCardIds, playerRepository);
    res.json({ result: 0, ...result });
  }));

  router.post("/synthesis/enhance-material", asyncHandler(async (req, res) => {
    const { targetCardId, materialCardIds } = req.body ?? {};
    if (typeof targetCardId !== "string" || !targetCardId || !isStringArray(materialCardIds))
      throw new BusinessException(ERROR_MAP.SYNTHESIS.VALIDATION_FAILED, { body: req.body });

    const result = await synthesizeEnhanceMaterial(req.playerId, targetCardId, materialCardIds, playerRepository);
    res.json({ result: 0, ...result });
  }));

  return router;
}
