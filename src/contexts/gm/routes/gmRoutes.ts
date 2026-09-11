import { Router } from "express";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { gmApiKeyAuth } from "../../../shared-kernel/gmApiKeyAuth.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import { getPlayerCardsForGm, getPlayerForGm, listPlayersForGm } from "../application/gmService.js";

/**
 * gm_platform 연동 전용 라우터 — 세션 쿠키가 아니라 X-API-Key(`gmApiKeyAuth`)로 인증한다.
 * gm_platform의 apiExecution은 등록된 API를 항상 `POST {api_base_url}{endpoint}`로 호출하므로
 * (gm_platform의 test_game_server와 동일 관례), 조회 엔드포인트도 GET이 아니라 POST로 둔다.
 * `gmApiKeyAuth`는 `router.use()`가 아니라 각 라우트에 개별로 붙인다 — 다른 컨텍스트 라우터들처럼
 * `router.use(requireAuth)`로 걸면, 이 라우터가 프리픽스 없이 `app.use()`로 마운트되는 구조상
 * 경로 매칭과 무관하게 "이 라우터에 도달하는 모든 요청"에 적용돼버린다(반대로 이 라우터가 다른
 * 라우터보다 먼저 마운트되면 세션 기반 라우트까지 X-API-Key를 요구하게 됨). 라우트별로 붙이면
 * Express가 경로+메서드가 실제로 일치할 때만 이 미들웨어를 태우므로 서로 간섭하지 않는다.
 * @param playerRepository Player 영속성 포트(DI)
 * @returns 등록된 Express Router
 * @author trisakion
 */
export function createGmRoutes(playerRepository: PlayerRepository): Router {
  const router = Router();

  router.post("/gm/get-player", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const { playerId } = req.body ?? {};
    if (playerId !== undefined && playerId !== null && typeof playerId !== "string")
      throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body: req.body });

    // playerId 미입력 시 전체 조회로 취급한다(gm_platform 쪽에서 이 파라미터를 필수로 두지 않음).
    if (!playerId) {
      const players = await listPlayersForGm(playerRepository);
      res.json({ result: 0, message: "OK", data: players });
      return;
    }

    const summary = await getPlayerForGm(playerId, playerRepository);
    res.json({ result: 0, message: "OK", data: [summary] });
  }));

  router.post("/gm/get-player-cards", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const { playerId } = req.body ?? {};
    if (typeof playerId !== "string" || !playerId)
      throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body: req.body });

    const cards = await getPlayerCardsForGm(playerId, playerRepository);
    res.json({ result: 0, message: "OK", data: cards });
  }));

  return router;
}
