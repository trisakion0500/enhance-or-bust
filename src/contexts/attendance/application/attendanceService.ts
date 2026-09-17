import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { COLLECTIONS } from "../../../shared-kernel/collectionNames.js";
import { writeAuditLog } from "../../../shared-kernel/auditLog.js";
import { addDaysToDateString, daysBetweenDateStrings, todayDateString } from "../../../shared-kernel/dateUtil.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { mongoClient } from "../../../infra/mongo.js";
import { sendMail } from "../../mailbox/application/mailboxService.js";
import { Mail, MAIL_EXPIRY_MS } from "../../mailbox/domain/mail.js";
import type { MailAttachments } from "../../mailbox/domain/mail.js";
import type { MailboxRepository } from "../../mailbox/domain/mailboxRepository.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import type { PlayerDocument } from "../../player/infrastructure/mongoPlayerRepository.js";
import type { AttendanceBookDef, AttendanceBookType } from "../domain/attendanceBookDef.js";
import type { AttendanceInstance, AttendanceInstanceSnapshot } from "../domain/attendanceInstance.js";
import type { AttendanceRewardItemType } from "../domain/attendanceReward.js";
import {
  addAttendedDay,
  findActiveGeneralInstance,
  findActiveInstances,
  findInstanceAnyStatus,
  hasAnyInstanceForDef,
  incrementCatchupCount,
  insertInstance,
  markInstanceCompleted,
} from "../infrastructure/attendanceStore.js";

/** 로그인 처리 흐름에서 오늘 자동 지급된 보상 한 건(프론트 토스트 안내용).
 * @author trisakion
 */
export interface AttendanceGrantNotice {
  defId: string;
  type: AttendanceBookType;
  /** 출석부 내 일차(1-based) — 지급된 날 */
  day: number;
}

/** {@link processLoginAttendance}의 결과 — 프론트가 이 응답 하나로 알럿/토스트를 띄운다.
 * @author trisakion
 */
export interface AttendanceLoginResult {
  /** 오늘 새로 지급된 보상 목록(GENERAL 최대 1건 + EVENT N건) */
  granted: AttendanceGrantNotice[];
  /** 오늘 GENERAL이 신규 발급(최초 or 로테이션)됐는지 — 그날만 "새로운 출석부가 시작됐습니다" 안내 */
  generalStarted: boolean;
}

/** 출석 날짜 하나의 프론트 표시 상태(달력 UI).
 * @author trisakion
 */
export type AttendanceDayState = "ATTENDED" | "CATCHUP_AVAILABLE" | "CATCHUP_UNAVAILABLE" | "TODAY" | "FUTURE";

/** 출석 달력의 날짜 한 칸.
 * @author trisakion
 */
export interface AttendanceDayView {
  day: number;
  state: AttendanceDayState;
  rewards: Array<{ itemType: AttendanceRewardItemType; amount: number; cardTemplateId: string | null }>;
}

/** 캐치업 구매 버튼에 필요한 정보 — 프론트 요구사항(23_GAME_DESIGN_ATTENDANCE.md "캐치업 구매 버튼" 절).
 * @author trisakion
 */
export interface AttendanceCatchupView {
  remainingPurchases: number;
  /** 다음 구매 가격 — 구매 가능 횟수를 소진했으면 null */
  nextPrice: number | null;
  /** 보유 골드로 다음 구매가 가능한지 */
  canAfford: boolean;
}

/** 출석부 하나(GENERAL 또는 EVENT 한 건)의 현재 진행 상태 뷰.
 * @author trisakion
 */
export interface AttendanceBookView {
  defId: string;
  type: AttendanceBookType;
  startDate: string;
  endDate: string;
  days: AttendanceDayView[];
  catchup: AttendanceCatchupView;
}

/** {@link getAttendanceStatus}의 결과.
 * @author trisakion
 */
export interface AttendanceStatusView {
  /** GENERAL 인스턴스 — 미보유(발급 대상 def 자체가 없는 극초반 등)면 null */
  general: AttendanceBookView | null;
  /** EVENT 인스턴스 목록 — endDate 오름차순(곧 끝나는 이벤트가 먼저, 프론트 요구사항) */
  events: AttendanceBookView[];
}

