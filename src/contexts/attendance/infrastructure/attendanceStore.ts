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
  // GENERAL은 같은 defId를 영구히 재사용하며 로테이션마다 새 인스턴스를 발급할 수 있어(완료된
  // 과거 인스턴스는 컬렉션에 그대로 남음), 유니크 제약을 전체 문서가 아니라 "현재 ACTIVE인
  // 문서"에만 걸어야 한다 — partial index. 이래야 "동시 로그인 레이스로 같은 순간에 발급이
  // 두 번 시도되는 것"만 막고, 정상적인 순차 로테이션(1회차 COMPLETED 후 2회차 발급)은 막지
  // 않는다.
  await db.collection(COLLECTIONS.ATTENDANCE_INSTANCES).createIndex(
    { playerId: 1, defId: 1 },
    { unique: true, partialFilterExpression: { status: "ACTIVE" } },
  );
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

/**
 * 인스턴스를 발급한다. `(playerId, defId)` partial 유니크 인덱스(ACTIVE 상태에만 적용)로
 * 중복 발급을 막는다 — 동시 로그인 레이스로 같은 순간에 발급이 두 번 시도돼도 두 번째는
 * 중복 키(11000)로 조용히 무시된다(`insertMail()`/`PlayerRepository.create()`와 동일
 * 패턴). GENERAL 로테이션처럼 이미 완료된 인스턴스가 있는 상태에서 새로 발급하는 정상
 * 흐름은 partial 조건(ACTIVE만) 덕분에 막히지 않는다.
 * @param db 메인 앱 DB 핸들
 * @param instance 발급할 인스턴스(내부 PK 제외)
 * @returns 실제로 새로 발급된 인스턴스(호출부가 곧바로 오늘자 보상 지급에 이어 쓸 수 있도록
 *   `_id`까지 채워 반환), 이미 존재해 무시됐으면 null
 * @author trisakion
 */
export async function insertInstance(db: Db, instance: Omit<AttendanceInstance, "_id">): Promise<AttendanceInstance | null> {
  const doc: AttendanceInstance = { ...instance, _id: randomUUID() };
  try {
    await db.collection<AttendanceInstance>(COLLECTIONS.ATTENDANCE_INSTANCES).insertOne(doc);
    return doc;
  } catch (err) {
    if ((err as MongoServerError).code !== 11000) throw err;
    return null;
  }
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
 * 상태와 무관하게 해당 defId의 가장 최근 인스턴스를 찾는다(캐치업 구매 시 "존재하지 않음"과
 * "존재하지만 이미 종료됨"을 구분해서 에러 응답하기 위한 조회 — ACTIVE만 보는 `findActiveInstances`류와
 * 달리 여기선 COMPLETED도 봐야 한다). GENERAL은 같은 defId로 여러 번 로테이션되어 완료된 과거
 * 인스턴스가 여러 건 있을 수 있어 `issuedAt` 내림차순으로 가장 최근 것 하나만 반환한다.
 * @param db 메인 앱 DB 핸들
 * @param playerId 조회할 플레이어
 * @param defId 대상 출석부
 * @param session 캐치업 구매 트랜잭션 안에서 호출할 때만 전달(mailbox `claimMail()`과 동일
 *   패턴) — 트랜잭션 밖 일반 조회는 생략
 * @returns defId의 가장 최근 인스턴스(상태 무관), 발급된 적 없으면 null
 * @author trisakion
 */
export async function findInstanceAnyStatus(db: Db, playerId: string, defId: string, session?: ClientSession): Promise<AttendanceInstance | null> {
  return db
    .collection<AttendanceInstance>(COLLECTIONS.ATTENDANCE_INSTANCES)
    .findOne({ playerId, defId }, { session, sort: { issuedAt: -1 } });
}

/**
 * 해당 defId로 발급된 인스턴스가(상태 무관) 한 번이라도 있는지 확인한다 — EVENT는 재오픈이
 * 없으므로(23_GAME_DESIGN_ATTENDANCE.md "개요" 절), 로그인 처리 흐름이 신규 발급 대상을
 * 고를 때 "완료된 적 있는 EVENT를 다시 발급"하는 사고를 막는 가드로 쓴다. GENERAL은 이 함수를
 * 쓰지 않는다(로테이션이 정상 동작이라 `findActiveGeneralInstance`의 ACTIVE 여부만 본다).
 * @param db 메인 앱 DB 핸들
 * @param playerId 조회할 플레이어
 * @param defId 대상 출석부
 * @returns 상태 무관 발급 이력이 한 번이라도 있으면 true
 * @author trisakion
 */
export async function hasAnyInstanceForDef(db: Db, playerId: string, defId: string): Promise<boolean> {
  const doc = await db
    .collection<AttendanceInstance>(COLLECTIONS.ATTENDANCE_INSTANCES)
    .findOne({ playerId, defId }, { projection: { _id: 1 } });
  return doc !== null;
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
