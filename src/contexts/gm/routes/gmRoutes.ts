import { Router } from "express";
import type { Db } from "mongodb";
import { asyncHandler } from "../../../shared-kernel/errorHandler.js";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { gmApiKeyAuth } from "../../../shared-kernel/gmApiKeyAuth.js";
import type { AttendanceBookType, AttendanceTargetAudience } from "../../attendance/domain/attendanceBookDef.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import type { Grade } from "../../../shared-kernel/masterData/grade.js";
import type { Element } from "../../../shared-kernel/masterData/element.js";
import type { AttendanceBookDefSaveInput, AttendanceDayRewardInput, CardTemplateSaveRow, EnhancementRuleSaveRow } from "../application/gmService.js";
import {
  getAttendanceCatchupPricesForGm,
  getAttendanceDefsForGm,
  getAttendanceLogsForGm,
  getAttendanceRewardsForGm,
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
  saveAttendanceBookDefForGm,
  saveAttendanceCatchupPricesForGm,
  saveAttendanceRewardsForGm,
  saveCardTemplatesForGm,
  saveEnhancementRulesForGm,
} from "../application/gmService.js";

const ATTENDANCE_BOOK_TYPES: AttendanceBookType[] = ["GENERAL", "EVENT"];
const ATTENDANCE_TARGET_AUDIENCES: AttendanceTargetAudience[] = ["ALL_USERS", "NEW_USER", "RETURNING_USER"];
const GRADES: Grade[] = ["N", "R", "SR", "SSR"];
const ELEMENTS: Element[] = ["fire", "water", "grass"];

/**
 * `POST /gm/save-attendance-def` 요청 바디를 검증된 형태로 파싱한다 — 형식 검증만 담당하고
 * (필수 필드/타입/enum 값), defId 중복·기간 겹침 등 비즈니스 검증은
 * `saveAttendanceBookDefForGm()`의 책임이다.
 * @param body 요청 바디
 * @returns 파싱된 저장 요청
 * @throws {BusinessException} 필수 필드 누락, 타입 불일치, ISO 날짜 파싱 실패 시 GM.VALIDATION_FAILED
 * @author trisakion
 */
function parseAttendanceBookDefSave(body: unknown): AttendanceBookDefSaveInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const fail = (): never => {
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body });
  };

  if (b.id !== undefined && typeof b.id !== "string") fail();
  if (typeof b.defId !== "string" || !b.defId) fail();
  if (typeof b.name !== "string" || !b.name) fail();
  if (typeof b.type !== "string" || !ATTENDANCE_BOOK_TYPES.includes(b.type as AttendanceBookType)) fail();
  if (typeof b.targetAudience !== "string" || !ATTENDANCE_TARGET_AUDIENCES.includes(b.targetAudience as AttendanceTargetAudience)) fail();
  if (b.returningInactiveDays !== undefined && typeof b.returningInactiveDays !== "number") fail();
  if (typeof b.maxRotationCount !== "number") fail();
  if (typeof b.durationDays !== "number") fail();
  if (typeof b.catchupMaxCount !== "number") fail();
  if (typeof b.enrollableStart !== "string" || typeof b.enrollableEnd !== "string") fail();

  const enrollableStart = new Date(b.enrollableStart as string);
  const enrollableEnd = new Date(b.enrollableEnd as string);
  if (Number.isNaN(enrollableStart.getTime()) || Number.isNaN(enrollableEnd.getTime())) fail();

  return {
    id: b.id as string | undefined,
    defId: b.defId as string,
    name: b.name as string,
    type: b.type as AttendanceBookType,
    targetAudience: b.targetAudience as AttendanceTargetAudience,
    returningInactiveDays: b.returningInactiveDays as number | undefined,
    maxRotationCount: b.maxRotationCount as number,
    enrollableStart,
    enrollableEnd,
    durationDays: b.durationDays as number,
    catchupMaxCount: b.catchupMaxCount as number,
  };
}

/**
 * 선택 수량 입력칸 파싱 — gm_platform 화면에서 비워두면 값이 아예 안 오거나 null/빈 문자열로 올 수 있어
 * 전부 0(해당 아이템 없음)으로 취급한다.
 * @param value 요청 바디의 해당 필드 값
 * @returns 숫자면 그 값, 비어있으면 0
 * @throws {BusinessException} 숫자도 비어있음도 아니면 GM.VALIDATION_FAILED
 * @author trisakion
 */
function parseOptionalCount(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value !== "number") throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { value });
  return value;
}

/**
 * `POST /gm/save-attendance-rewards` 요청 바디 파싱 — defId/day(필수) + 아이템별 수량 입력칸(선택).
 * 값 범위/카드 원형 존재 여부 등 비즈니스 검증은 서비스 책임이다.
 * @param body 요청 바디
 * @returns 파싱된 defId와 하루치 보상 입력
 * @throws {BusinessException} 필수 값 누락이나 타입 불일치 시 GM.VALIDATION_FAILED
 * @author trisakion
 */