/** 발급 시점 def/보상/캐치업가격을 스냅샷으로 굳힌다(시드 스냅샷 원칙 — def 원본이 나중에 바뀌어도 무관). */
function buildSnapshot(def: AttendanceBookDef): AttendanceInstanceSnapshot {
  return {
    durationDays: def.durationDays,
    catchupMaxCount: def.catchupMaxCount,
    rewards: masterDataCache
      .getAttendanceRewards(def.defId)
      .map(r => ({ day: r.day, itemType: r.itemType, amount: r.amount, cardTemplateId: r.cardTemplateId })),
    catchupPrices: masterDataCache.getAttendanceCatchupPrices(def.defId).map(p => ({ purchaseIndex: p.purchaseIndex, price: p.price })),
  };
}

/** 보상 행 목록을 Mailbox 첨부물로 합산한다(카드는 amount만큼 templateId를 반복해 담는다). */
function toAttachments(rows: AttendanceInstanceSnapshot["rewards"]): MailAttachments {
  const attachments: MailAttachments = {};
  for (const row of rows) {
    if (row.itemType === "gold") attachments.gold = (attachments.gold ?? 0) + row.amount;
    else if (row.itemType === "enhancementStone") attachments.enhancementStone = (attachments.enhancementStone ?? 0) + row.amount;
    else if (row.itemType === "diamond") attachments.diamond = (attachments.diamond ?? 0) + row.amount;
    else if (row.itemType === "card" && row.cardTemplateId)
      attachments.cardTemplateIds = [...(attachments.cardTemplateIds ?? []), ...Array<string>(row.amount).fill(row.cardTemplateId)];
  }
  return attachments;
}

/** Mailbox 멱등키의 sourceType — GENERAL/EVENT 구분(23_GAME_DESIGN_ATTENDANCE.md "원자성/트랜잭션 전략" 표). */
function attendanceSourceType(type: AttendanceBookType): string {
  return type === "GENERAL" ? "attendance" : "attendance_event";
}

/**
 * 인스턴스 하나에 대해 "오늘" 보상을 아직 못 받았으면 지급한다. 순서 고정: Mailbox 발송이
 * 반드시 먼저, `$addToSet` 출석 마킹이 반드시 나중 — 순서를 바꾸면 지급 직후 크래시 시 다음
 * 로그인이 "이미 출석했다"고 오인해 그 날짜 보상이 영구 유실된다(설계 문서 "로그인 시 처리
 * 흐름" 절).
 * @returns 실제로 지급된 일차(이미 처리됐거나 오늘이 유효 범위 밖이면 null)
 */
async function grantTodayIfNeeded(
  db: Db,
  mailboxRepository: MailboxRepository,
  playerId: string,
  instance: AttendanceInstance,
  today: string,
): Promise<number | null> {
  const currentDay = daysBetweenDateStrings(instance.startDate, today) + 1;
  if (currentDay < 1 || currentDay > instance.snapshot.durationDays) return null;
  if (instance.attendedDays.includes(currentDay)) return null;

  const attachments = toAttachments(instance.snapshot.rewards.filter(r => r.day === currentDay));
  const sourceId = `${playerId}_${instance.defId}_${currentDay}`;
  const inserted = await sendMail(playerId, "출석 보상", attachments, attendanceSourceType(instance.type), sourceId, mailboxRepository);
  await addAttendedDay(db, instance._id, currentDay);
  if (inserted)
    await writeAuditLog(COLLECTIONS.LOG_ATTENDANCE, {
      actorId: playerId,
      action: "attend",
      changes: { defId: instance.defId, type: instance.type, day: currentDay, attachments },
    });
  return currentDay;
}

/** 새 인스턴스를 발급하고 감사 로그를 남긴다. 동시 로그인 레이스로 이미 발급돼 있으면 null. */
async function issueInstance(db: Db, playerId: string, def: AttendanceBookDef, today: string): Promise<AttendanceInstance | null> {
  const instance = await insertInstance(db, {
    playerId,
    defId: def.defId,
    type: def.type,
    snapshot: buildSnapshot(def),
    catchupPurchaseCount: 0,
    startDate: today,
    endDate: addDaysToDateString(today, def.durationDays),
    attendedDays: [],
    status: "ACTIVE",
    issuedAt: new Date(),
  });
  if (instance)
    await writeAuditLog(COLLECTIONS.LOG_ATTENDANCE, {
      actorId: playerId,
      action: "issue",
      changes: { defId: def.defId, type: def.type, startDate: instance.startDate, endDate: instance.endDate },
    });
  return instance;
}

