import { randomUUID } from "node:crypto";
import type { ClientSession, Db, MongoServerError } from "mongodb";
import { COLLECTIONS } from "../../../shared-kernel/collectionNames.js";
import { bumpMasterDataVersion } from "../../../shared-kernel/masterData/masterDataVersion.js";
import type { AttendanceBookDef } from "../domain/attendanceBookDef.js";
import type { AttendanceCatchupPrice } from "../domain/attendanceCatchupPrice.js";
import type { AttendanceInstance } from "../domain/attendanceInstance.js";
import type { AttendanceReward } from "../domain/attendanceReward.js";

/**
 * 출석보상 컬렉션 4종의 인덱스를 보장한다(서버 기동 시 1회 호출,
 * `mongoMailboxRepository.ensureIndexes()`와 동일 패턴).
 * @param db 메인 앱 DB 핸들
 * @author trisakion
 */
export async function ensureAttendanceIndexes(db: Db): Promise<void> {
  await db.collection(COLLECTIONS.MASTER_ATTENDANCE_DEFS).createIndex({ defId: 1 }, { unique: true });
  await db.collection(COLLECTIONS.MASTER_ATTENDANCE_DEFS).createIndex({ type: 1, enrollableStart: 1, enrollableEnd: 1 });
  await db.collection(COLLECTIONS.MASTER_ATTENDANCE_REWARDS).createIndex({ defId: 1, day: 1 });
  await db.collection(COLLECTIONS.MASTER_ATTENDANCE_CATCHUP_PRICES).createIndex({ defId: 1, purchaseIndex: 1 }, { unique: true });
  // (playerId, defId)당 문서를 정확히 1개만 허용하는 완전 unique 인덱스 — 로테이션마다
  // 새 문서를 쌓지 않고 기존 문서를 in-place로 리셋해 재사용하기 때문에(컬렉션이 무한히
  // 커지는 것을 막기 위한 설계, `upsertInstanceForCycle()` 참고) partial 조건이 필요 없다.
  // 동시 로그인 레이스로 같은 순간에 최초 발급이 두 번 시도되는 경우도 이 인덱스 하나로 막힌다.
  await db.collection(COLLECTIONS.ATTENDANCE_INSTANCES).createIndex({ playerId: 1, defId: 1 }, { unique: true });
  await db.collection(COLLECTIONS.ATTENDANCE_INSTANCES).createIndex({ playerId: 1, type: 1, status: 1 });
}

// ── 출석부 정의 / 날짜별 보상 / 캐치업 가격 (마스터 데이터 — 조회는 masterDataCache 경유) ──
//
// 이 세 컬렉션은 시드 스크립트가 아니라 gm_platform이 실시간으로 쓰기 때문에 여기 쓰기
// 함수만 둔다. 읽기는 매 요청 DB를 조회하지 않고 masterDataCache의 getter(getAttendanceBookDef/
// getActiveGeneralDef/getActiveEventDefs/getAttendanceRewards/getAttendanceCatchupPrices)를
// 쓴다 — Change Stream/폴링이 이 쓰기를 자동으로 캐시에 반영한다(masterDataWatcher.ts는
// 쓰기 주체와 무관하게 event.ns.coll만 본다). 쓰기 후에는 반드시 `bumpMasterDataVersion()`도
// 같이 불러야 폴링 폴백이 정상 동작한다(Change Stream 이벤트가 유실된 경우의 안전망).

/**
 * 출석부 정의를 등록하거나(신규 defId) 갱신한다(기존 defId, 아직 시작 전인 def에 한해
 * gm_platform이 허용). "이미 시작된 def는 수정 불가" 같은 정책 검증은 이 함수의 책임이
 * 아니다 — 호출부(gm 라우트/서비스)가 먼저 검증한 뒤에만 불러야 한다.
 * @param db 메인 앱 DB 핸들
 * @param input 등록/갱신할 출석부 정의(내부 PK/생성·수정 시각 제외)
 * @author trisakion
 */
export async function upsertBookDef(db: Db, input: Omit<AttendanceBookDef, "_id" | "createdAt" | "updatedAt">): Promise<void> {
  const now = new Date();
  await db.collection<AttendanceBookDef>(COLLECTIONS.MASTER_ATTENDANCE_DEFS).updateOne(
    { defId: input.defId },
    { $set: { ...input, updatedAt: now }, $setOnInsert: { _id: randomUUID(), createdAt: now } },
    { upsert: true },
  );
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_ATTENDANCE_DEFS);
}

/**
 * defId의 보상 행 전체를 교체한다(부분 patch 아님 — gm_platform 저장은 항상 "이 defId의
 * 날짜별 보상 구성 전체"를 한 번에 저장하는 단위). 삭제+삽입 두 단계라 원자적이지 않지만,
 * 이 컬렉션은 gm_platform에서만 저빈도로 쓰기 때문에(문서 "원자성/트랜잭션 전략" 표) 세션
 * 트랜잭션을 쓰지 않는다.
 * ponytail: 저빈도 쓰기라 트랜잭션 생략, 동시 저장 충돌이 실사용에서 문제되면 session으로 감싼다.
 * @param db 메인 앱 DB 핸들
 * @param defId 대상 출석부
 * @param rows 새로 저장할 날짜별 보상 행 전체(기존 행은 전부 삭제 후 교체)
 * @author trisakion
 */