function parseAttendanceRewardsSave(body: unknown): { defId: string; input: AttendanceDayRewardInput } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.defId !== "string" || !b.defId) throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body });
  if (typeof b.day !== "number") throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body });
  if (b.cardTemplateId !== undefined && b.cardTemplateId !== null && typeof b.cardTemplateId !== "string")
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body });

  return {
    defId: b.defId,
    input: {
      day: b.day,
      gold: parseOptionalCount(b.gold),
      enhancementStone: parseOptionalCount(b.enhancementStone),
      diamond: parseOptionalCount(b.diamond),
      cardTemplateId: (b.cardTemplateId as string | null | undefined) || undefined,
      cardCount: parseOptionalCount(b.cardCount),
    },
  };
}

/**
 * `POST /gm/save-attendance-catchup-prices` 요청 바디 파싱 — defId/purchaseIndex/price(전부 필수).
 * @param body 요청 바디
 * @returns 파싱된 defId/purchaseIndex/price
 * @throws {BusinessException} 필수 값 누락이나 타입 불일치 시 GM.VALIDATION_FAILED
 * @author trisakion
 */
function parseAttendanceCatchupPriceSave(body: unknown): { defId: string; purchaseIndex: number; price: number } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.defId !== "string" || !b.defId || typeof b.purchaseIndex !== "number" || typeof b.price !== "number")
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body });
  return { defId: b.defId, purchaseIndex: b.purchaseIndex, price: b.price };
}

/**
 * `POST /gm/save-card-templates` 요청 바디를 검증된 형태로 파싱한다 — 형식/타입/enum 값만
 * 담당하고(templateId 중복, 삭제 후보 참조 여부 등 비즈니스 검증은 `saveCardTemplatesForGm()`의
 * 책임), gm_platform EDITABLE_GRID가 보내는 `data` 배열을 그대로 행 목록으로 받는다.
 * @param body 요청 바디
 * @returns 파싱된 카드 원형 저장 행 목록
 * @throws {BusinessException} `data`가 배열이 아니거나 행 형식이 올바르지 않으면 GM.VALIDATION_FAILED
 * @author trisakion
 */
function parseCardTemplatesSave(body: unknown): CardTemplateSaveRow[] {
  const { data } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(data)) throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body });

  return data.map(row => {
    const r = (row ?? {}) as Record<string, unknown>;
    const fail = (): never => {
      throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { row });
    };

    if (typeof r.templateId !== "string" || !r.templateId) fail();
    if (typeof r.grade !== "string" || !GRADES.includes(r.grade as Grade)) fail();
    if (typeof r.element !== "string" || !ELEMENTS.includes(r.element as Element)) fail();
    if (typeof r.baseAttack !== "number" || !Number.isInteger(r.baseAttack) || r.baseAttack < 1) fail();
    if (typeof r.baseHp !== "number" || !Number.isInteger(r.baseHp) || r.baseHp < 1) fail();

    return {
      templateId: r.templateId as string,
      grade: r.grade as Grade,
      element: r.element as Element,
      baseAttack: r.baseAttack as number,
      baseHp: r.baseHp as number,
    };
  });
}

/**
 * `POST /gm/save-enhancement-rules` 요청 바디를 검증된 형태로 파싱한다 — 형식/범위만
 * 담당하고(자연키 중복, 구간 겹침 등 행 간 비교 검증은 `saveEnhancementRulesForGm()`의
 * 책임), gm_platform EDITABLE_GRID가 보내는 `data` 배열을 그대로 행 목록으로 받는다.
 * @param body 요청 바디
 * @returns 파싱된 강화 규칙 저장 행 목록
 * @throws {BusinessException} `data`가 배열이 아니거나 행 형식이 올바르지 않으면 GM.VALIDATION_FAILED
 * @author trisakion
 */
function parseEnhancementRulesSave(body: unknown): EnhancementRuleSaveRow[] {
  const { data } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(data)) throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body });

  return data.map(row => {
    const r = (row ?? {}) as Record<string, unknown>;
    const fail = (): never => {
      throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { row });
    };

    if (typeof r.minTargetEnhancementLevel !== "number" || !Number.isInteger(r.minTargetEnhancementLevel) || r.minTargetEnhancementLevel < 1) fail();
    const minLevel = r.minTargetEnhancementLevel as number;
    if (typeof r.maxTargetEnhancementLevel !== "number" || !Number.isInteger(r.maxTargetEnhancementLevel) || r.maxTargetEnhancementLevel < minLevel) fail();
    if (typeof r.successRate !== "number" || r.successRate < 0 || r.successRate > 1) fail();
    if (typeof r.destroyOnFailChance !== "number" || r.destroyOnFailChance < 0 || r.destroyOnFailChance > 1) fail();
    if (typeof r.goldMultiplier !== "number" || !Number.isInteger(r.goldMultiplier) || r.goldMultiplier < 0) fail();
    if (typeof r.stoneCost !== "number" || !Number.isInteger(r.stoneCost) || r.stoneCost < 0) fail();

    return {
      minTargetEnhancementLevel: r.minTargetEnhancementLevel as number,
      maxTargetEnhancementLevel: r.maxTargetEnhancementLevel as number,
      successRate: r.successRate as number,
      destroyOnFailChance: r.destroyOnFailChance as number,
      goldMultiplier: r.goldMultiplier as number,
      stoneCost: r.stoneCost as number,
    };
  });
}

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
 * 출석부 보상/캐치업가격 조회 라우트 2개가 공통으로 쓰는 요청 파라미터 파싱 — defId(선택
 * 문자열, 없으면 전체 반환).
 * @param body 요청 바디
 * @returns 파싱된 defId(없으면 undefined)
 * @throws {BusinessException} defId 타입이 문자열이 아니면 GM.VALIDATION_FAILED
 * @author trisakion
 */