/**
 * 로그인(`GET /player/me`) 시 출석보상을 처리한다 — GENERAL/EVENT 공통 단일 함수
 * (23_GAME_DESIGN_ATTENDANCE.md "로그인 시 처리 흐름" 절). 페이지 진입/새로고침마다 호출되므로
 * 멱등해야 하는데, 매 단계가 "미출석/미발급 여부"를 먼저 확인하고서만 쓰기를 하도록 되어 있어
 * 별도 스킵 로직 없이 그대로 재호출해도 안전하다.
 *
 * 처리 순서: ①보유 중인 모든 ACTIVE 인스턴스에 대해 오늘자 보상 지급 시도 → 종료됐으면
 * COMPLETED 처리 ②GENERAL이 현재 미보유(방금 완료됐거나 최초)면 활성 def로 재발급(로테이션과
 * 최초발급이 같은 로직) ③아직 발급받은 적 없는 활성 EVENT def가 있으면 신규 발급. 새로 발급된
 * 인스턴스는 그 자리에서 곧바로 오늘자(1일차) 보상까지 지급해, "발급 자체는 이번 로그인에
 * 됐는데 1일차 보상은 다음 로그인에야 나간다"는 어색한 지연이 없게 한다.
 * @param playerId 로그인한 플레이어
 * @param db 메인 앱 DB 핸들
 * @param mailboxRepository Mailbox 영속성 포트
 * @returns 오늘 새로 지급된 보상 목록과 GENERAL 신규발급/로테이션 여부
 * @author trisakion
 */
export async function processLoginAttendance(playerId: string, db: Db, mailboxRepository: MailboxRepository): Promise<AttendanceLoginResult> {
  const today = todayDateString();
  const granted: AttendanceGrantNotice[] = [];
  let generalStarted = false;

  const activeInstances = await findActiveInstances(db, playerId);
  for (const instance of activeInstances) {
    const day = await grantTodayIfNeeded(db, mailboxRepository, playerId, instance, today);
    if (day !== null) granted.push({ defId: instance.defId, type: instance.type, day });

    if (today >= instance.endDate) await markInstanceCompleted(db, instance._id);
  }

  const generalDef = masterDataCache.getActiveGeneralDef();
  if (generalDef && !(await findActiveGeneralInstance(db, playerId))) {
    const issued = await issueInstance(db, playerId, generalDef, today);
    if (issued) {
      generalStarted = true;
      const day = await grantTodayIfNeeded(db, mailboxRepository, playerId, issued, today);
      if (day !== null) granted.push({ defId: issued.defId, type: issued.type, day });
    }
  }

  for (const def of masterDataCache.getActiveEventDefs()) {
    if (await hasAnyInstanceForDef(db, playerId, def.defId)) continue;
    const issued = await issueInstance(db, playerId, def, today);
    if (issued) {
      const day = await grantTodayIfNeeded(db, mailboxRepository, playerId, issued, today);
      if (day !== null) granted.push({ defId: issued.defId, type: issued.type, day });
    }
  }

  return { granted, generalStarted };
}

/** {@link getAttendanceStatus}가 인스턴스 하나를 프론트 표시용 뷰로 변환한다. */
function buildBookView(instance: AttendanceInstance, today: string, gold: number): AttendanceBookView {
  const currentDay = daysBetweenDateStrings(instance.startDate, today) + 1;
  const days: AttendanceDayView[] = [];
  for (let day = 1; day <= instance.snapshot.durationDays; day++) {
    const rewards = instance.snapshot.rewards
      .filter(r => r.day === day)
      .map(r => ({ itemType: r.itemType, amount: r.amount, cardTemplateId: r.cardTemplateId }));

    let state: AttendanceDayState;
    if (instance.attendedDays.includes(day)) state = day === currentDay ? "TODAY" : "ATTENDED";
    else if (day === currentDay) state = "TODAY";
    else if (day > currentDay) state = "FUTURE";
    else state = instance.catchupPurchaseCount < instance.snapshot.catchupMaxCount ? "CATCHUP_AVAILABLE" : "CATCHUP_UNAVAILABLE";

    days.push({ day, state, rewards });
  }

  const remainingPurchases = Math.max(0, instance.snapshot.catchupMaxCount - instance.catchupPurchaseCount);
  const nextPriceRow = instance.snapshot.catchupPrices.find(p => p.purchaseIndex === instance.catchupPurchaseCount + 1);
  const nextPrice = remainingPurchases > 0 ? (nextPriceRow?.price ?? null) : null;

  return {
    defId: instance.defId,
    type: instance.type,
    startDate: instance.startDate,
    endDate: instance.endDate,
    days,
    catchup: { remainingPurchases, nextPrice, canAfford: nextPrice !== null && gold >= nextPrice },
  };
}

