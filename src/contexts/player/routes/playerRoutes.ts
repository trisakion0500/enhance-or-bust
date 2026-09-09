import { Router } from "express";
import { getPlayerSummary } from "../application/playerService.js";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { requireAuth } from "../../../shared-kernel/sessionAuth.js";
import type { PlayerRepository } from "../domain/playerRepository.js";

/**
 * 플레이어 자기 자신 조회 라우터. 다른 보호 라우트와 동일하게 세션 인증이 필요해 라우터
 * 전체에 `requireAuth`를 붙인다. 프론트는 페이지 로드 시 이 엔드포인트를 호출해 로그인
 * 여부 확인(401이면 로그인 화면)과 게임 화면 초기 렌더 데이터 획득을 동시에 처리한다.
 * @param playerRepository Player 영속성 포트(DI)
 * @returns 등록된 Express Router
 * @author trisakion
 */
export function createPlayerRoutes(playerRepository: PlayerRepository): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/player/me", asyncHandler(async (req, res) => {
    const summary = await getPlayerSummary(req.playerId, playerRepository);
    res.json({ result: 0, ...summary });
  }));

  return router;
}