function parseOptionalDefId(body: unknown): string | undefined {
  const { defId } = (body ?? {}) as Record<string, unknown>;
  if (defId !== undefined && typeof defId !== "string")
    throw new BusinessException(ERROR_MAP.GM.VALIDATION_FAILED, { body });
  return defId;
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
 * @param db 메인 앱 DB 핸들(출석부 정의 저장 라우트가 사용)
 * @returns 등록된 Express Router
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 * @modified 2026-09-17 trisakion 출석부 정의/보상/캐치업가격 GM 조회 라우트 3종 추가
 * @modified 2026-09-21 trisakion 출석부 정의/보상/캐치업가격 저장 라우트 3종(POST
 *   /gm/save-attendance-def, save-attendance-rewards, save-attendance-catchup-prices) 추가,
 *   db 파라미터 신규(저장 검증/쓰기가 DB 접근 필요)
 * @modified 2026-09-29 trisakion 카드 원형 저장(POST /gm/save-card-templates), 강화 규칙 저장
 *   (POST /gm/save-enhancement-rules) 라우트 추가
 */
export function createGmRoutes(playerRepository: PlayerRepository, db: Db): Router {
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

  // 시드데이터(마스터데이터) 9종 — 카드 원형/강화 규칙/출석부 3종 외에는 아직 조회만, 수정/삭제는 없다.
  router.post("/gm/get-card-templates", gmApiKeyAuth, asyncHandler(async (_req, res) => {
    res.json({ result: 0, message: "OK", data: getCardTemplatesForGm() });
  }));

  router.post("/gm/save-card-templates", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const rows = parseCardTemplatesSave(req.body);
    res.json({ result: 0, message: "OK", data: await saveCardTemplatesForGm(db, rows) });
  }));

  router.post("/gm/get-grade-configs", gmApiKeyAuth, asyncHandler(async (_req, res) => {
    res.json({ result: 0, message: "OK", data: getGradeConfigsForGm() });
  }));

  router.post("/gm/get-enhancement-rules", gmApiKeyAuth, asyncHandler(async (_req, res) => {
    res.json({ result: 0, message: "OK", data: getEnhancementRulesForGm() });
  }));

  router.post("/gm/save-enhancement-rules", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const rows = parseEnhancementRulesSave(req.body);
    res.json({ result: 0, message: "OK", data: await saveEnhancementRulesForGm(db, rows) });
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

  router.post("/gm/get-attendance-defs", gmApiKeyAuth, asyncHandler(async (_req, res) => {
    res.json({ result: 0, message: "OK", data: getAttendanceDefsForGm() });
  }));

  router.post("/gm/get-attendance-rewards", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const defId = parseOptionalDefId(req.body);
    res.json({ result: 0, message: "OK", data: getAttendanceRewardsForGm(defId) });
  }));

  router.post("/gm/get-attendance-catchup-prices", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const defId = parseOptionalDefId(req.body);
    res.json({ result: 0, message: "OK", data: getAttendanceCatchupPricesForGm(defId) });
  }));

  router.post("/gm/save-attendance-def", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const input = parseAttendanceBookDefSave(req.body);
    const saved = await saveAttendanceBookDefForGm(db, input);
    res.json({ result: 0, message: "OK", data: [saved] });
  }));

  router.post("/gm/save-attendance-rewards", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const { defId, input } = parseAttendanceRewardsSave(req.body);
    res.json({ result: 0, message: "OK", data: await saveAttendanceRewardsForGm(db, defId, input) });
  }));

  router.post("/gm/save-attendance-catchup-prices", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const { defId, purchaseIndex, price } = parseAttendanceCatchupPriceSave(req.body);
    res.json({ result: 0, message: "OK", data: await saveAttendanceCatchupPricesForGm(db, defId, purchaseIndex, price) });
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

  router.post("/gm/get-attendance-logs", gmApiKeyAuth, asyncHandler(async (req, res) => {
    const { playerId, fromDate, toDate } = parseGmLogQuery(req.body);
    res.json({ result: 0, message: "OK", data: await getAttendanceLogsForGm(playerId, playerRepository, fromDate, toDate) });
  }));

  return router;
}