/**
 * 플레이어의 현재 출석부 진행 상태(달력 뷰 + 캐치업 구매 정보)를 조회한다 — 출석 화면
 * 전용 조회 API 1개(23_GAME_DESIGN_ATTENDANCE.md "API" 절)의 백엔드. 날짜별 상태 계산은
 * 전부 서버가 하고 프론트는 그대로 렌더링만 한다(프론트 직접 계산 금지 원칙).
 * @param playerId 조회할 플레이어
 * @param db 메인 앱 DB 핸들
 * @param playerRepository 보유 골드 조회용(캐치업 구매 가능 여부 판단)
 * @returns GENERAL 1건(없으면 null) + EVENT 목록(endDate 오름차순)
 * @throws {BusinessException} 세션은 유효한데 플레이어 문서가 없는 이례적 상황이면 COMMON.NOT_FOUND
 * @author trisakion
 */
export async function getAttendanceStatus(playerId: string, db: Db, playerRepository: PlayerRepository): Promise<AttendanceStatusView> {
  const player = await playerRepository.findById(playerId);
  if (!player) throw new BusinessException(ERROR_MAP.COMMON.NOT_FOUND, { playerId });

  const today = todayDateString();
  const instances = await findActiveInstances(db, playerId);
  const general = instances.find(i => i.type === "GENERAL") ?? null;
  const events = instances.filter(i => i.type === "EVENT").sort((a, b) => a.endDate.localeCompare(b.endDate));

  return {
    general: general ? buildBookView(general, today, player.economy.gold) : null,
    events: events.map(e => buildBookView(e, today, player.economy.gold)),
  };
}

/**
 * 놓친 날짜를 골드로 구매한다 — players(골드 차감)+mailbox(보상 지급)+attendance_instances(출석
 * 처리+구매횟수 증가) 3개 컬렉션을 세션 트랜잭션으로 묶는다(ClaimMail과 동일 근거,
 * 23_GAME_DESIGN_ATTENDANCE.md "구매 처리 흐름" 절). 자동지급과 동일한 sourceId
 * (`{playerId}_{defId}_{day}`)를 써서 Mailbox 유니크 인덱스 하나로 이중 지급을 막는다 —
 * 이미 자동지급이 나간 날짜를 구매 시도하면 Mailbox insert가 멱등 스킵(false)되고, 그 자리에서
 * 트랜잭션을 abort해 방금 조건부로 차감한 골드도 함께 롤백된다. `sendMail()`(세션 미지원)을
 * 쓰지 않고 `mailboxRepository.insertMail()`을 세션과 함께 직접 호출하는 이유도 이 트랜잭션
 * 요구사항 때문 — 대신 그 함수가 대신 해주던 log_mailbox 감사 로그는 커밋 후 여기서 직접 남긴다.
 * @param playerId 구매하는 플레이어
 * @param defId 대상 출석부
 * @param day 구매할 일차(1-based, 출석부 내 경과일 — 캘린더 날짜 아님)
 * @param db 메인 앱 DB 핸들
 * @param mailboxRepository Mailbox 영속성 포트
 * @returns 지급된 첨부물과 실제 지불한 가격
 * @throws {BusinessException} 대상 인스턴스가 없으면 ATTENDANCE.NOT_FOUND, 이미 종료됐으면
 *   ATTENDANCE.INSTANCE_NOT_ACTIVE, day가 유효 범위(1 이상, 오늘 미만) 밖이면
 *   ATTENDANCE.VALIDATION_FAILED, 이미 출석 처리된 날짜면 ATTENDANCE.ALREADY_GRANTED, 캐치업
 *   구매 횟수를 소진했으면 ATTENDANCE.CATCHUP_LIMIT_EXCEEDED, 골드가 부족하면
 *   ATTENDANCE.GOLD_INSUFFICIENT
 * @author trisakion
 */