export async function replaceRewardRows(db: Db, defId: string, rows: Array<Omit<AttendanceReward, "_id" | "defId">>): Promise<void> {
  const collection = db.collection<AttendanceReward>(COLLECTIONS.MASTER_ATTENDANCE_REWARDS);
  await collection.deleteMany({ defId });
  if (rows.length > 0) await collection.insertMany(rows.map(row => ({ ...row, _id: randomUUID(), defId })));
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_ATTENDANCE_REWARDS);
}

/**
 * @see replaceRewardRows 동일 원칙(전체 교체, 저빈도 쓰기라 트랜잭션 생략)
 * @param db 메인 앱 DB 핸들
 * @param defId 대상 출석부
 * @param rows 새로 저장할 캐치업 회차별 가격 행 전체(기존 행은 전부 삭제 후 교체)
 * @author trisakion
 */
export async function replaceCatchupPriceRows(db: Db, defId: string, rows: Array<Omit<AttendanceCatchupPrice, "_id" | "defId">>): Promise<void> {
  const collection = db.collection<AttendanceCatchupPrice>(COLLECTIONS.MASTER_ATTENDANCE_CATCHUP_PRICES);
  await collection.deleteMany({ defId });
  if (rows.length > 0) await collection.insertMany(rows.map(row => ({ ...row, _id: randomUUID(), defId })));
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_ATTENDANCE_CATCHUP_PRICES);
}

// ── 유저 발급 인스턴스 (런타임 데이터) ───────────────────────────

/** {@link upsertInstanceForCycle}의 결과 — `previous`가 있으면 리셋(재사용), 없으면 최초 발급.
 * @author trisakion
 */
export interface CycleUpsertResult {
  /** 새로 발급되었거나 리셋된 인스턴스(`_id`까지 채워짐) */
  instance: AttendanceInstance;
  /** 리셋인 경우에만 존재 — 덮어써지기 직전 옛 사이클의 최종 상태(감사 로그 `action:"reset"`용) */
  previous: AttendanceInstance | null;
}

/**
 * 이 defId의 인스턴스 문서를 찾아 없으면 최초 발급(insert)하고, 있고 `COMPLETED` 상태에
 * 로테이션 여유가 있으면 같은 문서를 in-place로 리셋해 재사용한다 — `(playerId, defId)`당
 * 문서를 정확히 1개만 유지하기 위함(도메인 JSDoc 참고). 동시성은 두 경로 모두 조건부
 * 쓰기로 방어한다: 최초 발급은 완전 unique 인덱스(11000 중복 키를 무해 무시), 리셋은
 * `updateOne`의 필터에 `rotationCount`를 포함시켜(낙관적 락과 동일 원리) 동시 로그인
 * 레이스로 다른 요청이 먼저 처리했으면 `matchedCount === 0`으로 감지해 무시한다.
 * @param db 메인 앱 DB 핸들
 * @param cycle 이번 사이클에 채울 값(내부 PK/`rotationCount` 제외 — 둘 다 이 함수가 관리)
 * @param maxRotationCount 이 defId의 최대 로테이션 가능 횟수(`AttendanceBookDef.maxRotationCount`)
 * @returns 최초 발급/리셋 결과(`previous`로 신규 발급과 리셋을 구분), 이미 ACTIVE거나
 *   로테이션을 소진했거나 동시 로그인 레이스로 다른 요청이 먼저 처리했으면 null
 * @author trisakion
 */
export async function upsertInstanceForCycle(
  db: Db,
  cycle: Omit<AttendanceInstance, "_id" | "rotationCount">,
  maxRotationCount: number,
): Promise<CycleUpsertResult | null> {
  const collection = db.collection<AttendanceInstance>(COLLECTIONS.ATTENDANCE_INSTANCES);
  const existing = await collection.findOne({ playerId: cycle.playerId, defId: cycle.defId });

  if (!existing) {
    const doc: AttendanceInstance = { ...cycle, _id: randomUUID(), rotationCount: 1 };
    try {
      await collection.insertOne(doc);
      return { instance: doc, previous: null };
    } catch (err) {
      if ((err as MongoServerError).code !== 11000) throw err;
      return null;
    }
  }

  if (existing.status !== "COMPLETED") return null;
  if (existing.rotationCount > maxRotationCount) return null;

  const rotationCount = existing.rotationCount + 1;
  const update = await collection.updateOne(
    { _id: existing._id, status: "COMPLETED", rotationCount: existing.rotationCount },
    { $set: { snapshot: cycle.snapshot, catchupPurchaseCount: 0, startDate: cycle.startDate, endDate: cycle.endDate, attendedDays: [], status: "ACTIVE", issuedAt: cycle.issuedAt, rotationCount } },
  );
  if (update.matchedCount === 0) return null;

  return { instance: { ...existing, snapshot: cycle.snapshot, catchupPurchaseCount: 0, startDate: cycle.startDate, endDate: cycle.endDate, attendedDays: [], status: "ACTIVE", issuedAt: cycle.issuedAt, rotationCount }, previous: existing };
}

