import { Router } from "express";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { gmApiKeyAuth } from "../../../shared-kernel/gmApiKeyAuth.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import {
  getAuthLogsForGm,
  getBattleStageLogsForGm,
  getCardTemplatesForGm,
  getEnhancementLogsForGm,
  getEnhancementRulesForGm,
  getGradeConfigsForGm,
  getMailboxLogsForGm,
  getPlayerCardsForGm,
  getPlayerForGm,
  getStageCardDropsForGm,
  getStageConfigsForGm,
  getSynthesisLogsForGm,
  getSynthesisRulesForGm,
  listPlayersForGm,
} from "../application/gmService.js";

/**
 * 로그 조회 라우트 5개가 공통으로 쓰는 요청 파라미터 파싱 — playerId(필수 문자열),
 * fromDate/toDate(선택, 문자열이면 통과시키고 실제 날짜 파싱은 서비스 단에서 검증한다).
 * @param body 요청 바디
 * @returns 파싱된 파라미터
 * @throws {BusinessException} playerId가 없거나 타입이 올바르지 않으면 GM.VALIDATION_FAILED
 * @author trisakion
 */
function parseGmLogQuery(body: unknown): { playerId: string; fromDate?: string; toDate?: string } {
  const { playerId, fromDate, toDate } = (body ?? {}) as Record<string, unknown>;
  if (typeof playerId !== "string" || !playerId)
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body });
  if (fromDate !== undefined && typeof fromDate !== "string")
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body });
  if (toDate !== undefined && typeof toDate !== "string")
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body });
  return { playerId, fromDate, toDate };
}

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

  // 시드데이터(마스터데이터) 6종 — 1차는 조회만, 수정/삭제는 아직 없다.
  router.post("/gm/get-card-templates", gmApiKeyAuth, asyncHandler(async (_req, res) => {
    res.json({ result: 0, message: "OK", data: getCardTemplatesForGm() });
  }));

  router.post("/gm/get-grade-configs", gmApiKeyAuth, asyncHandler(async (_req, res) => {
    res.json({ result: 0, message: "OK", data: getGradeConfigsForGm() });
  }));

  router.post("/gm/get-enhancement-rules", gmApiKeyAuth, asyncHandler(async (_req, res) => {
    res.json({ result: 0, message: "OK", data: getEnhancementRulesForGm() });
  }));

  router.post("/gm/get-synthesis-rules", gmApiKeyAuth, asyncHandler(async (_req, res) => {
    res.json({ result: 0, message: "OK", data: getSynthesisRulesForGm() });
  }));

  router.post("/gm/get-stage-configs", gmApiKeyAuth, asyncHandler(async (_req, res) => {
    res.json({ result: 0, message: "OK", data: getStageConfigsForGm() });
  }));

  router.post("/gm/get-stage-card-drops", gmApiKeyAuth, asyncHandler(async (_req, res) => {
    res.json({ result: 0, message: "OK", data: getStageCardDropsForGm() });
  }));

  // 유저고유번호(playerId)별 감사 로그 조회 5종 — playerId 필수, fromDate/toDate 선택.
  router.post("/gm/get-auth-logs", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const { playerId, fromDate, toDate } = parseGmLogQuery(req.body);
    res.json({ result: 0, message: "OK", data: await getAuthLogsForGm(playerId, playerRepository, fromDate, toDate) });
  }));

  router.post("/gm/get-enhancement-logs", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const { playerId, fromDate, toDate } = parseGmLogQuery(req.body);
    res.json({ result: 0, message: "OK", data: await getEnhancementLogsForGm(playerId, playerRepository, fromDate, toDate) });
  }));

  router.post("/gm/get-synthesis-logs", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const { playerId, fromDate, toDate } = parseGmLogQuery(req.body);
    res.json({ result: 0, message: "OK", data: await getSynthesisLogsForGm(playerId, playerRepository, fromDate, toDate) });
  }));

  router.post("/gm/get-battle-stage-logs", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const { playerId, fromDate, toDate } = parseGmLogQuery(req.body);
    res.json({ result: 0, message: "OK", data: await getBattleStageLogsForGm(playerId, playerRepository, fromDate, toDate) });
  }));

  router.post("/gm/get-mailbox-logs", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const { playerId, fromDate, toDate } = parseGmLogQuery(req.body);
    res.json({ result: 0, message: "OK", data: await getMailboxLogsForGm(playerId, playerRepository, fromDate, toDate) });
  }));

  return router;
}