export async function purchaseCatchup(
  playerId: string,
  defId: string,
  day: number,
  db: Db,
  mailboxRepository: MailboxRepository,
): Promise<{ attachments: MailAttachments; price: number }> {
  const today = todayDateString();
  const session = mongoClient.startSession();
  let result: { attachments: MailAttachments; price: number; type: AttendanceBookType } | undefined;

  try {
    await session.withTransaction(async () => {
      const instance = await findInstanceAnyStatus(db, playerId, defId, session);
      if (!instance) throw new BusinessException(ERROR_MAP.ATTENDANCE.NOT_FOUND, { playerId, defId });
      if (instance.status !== "ACTIVE") throw new BusinessException(ERROR_MAP.ATTENDANCE.INSTANCE_NOT_ACTIVE, { playerId, defId });

      const currentDay = daysBetweenDateStrings(instance.startDate, today) + 1;
      if (!Number.isInteger(day) || day < 1 || day >= currentDay)
        throw new BusinessException(ERROR_MAP.ATTENDANCE.VALIDATION_FAILED, { day, currentDay });
      if (instance.attendedDays.includes(day)) throw new BusinessException(ERROR_MAP.ATTENDANCE.ALREADY_GRANTED, { defId, day });
      if (instance.catchupPurchaseCount >= instance.snapshot.catchupMaxCount)
        throw new BusinessException(ERROR_MAP.ATTENDANCE.CATCHUP_LIMIT_EXCEEDED, { playerId, defId });

      const purchaseIndex = instance.catchupPurchaseCount + 1;
      const priceRow = instance.snapshot.catchupPrices.find(p => p.purchaseIndex === purchaseIndex);
      if (!priceRow) throw new BusinessException(ERROR_MAP.ATTENDANCE.INTERNAL_ERROR, { defId, purchaseIndex });
      const price = priceRow.price;

      // TOCTOU 방지: 조건부 $gte 차감 — 트랜잭션 자체가 write-conflict 직렬화를 해주므로
      // ClaimMail의 players 쓰기와 동일하게 낙관적 락(version 비교) 대신 조건부 갱신만으로 충분하다.
      const deducted = await db
        .collection<PlayerDocument>(COLLECTIONS.PLAYERS)
        .updateOne({ _id: playerId, "economy.gold": { $gte: price } }, { $inc: { "economy.gold": -price, version: 1 } }, { session });
      if (deducted.matchedCount === 0) throw new BusinessException(ERROR_MAP.ATTENDANCE.GOLD_INSUFFICIENT, { playerId, price });

      const attachments = toAttachments(instance.snapshot.rewards.filter(r => r.day === day));
      const sourceId = `${playerId}_${defId}_${day}`;
      const createdAt = new Date();
      const mail = new Mail(
        randomUUID(),
        playerId,
        "출석 보상(캐치업)",
        attachments,
        attendanceSourceType(instance.type),
        sourceId,
        createdAt,
        new Date(createdAt.getTime() + MAIL_EXPIRY_MS),
        null,
      );
      const inserted = await mailboxRepository.insertMail(mail, session);
      // 이미 자동지급이 나갔던 날짜(좁은 레이스) — 방금 차감한 골드도 트랜잭션 abort로 함께 롤백된다.
      if (!inserted) throw new BusinessException(ERROR_MAP.ATTENDANCE.ALREADY_GRANTED, { defId, day });

      await addAttendedDay(db, instance._id, day, session);
      await incrementCatchupCount(db, instance._id, session);

      result = { attachments, price, type: instance.type };
    });
  } finally {
    await session.endSession();
  }

  await writeAuditLog(COLLECTIONS.LOG_ATTENDANCE, {
    actorId: playerId,
    action: "catchup_purchase",
    changes: { defId, day, price: result!.price, attachments: result!.attachments },
  });
  await writeAuditLog(COLLECTIONS.LOG_MAILBOX, {
    actorId: playerId,
    action: "send",
    changes: { title: "출석 보상(캐치업)", attachments: result!.attachments, sourceType: attendanceSourceType(result!.type), sourceId: `${playerId}_${defId}_${day}` },
  });

  return { attachments: result!.attachments, price: result!.price };
}