/**
 * @param db 메인 앱 DB 핸들
 * @param playerId 조회할 플레이어
 * @returns 상태가 ACTIVE인 인스턴스 전체(GENERAL 최대 1개 + EVENT N개)
 * @author trisakion
 */
export async function findActiveInstances(db: Db, playerId: string): Promise<AttendanceInstance[]> {
  return db.collection<AttendanceInstance>(COLLECTIONS.ATTENDANCE_INSTANCES).find({ playerId, status: "ACTIVE" }).toArray();
}

/**
 * 유저의 현재 활성 GENERAL 인스턴스 — 시스템상 항상 최대 1개만 존재해야 한다.
 * @param db 메인 앱 DB 핸들
 * @param playerId 조회할 플레이어
 * @returns 활성 GENERAL 인스턴스, 없으면 null(최초 로그인 등)
 * @author trisakion
 */
export async function findActiveGeneralInstance(db: Db, playerId: string): Promise<AttendanceInstance | null> {
  return db.collection<AttendanceInstance>(COLLECTIONS.ATTENDANCE_INSTANCES).findOne({ playerId, type: "GENERAL", status: "ACTIVE" });
}

/**
 * 상태와 무관하게 해당 defId의 인스턴스를 찾는다(캐치업 구매 시 "존재하지 않음"과 "존재하지만
 * 이미 종료됨"을 구분해서 에러 응답하기 위한 조회 — ACTIVE만 보는 `findActiveInstances`류와
 * 달리 여기선 COMPLETED도 봐야 한다). `(playerId, defId)`당 문서가 정확히 1개만 존재하므로
 * (로테이션은 문서 재사용, `upsertInstanceForCycle()` 참고) 정렬 없이 단건 조회로 충분하다.
 * @param db 메인 앱 DB 핸들
 * @param playerId 조회할 플레이어
 * @param defId 대상 출석부
 * @param session 캐치업 구매 트랜잭션 안에서 호출할 때만 전달(mailbox `claimMail()`과 동일
 *   패턴) — 트랜잭션 밖 일반 조회는 생략
 * @returns defId의 인스턴스(상태 무관), 발급된 적 없으면 null
 * @author trisakion
 * @modified 2026-09-18 trisakion 문서 1개 재사용 방식으로 바뀌며 issuedAt 정렬 불필요해짐(JSDoc만 갱신, 동작은 동일)
 */
export async function findInstanceAnyStatus(db: Db, playerId: string, defId: string, session?: ClientSession): Promise<AttendanceInstance | null> {
  return db
    .collection<AttendanceInstance>(COLLECTIONS.ATTENDANCE_INSTANCES)
    .findOne({ playerId, defId }, { session, sort: { issuedAt: -1 } });
}

/**
 * @param db 메인 앱 DB 핸들
 * @param instanceId 완료 처리할 인스턴스
 * @author trisakion
 */
export async function markInstanceCompleted(db: Db, instanceId: string): Promise<void> {
  await db.collection<AttendanceInstance>(COLLECTIONS.ATTENDANCE_INSTANCES).updateOne({ _id: instanceId }, { $set: { status: "COMPLETED" } });
}

/**
 * 출석 일차를 원자적으로 추가한다(`$addToSet` — 중복 값은 자동 무시되어 멱등).
 * @param db 메인 앱 DB 핸들
 * @param instanceId 대상 인스턴스
 * @param day 출석 처리할 일차(1-based)
 * @param session 캐치업 구매 트랜잭션 안에서 호출할 때만 전달
 * @author trisakion
 */
export async function addAttendedDay(db: Db, instanceId: string, day: number, session?: ClientSession): Promise<void> {
  await db.collection<AttendanceInstance>(COLLECTIONS.ATTENDANCE_INSTANCES).updateOne({ _id: instanceId }, { $addToSet: { attendedDays: day } }, { session });
}

/**
 * @param db 메인 앱 DB 핸들
 * @param instanceId 대상 인스턴스
 * @param session 캐치업 구매 트랜잭션 안에서 호출할 때만 전달
 * @author trisakion
 */
export async function incrementCatchupCount(db: Db, instanceId: string, session?: ClientSession): Promise<void> {
  await db.collection<AttendanceInstance>(COLLECTIONS.ATTENDANCE_INSTANCES).updateOne({ _id: instanceId }, { $inc: { catchupPurchaseCount: 1 } }, { session });
}
