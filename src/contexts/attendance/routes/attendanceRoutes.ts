import { Router } from "express";
import type { Db } from "mongodb";
import { getAttendanceStatus, purchaseCatchup } from "../application/attendanceService.js";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { requireAuth } from "../../../shared-kernel/sessionAuth.js";
import type { MailboxRepository } from "../../mailbox/domain/mailboxRepository.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";

/**
 * 출석보상 라우터. 다른 보호 라우트와 동일하게 세션 인증이 필요해 라우터 전체에 `requireAuth`를
 * 붙인다(23_GAME_DESIGN_ATTENDANCE.md "API" 절 — 자동 지급 자체는 `GET /player/me`에서 처리되고,
 * 여기는 조회 화면과 캐치업 구매 2개만 다룬다).
 * @param playerRepository Player 영속성 포트(DI) — 캐치업 구매 가능 여부 판단(보유 골드)에 사용
 * @param mailboxRepository Mailbox 영속성 포트(DI) — 캐치업 보상 지급에 사용
 * @param db 메인 앱 DB 핸들(출석 인스턴스 조회/갱신용)
 * @returns 등록된 Express Router
 * @author trisakion
 */
export function createAttendanceRoutes(playerRepository: PlayerRepository, mailboxRepository: MailboxRepository, db: Db): Router {
  const router = Router();
  router.use(requireAuth);

  router.get("/attendance", asyncHandler(async (req, res) => {
    const status = await getAttendanceStatus(req.playerId, db, playerRepository);
    res.json({ result: 0, ...status });
  }));

  router.post("/attendance/:defId/catchup", asyncHandler(async (req, res) => {
    const { day } = req.body ?? {};
    if (typeof day !== "number")
      throw new BusinessException(ERROR_MAP.ATTENDANCE.VALIDATION_FAILED, { body: req.body });

    const result = await purchaseCatchup(req.playerId, req.params.defId, day, db, mailboxRepository);
    res.json({ result: 0, ...result });
  }));

  return router;
}
