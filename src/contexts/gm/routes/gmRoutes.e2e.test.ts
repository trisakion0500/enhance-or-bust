import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "../../../config/env.js";
import { connectMongo, mongoClient } from "../../../infra/mongo.js";
import { connectMongoLog, mongoLogClient } from "../../../infra/mongoLog.js";
import { connectRedis, redisClient } from "../../../infra/redis.js";
import { COLLECTIONS } from "../../../shared-kernel/collectionNames.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { MongoMailboxRepository } from "../../mailbox/infrastructure/mongoMailboxRepository.js";
import { MongoPlayerRepository } from "../../player/infrastructure/mongoPlayerRepository.js";
import { createServer } from "../../../server.js";

/**
 * gm_platform 연동(`/gm/*`) E2E 테스트 — 출석부 저장 API 3종(`save-attendance-def`/
 * `save-attendance-rewards`/`save-attendance-catchup-prices`), 카드 원형 저장 API
 * (`save-card-templates`), 등급 설정 저장 API(`save-grade-configs`), 강화 규칙 저장 API
 * (`save-enhancement-rules`), 스테이지 카드 드랍 저장 API(`save-stage-card-drops`) 검증을
 * 다룬다. 다른 GM 조회 엔드포인트는 파라미터가 거의 없어
 * (마스터데이터 덤프/로그 조회) 검증 실패 경로 자체가 얇아 별도 테스트를 두지 않았다
 * (`17_GM_API.md` 참고). `GM_PLATFORM_API_KEY`가 `.env`에 설정돼 있으면 `X-API-Key`
 * 헤더로 실어 보낸다(설정 안 되어 있으면 `gmApiKeyAuth.ts`가 검증 자체를 건너뜀).
 * @author trisakion
 */

let baseUrl: string;
let httpServer: import("node:http").Server;
const createdDefIds: string[] = [];
const createdTemplateIds: string[] = [];

before(async () => {
  const db = await connectMongo();
  await connectMongoLog();
  await connectRedis();
  await masterDataCache.loadAll(db);

  const playerRepository = new MongoPlayerRepository(db);
  httpServer = createServer(playerRepository, new MongoMailboxRepository(db), db).listen(0);
  await new Promise<void>(resolve => httpServer.once("listening", resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  const db = mongoClient.db(process.env.MONGO_APP_DATABASE);
  await db.collection(COLLECTIONS.MASTER_ATTENDANCE_DEFS).deleteMany({ defId: { $in: createdDefIds } });
  await db.collection(COLLECTIONS.MASTER_ATTENDANCE_REWARDS).deleteMany({ defId: { $in: createdDefIds } });
  await db.collection(COLLECTIONS.MASTER_ATTENDANCE_CATCHUP_PRICES).deleteMany({ defId: { $in: createdDefIds } });
  await db.collection(COLLECTIONS.MASTER_CARD_TEMPLATES).deleteMany({ templateId: { $in: createdTemplateIds } });
  await db.collection(COLLECTIONS.MASTER_STAGE_CARD_DROPS).deleteMany({ templateId: { $in: createdTemplateIds } });
  await db.collection(COLLECTIONS.MASTER_ENHANCEMENT_RULES).deleteMany({ minTargetEnhancementLevel: { $gte: 16, $lte: 20 } });
  await new Promise(resolve => httpServer.close(resolve));
  await mongoClient.close();
  await mongoLogClient.close();
  await redisClient.quit();
});

/** 테스트 defId를 발급하고 정리 대상 목록에 등록한다. */
function nextDefId(): string {
  const defId = `gm-test-${randomUUID()}`;
  createdDefIds.push(defId);
  return defId;
}

/** 테스트 templateId를 발급하고 정리 대상 목록에 등록한다. */
function nextTemplateId(): string {
  const templateId = `gm-test-${randomUUID()}`;
  createdTemplateIds.push(templateId);
  return templateId;
}

/**
 * 저장 API 테스트가 "이 컬렉션의 최종 상태"로 보낼 기준선을 구한다 — `save-card-templates`는
 * 전체 교체 방식이라, GM 조회 엔드포인트(캐시 경유, Change Stream 갱신이 비동기라 방금 쓴
 * 값이 아직 안 보일 수 있음)가 아니라 DB를 직접 읽어 항상 최신 상태를 기준으로 삼는다.
 */
async function currentCardTemplateRows() {
  const db = mongoClient.db(process.env.MONGO_APP_DATABASE);
  return db.collection(COLLECTIONS.MASTER_CARD_TEMPLATES).find({}, { projection: { _id: 0 } }).toArray();
}

/** {@link currentCardTemplateRows}와 동일한 이유로 강화 규칙도 DB를 직접 읽어 기준선을 구한다. */
async function currentEnhancementRuleRows() {
  const db = mongoClient.db(process.env.MONGO_APP_DATABASE);
  return db.collection(COLLECTIONS.MASTER_ENHANCEMENT_RULES).find({}, { projection: { _id: 0 } }).toArray();
}

/** {@link currentCardTemplateRows}와 동일한 이유로 등급 설정도 DB를 직접 읽어 기준선을 구한다. */
async function currentGradeConfigRows() {
  const db = mongoClient.db(process.env.MONGO_APP_DATABASE);
  return db.collection(COLLECTIONS.MASTER_GRADE_CONFIGS).find({}, { projection: { _id: 0 } }).toArray();
}

/** {@link currentCardTemplateRows}와 동일한 이유로 스테이지 카드 드랍도 DB를 직접 읽어 기준선을 구한다. */
async function currentStageCardDropRows() {
  const db = mongoClient.db(process.env.MONGO_APP_DATABASE);
  return db.collection(COLLECTIONS.MASTER_STAGE_CARD_DROPS).find({}, { projection: { _id: 0 } }).toArray();
}

/** 기본값이 채워진 출석부 정의 저장 바디(개별 필드는 override로 덮어씀). 기본은 아직 시작 전인 EVENT. */
function buildDefBody(defId: string, override: Record<string, unknown> = {}) {
  return {
    defId,
    name: "GM 테스트 출석부",
    type: "EVENT",
    targetAudience: "ALL_USERS",
    maxRotationCount: 0,
    enrollableStart: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    enrollableEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    durationDays: 3,
    catchupMaxCount: 2,
    ...override,
  };
}

async function post(path: string, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.gmPlatformApiKey) headers["X-API-Key"] = config.gmPlatformApiKey;

  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

const saveDef = (body: unknown) => post("/gm/save-attendance-def", body);
const saveRewards = (body: unknown) => post("/gm/save-attendance-rewards", body);
const saveCatchupPrices = (body: unknown) => post("/gm/save-attendance-catchup-prices", body);
const saveCardTemplates = (body: unknown) => post("/gm/save-card-templates", body);
const saveGradeConfigs = (body: unknown) => post("/gm/save-grade-configs", body);
const saveEnhancementRules = (body: unknown) => post("/gm/save-enhancement-rules", body);
const saveStageCardDrops = (body: unknown) => post("/gm/save-stage-card-drops", body);

test("신규 출석부 정의 저장 성공", async () => {
  const defId = nextDefId();
  const { status, json } = await saveDef(buildDefBody(defId));

  assert.equal(status, 200);
  assert.equal(json.result, 0);
  assert.equal(json.data[0].defId, defId);
  assert.ok(json.data[0]._id);
});

test("RETURNING_USER인데 returningInactiveDays가 없으면 VALIDATION_FAILED(10000)", async () => {
  const { status, json } = await saveDef(buildDefBody(nextDefId(), { targetAudience: "RETURNING_USER" }));

  assert.equal(status, 400);
  assert.equal(json.result, 10000);
});

test("같은 defId로 신규 등록을 다시 시도하면 DEF_DUPLICATE(12007)", async () => {
  const defId = nextDefId();
  assert.equal((await saveDef(buildDefBody(defId))).status, 200);

  const second = await saveDef(buildDefBody(defId));
  assert.equal(second.status, 409);
  assert.equal(second.json.result, 12007);
});

test("GENERAL def 기간이 다른 GENERAL def와 겹치면 DEF_OVERLAP(12006)", async () => {
  // 시드 데이터(seedData.ts)의 GENERAL_LAUNCH_DEF_ID가 이미 1970~9998로 사실상 전 기간을
  // 점유하고 있어, 이 환경에서 새 GENERAL def는 어떤 기간을 넣어도 항상 겹친다.
  const { status, json } = await saveDef(buildDefBody(nextDefId(), { type: "GENERAL" }));

  assert.equal(status, 409);
  assert.equal(json.result, 12006);
});

test("이미 시작된 def는 수정 시도 시 DEF_LOCKED(12008)", async () => {
  const defId = nextDefId();
  const started = await saveDef(buildDefBody(defId, { enrollableStart: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
  assert.equal(started.status, 200);

  const update = await saveDef(buildDefBody(defId, { id: started.json.data[0]._id, name: "수정 시도" }));
  assert.equal(update.status, 409);
  assert.equal(update.json.result, 12008);
});

test("보상 저장 — 하루 단위로 저장하고 같은 일차를 다시 저장하면 그 일차만 통째로 교체된다", async () => {
  const defId = nextDefId();
  assert.equal((await saveDef(buildDefBody(defId))).status, 200);

  const day1 = await saveRewards({ defId, day: 1, gold: 100, diamond: 2, cardTemplateId: "N_01", cardCount: 1 });
  assert.equal(day1.status, 200);
  assert.deepEqual(day1.json.data.map((r: { itemType: string }) => r.itemType).sort(), ["card", "diamond", "gold"]);

  const day3 = await saveRewards({ defId, day: 3, gold: 300 });
  assert.equal(day3.json.data.length, 4);

  const replaced = await saveRewards({ defId, day: 1, enhancementStone: 5 });
  assert.equal(replaced.status, 200);
  const day1Rows = replaced.json.data.filter((r: { day: number }) => r.day === 1);
  assert.equal(day1Rows.length, 1);
  assert.equal(day1Rows[0].itemType, "enhancementStone");
  assert.equal(replaced.json.data.filter((r: { day: number }) => r.day === 3).length, 1);
});

test("보상 저장 — 수량을 전부 비우면 그 일차 보상이 삭제된다", async () => {
  const defId = nextDefId();
  assert.equal((await saveDef(buildDefBody(defId))).status, 200);
  assert.equal((await saveRewards({ defId, day: 2, gold: 50 })).json.data.length, 1);

  const cleared = await saveRewards({ defId, day: 2 });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.data.length, 0);
});

test("보상 day가 1~durationDays 범위 밖이면 DEF_MISMATCH(12009)", async () => {
  const defId = nextDefId();
  assert.equal((await saveDef(buildDefBody(defId))).status, 200);

  for (const day of [0, 4]) {
    const { status, json } = await saveRewards({ defId, day, gold: 100 });
    assert.equal(status, 400);
    assert.equal(json.result, 12009);
  }
});

test("존재하지 않는 출석부의 보상 저장은 NOT_FOUND(12001), 시작된 출석부는 DEF_LOCKED(12008)", async () => {
  const missing = await saveRewards({ defId: `gm-test-missing-${randomUUID()}`, day: 1, gold: 100 });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.result, 12001);

  const defId = nextDefId();
  assert.equal((await saveDef(buildDefBody(defId, { enrollableStart: new Date(Date.now() - 60 * 60 * 1000).toISOString() }))).status, 200);
  const locked = await saveRewards({ defId, day: 1, gold: 100 });
  assert.equal(locked.status, 409);
  assert.equal(locked.json.result, 12008);
});

test("보상 입력 값이 잘못되면 VALIDATION_FAILED(10000) — 음수/소수 수량, 카드 원형만/장수만, 없는 원형", async () => {
  const defId = nextDefId();
  assert.equal((await saveDef(buildDefBody(defId))).status, 200);

  const invalidBodies = [
    { defId, day: 1, gold: -1 },
    { defId, day: 1, gold: 1.5 },
    { defId, day: 1, cardTemplateId: "N_01" },
    { defId, day: 1, cardCount: 1 },
    { defId, day: 1, cardTemplateId: "NO_SUCH_TEMPLATE", cardCount: 1 },
    { defId, gold: 100 },
  ];
  for (const body of invalidBodies) {
    const { status, json } = await saveRewards(body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(json.result, 10000, JSON.stringify(body));
  }
});

test("캐치업 가격 저장 — 회차 단위로 저장하고 같은 회차를 다시 저장하면 가격만 바뀐다", async () => {
  const defId = nextDefId();
  assert.equal((await saveDef(buildDefBody(defId))).status, 200);

  const first = await saveCatchupPrices({ defId, purchaseIndex: 2, price: 400 });
  assert.equal(first.status, 200);
  assert.equal(first.json.data.length, 1);

  await saveCatchupPrices({ defId, purchaseIndex: 1, price: 200 });
  const updated = await saveCatchupPrices({ defId, purchaseIndex: 2, price: 999 });
  assert.deepEqual(
    updated.json.data.map((r: { purchaseIndex: number; price: number }) => [r.purchaseIndex, r.price]),
    [[1, 200], [2, 999]],
  );
});

test("캐치업 회차가 1~catchupMaxCount 범위 밖이면 DEF_MISMATCH(12009), 가격이 음수/소수면 VALIDATION_FAILED(10000)", async () => {
  const defId = nextDefId();
  assert.equal((await saveDef(buildDefBody(defId))).status, 200);

  for (const purchaseIndex of [0, 3]) {
    const { status, json } = await saveCatchupPrices({ defId, purchaseIndex, price: 100 });
    assert.equal(status, 400);
    assert.equal(json.result, 12009);
  }
  for (const price of [-1, 1.5]) {
    const { status, json } = await saveCatchupPrices({ defId, purchaseIndex: 1, price });
    assert.equal(status, 400);
    assert.equal(json.result, 10000);
  }
});

test("아직 시작 전인 def의 defId를 바꾸면 기존 보상/캐치업 행의 defId도 따라 바뀐다", async () => {
  const oldDefId = nextDefId();
  const created = await saveDef(buildDefBody(oldDefId));
  assert.equal(created.status, 200);
  assert.equal((await saveRewards({ defId: oldDefId, day: 1, gold: 100 })).status, 200);
  assert.equal((await saveRewards({ defId: oldDefId, day: 3, gold: 300 })).status, 200);
  assert.equal((await saveCatchupPrices({ defId: oldDefId, purchaseIndex: 1, price: 200 })).status, 200);
  assert.equal((await saveCatchupPrices({ defId: oldDefId, purchaseIndex: 2, price: 400 })).status, 200);

  const newDefId = nextDefId();
  const updated = await saveDef(buildDefBody(newDefId, { id: created.json.data[0]._id, name: "이름 변경됨" }));
  assert.equal(updated.status, 200);
  assert.equal(updated.json.data[0].defId, newDefId);

  const db = mongoClient.db(process.env.MONGO_APP_DATABASE);
  assert.equal(await db.collection(COLLECTIONS.MASTER_ATTENDANCE_REWARDS).countDocuments({ defId: oldDefId }), 0);
  assert.equal(await db.collection(COLLECTIONS.MASTER_ATTENDANCE_REWARDS).countDocuments({ defId: newDefId }), 2);
  assert.equal(await db.collection(COLLECTIONS.MASTER_ATTENDANCE_CATCHUP_PRICES).countDocuments({ defId: oldDefId }), 0);
  assert.equal(await db.collection(COLLECTIONS.MASTER_ATTENDANCE_CATCHUP_PRICES).countDocuments({ defId: newDefId }), 2);
});

test("카드 원형 저장 — 신규 행 추가", async () => {
  const templateId = nextTemplateId();
  const existing = await currentCardTemplateRows();
  const payload = { data: [...existing, { templateId, grade: "N", element: "fire", baseAttack: 10, baseHp: 50 }] };

  const { status, json } = await saveCardTemplates(payload);
  assert.equal(status, 200);
  assert.equal(json.result, 0);
  const saved = json.data.find((row: { templateId: string }) => row.templateId === templateId);
  assert.ok(saved);
  assert.equal(saved.baseAttack, 10);
});

test("카드 원형 저장 — 기존 행 수정", async () => {
  const templateId = nextTemplateId();
  const base = await currentCardTemplateRows();
  const row = { templateId, grade: "R", element: "water", baseAttack: 20, baseHp: 80 };
  assert.equal((await saveCardTemplates({ data: [...base, row] })).status, 200);

  const existing = await currentCardTemplateRows();
  const replaced = existing.map(r => (r.templateId === templateId ? { ...row, baseAttack: 99 } : r));
  const { status, json } = await saveCardTemplates({ data: replaced });

  assert.equal(status, 200);
  assert.equal(json.data.find((r: { templateId: string }) => r.templateId === templateId).baseAttack, 99);
});

test("카드 원형 저장 — 참조 없는 행은 삭제된다", async () => {
  const templateId = nextTemplateId();
  const base = await currentCardTemplateRows();
  assert.equal((await saveCardTemplates({ data: [...base, { templateId, grade: "N", element: "grass", baseAttack: 10, baseHp: 50 }] })).status, 200);

  const withoutRow = (await currentCardTemplateRows()).filter(r => r.templateId !== templateId);
  const { status, json } = await saveCardTemplates({ data: withoutRow });

  assert.equal(status, 200);
  assert.ok(!json.data.some((r: { templateId: string }) => r.templateId === templateId));
});

test("카드 원형 저장 — 참조 중인 행을 빼면 REFERENCED_CANNOT_DELETE(10003)로 거부되고 아무것도 바뀌지 않는다", async () => {
  const templateId = nextTemplateId();
  const base = await currentCardTemplateRows();
  assert.equal((await saveCardTemplates({ data: [...base, { templateId, grade: "SR", element: "fire", baseAttack: 60, baseHp: 200 }] })).status, 200);

  const db = mongoClient.db(process.env.MONGO_APP_DATABASE);
  await db.collection(COLLECTIONS.MASTER_STAGE_CARD_DROPS).insertOne({ stageId: 999999, templateId, weight: 1 });

  const beforeCount = await db.collection(COLLECTIONS.MASTER_CARD_TEMPLATES).countDocuments();
  const withoutRow = (await currentCardTemplateRows()).filter(r => r.templateId !== templateId);
  const { status, json } = await saveCardTemplates({ data: withoutRow });

  assert.equal(status, 409);
  assert.equal(json.result, 10003);
  assert.equal(await db.collection(COLLECTIONS.MASTER_CARD_TEMPLATES).countDocuments(), beforeCount);

  await db.collection(COLLECTIONS.MASTER_STAGE_CARD_DROPS).deleteOne({ stageId: 999999, templateId });
});

test("카드 원형 저장 — payload 내 templateId 중복이면 VALIDATION_FAILED(10000)", async () => {
  const templateId = nextTemplateId();
  const row = { templateId, grade: "N", element: "fire", baseAttack: 10, baseHp: 50 };
  const { status, json } = await saveCardTemplates({ data: [row, row] });

  assert.equal(status, 400);
  assert.equal(json.result, 10000);
});

test("카드 원형 저장 — 행 형식이 잘못되면 VALIDATION_FAILED(10000)", async () => {
  const invalidRows = [
    { templateId: "", grade: "N", element: "fire", baseAttack: 10, baseHp: 50 },
    { templateId: nextTemplateId(), grade: "X", element: "fire", baseAttack: 10, baseHp: 50 },
    { templateId: nextTemplateId(), grade: "N", element: "lava", baseAttack: 10, baseHp: 50 },
    { templateId: nextTemplateId(), grade: "N", element: "fire", baseAttack: 0, baseHp: 50 },
    { templateId: nextTemplateId(), grade: "N", element: "fire", baseAttack: 10, baseHp: 0 },
    { templateId: nextTemplateId(), grade: "N", element: "fire", baseAttack: 1.5, baseHp: 50 },
  ];
  for (const row of invalidRows) {
    const { status, json } = await saveCardTemplates({ data: [row] });
    assert.equal(status, 400, JSON.stringify(row));
    assert.equal(json.result, 10000, JSON.stringify(row));
  }
});

// 등급 설정은 grade가 Grade 타입 자체로 고정된 4종 리터럴(N/R/SR/SSR)이라 카드 원형/강화
// 규칙과 달리 행을 추가/삭제할 수 없다 — payload가 이 4종을 정확히 하나씩 포함하는지만
// 검증하는 순수 upsert다. 실제 값(다른 컨텍스트가 강화/합성/레벨업마다 참조하는 등급별
// 성장 상한)을 바꾸는 테스트는 두지 않는다 — upsert의 write 경로 자체는 카드 원형/강화
// 규칙 저장 테스트가 이미 같은 $set 패턴으로 검증했으므로, 여기서는 이 API에서만 새로
// 생긴 검증 로직(4종 집합 일치)만 다룬다.
test("등급 설정 저장 — 현재 값 그대로 재저장하면 4종이 그대로 반환된다", async () => {
  const base = await currentGradeConfigRows();
  const { status, json } = await saveGradeConfigs({ data: base });

  assert.equal(status, 200);
  assert.equal(json.result, 0);
  assert.equal(json.data.length, 4);
  assert.deepEqual(json.data.map((r: { grade: string }) => r.grade).sort(), ["N", "R", "SR", "SSR"]);
});

test("등급 설정 저장 — 4종 중 하나라도 빠지면 VALIDATION_FAILED(10000)", async () => {
  const base = await currentGradeConfigRows();
  const missingOne = base.filter(r => r.grade !== "SSR");

  const { status, json } = await saveGradeConfigs({ data: missingOne });
  assert.equal(status, 400);
  assert.equal(json.result, 10000);
});

test("등급 설정 저장 — 알 수 없는 등급이 섞이면 VALIDATION_FAILED(10000)", async () => {
  const base = await currentGradeConfigRows();
  const withUnknown = [...base, { grade: "UR", maxLevel: 100, maxEnhancementLevel: 20 }];

  const { status, json } = await saveGradeConfigs({ data: withUnknown });
  assert.equal(status, 400);
  assert.equal(json.result, 10000);
});

test("등급 설정 저장 — grade가 중복되면 VALIDATION_FAILED(10000)", async () => {
  const base = await currentGradeConfigRows();
  const duplicated = [...base, base[0]];

  const { status, json } = await saveGradeConfigs({ data: duplicated });
  assert.equal(status, 400);
  assert.equal(json.result, 10000);
});

test("등급 설정 저장 — 행 형식이 잘못되면 VALIDATION_FAILED(10000)", async () => {
  const base = await currentGradeConfigRows();
  const invalidPayloads = [
    base.map(r => (r.grade === "N" ? { ...r, maxLevel: 0 } : r)),
    base.map(r => (r.grade === "N" ? { ...r, maxLevel: 1.5 } : r)),
    base.map(r => (r.grade === "N" ? { ...r, maxEnhancementLevel: -1 } : r)),
    base.map(r => (r.grade === "N" ? { ...r, maxEnhancementLevel: 1.5 } : r)),
  ];
  for (const rows of invalidPayloads) {
    const { status, json } = await saveGradeConfigs({ data: rows });
    assert.equal(status, 400, JSON.stringify(rows));
    assert.equal(json.result, 10000, JSON.stringify(rows));
  }
});

// 강화 규칙은 카드 원형과 달리 다른 컬렉션이 참조하지 않아 삭제 가드가 없다 — 그래서 테스트도
// 실제 시드 구간(1~15)을 건드리지 않고 전용 테스트 구간(16~20)만 추가/수정/삭제하며, 검증
// 실패 케이스는 전체가 거부되므로 DB가 바뀌지 않는다. 혹시 어떤 테스트가 중간에 실패해도
// 이후 테스트/다른 파일에 영향이 없도록 마지막에 원래 상태로 복원한다.
const TEST_RULE_MIN = 16;
const TEST_RULE_MAX = 20;

test("강화 규칙 저장 — 신규 구간 추가", async () => {
  const base = await currentEnhancementRuleRows();
  const row = { minTargetEnhancementLevel: TEST_RULE_MIN, maxTargetEnhancementLevel: TEST_RULE_MAX, successRate: 0.5, destroyOnFailChance: 0, goldMultiplier: 1000, stoneCost: 5 };

  try {
    const { status, json } = await saveEnhancementRules({ data: [...base, row] });
    assert.equal(status, 200);
    const saved = json.data.find((r: { minTargetEnhancementLevel: number }) => r.minTargetEnhancementLevel === TEST_RULE_MIN);
    assert.ok(saved);
    assert.equal(saved.successRate, 0.5);
  } finally {
    await saveEnhancementRules({ data: base });
  }
});

test("강화 규칙 저장 — 기존 구간 수정", async () => {
  const base = await currentEnhancementRuleRows();
  const row = { minTargetEnhancementLevel: TEST_RULE_MIN, maxTargetEnhancementLevel: TEST_RULE_MAX, successRate: 0.5, destroyOnFailChance: 0, goldMultiplier: 1000, stoneCost: 5 };

  try {
    assert.equal((await saveEnhancementRules({ data: [...base, row] })).status, 200);
    const { status, json } = await saveEnhancementRules({ data: [...base, { ...row, successRate: 0.9 }] });
    assert.equal(status, 200);
    assert.equal(json.data.find((r: { minTargetEnhancementLevel: number }) => r.minTargetEnhancementLevel === TEST_RULE_MIN).successRate, 0.9);
  } finally {
    await saveEnhancementRules({ data: base });
  }
});

test("강화 규칙 저장 — payload에서 빠진 구간은 삭제된다", async () => {
  const base = await currentEnhancementRuleRows();
  const row = { minTargetEnhancementLevel: TEST_RULE_MIN, maxTargetEnhancementLevel: TEST_RULE_MAX, successRate: 0.5, destroyOnFailChance: 0, goldMultiplier: 1000, stoneCost: 5 };
  assert.equal((await saveEnhancementRules({ data: [...base, row] })).status, 200);

  const { status, json } = await saveEnhancementRules({ data: base });
  assert.equal(status, 200);
  assert.ok(!json.data.some((r: { minTargetEnhancementLevel: number }) => r.minTargetEnhancementLevel === TEST_RULE_MIN));
});

test("강화 규칙 저장 — minTargetEnhancementLevel 중복이면 VALIDATION_FAILED(10000)", async () => {
  const base = await currentEnhancementRuleRows();
  const row = { minTargetEnhancementLevel: TEST_RULE_MIN, maxTargetEnhancementLevel: TEST_RULE_MAX, successRate: 0.5, destroyOnFailChance: 0, goldMultiplier: 1000, stoneCost: 5 };

  const { status, json } = await saveEnhancementRules({ data: [...base, row, row] });
  assert.equal(status, 400);
  assert.equal(json.result, 10000);
});

test("강화 규칙 저장 — 구간이 겹치면 VALIDATION_FAILED(10000)", async () => {
  const base = await currentEnhancementRuleRows();
  const rowA = { minTargetEnhancementLevel: TEST_RULE_MIN, maxTargetEnhancementLevel: TEST_RULE_MAX, successRate: 0.5, destroyOnFailChance: 0, goldMultiplier: 1000, stoneCost: 5 };
  const rowB = { minTargetEnhancementLevel: 19, maxTargetEnhancementLevel: 25, successRate: 0.5, destroyOnFailChance: 0, goldMultiplier: 1000, stoneCost: 5 };

  const { status, json } = await saveEnhancementRules({ data: [...base, rowA, rowB] });
  assert.equal(status, 400);
  assert.equal(json.result, 10000);
});

test("강화 규칙 저장 — 행 형식이 잘못되면 VALIDATION_FAILED(10000)", async () => {
  const invalidRows = [
    { minTargetEnhancementLevel: 1.5, maxTargetEnhancementLevel: TEST_RULE_MAX, successRate: 0.5, destroyOnFailChance: 0, goldMultiplier: 1000, stoneCost: 5 },
    { minTargetEnhancementLevel: TEST_RULE_MAX, maxTargetEnhancementLevel: TEST_RULE_MIN, successRate: 0.5, destroyOnFailChance: 0, goldMultiplier: 1000, stoneCost: 5 },
    { minTargetEnhancementLevel: TEST_RULE_MIN, maxTargetEnhancementLevel: TEST_RULE_MAX, successRate: 1.1, destroyOnFailChance: 0, goldMultiplier: 1000, stoneCost: 5 },
    { minTargetEnhancementLevel: TEST_RULE_MIN, maxTargetEnhancementLevel: TEST_RULE_MAX, successRate: 0.5, destroyOnFailChance: -0.1, goldMultiplier: 1000, stoneCost: 5 },
    { minTargetEnhancementLevel: TEST_RULE_MIN, maxTargetEnhancementLevel: TEST_RULE_MAX, successRate: 0.5, destroyOnFailChance: 0, goldMultiplier: -1, stoneCost: 5 },
    { minTargetEnhancementLevel: TEST_RULE_MIN, maxTargetEnhancementLevel: TEST_RULE_MAX, successRate: 0.5, destroyOnFailChance: 0, goldMultiplier: 1000, stoneCost: -1 },
  ];
  for (const row of invalidRows) {
    const { status, json } = await saveEnhancementRules({ data: [row] });
    assert.equal(status, 400, JSON.stringify(row));
    assert.equal(json.result, 10000, JSON.stringify(row));
  }
});

// 스테이지 카드 드랍은 카드 원형과 같은 전체 교체 방식이지만(다른 컬렉션이 이 행 자체를
// ID로 참조하지 않아) 삭제 가드는 없다. 자연키는 (stageId, templateId) 복합키인데, 시드
// 데이터가 이미 모든 스테이지×카드 원형 조합을 채우고 있어(seedData.ts의
// buildCardDropRules()) 강화 규칙(전용 구간 16~20)처럼 건드려도 안전한 여분 조합이 없다.
// 그래서 실제 조합 하나(stageId=1, N_01)를 바꾸는 테스트는 항상 finally에서 원래 값으로
// 복원한다. 새 카드 원형을 만들어 곧바로 참조하는 방식은 쓰지 않는다 — FK 검증이 보는
// masterDataCache는 Change Stream 갱신이 비동기라 방금 만든 원형이 아직 캐시에 안 보일
// 수 있기 때문(다른 GM 조회 엔드포인트의 캐시 지연과 동일 이유).
const TEST_STAGE_ID = 1;
const TEST_TEMPLATE_ID = "N_01";

test("스테이지 카드 드랍 저장 — upsert로 기존 값이 바뀐다", async () => {
  const base = await currentStageCardDropRows();
  const original = base.find(r => r.stageId === TEST_STAGE_ID && r.templateId === TEST_TEMPLATE_ID);
  assert.ok(original, "시드 데이터에 stageId=1/N_01 조합이 있어야 한다");

  try {
    const changed = base.map(r => (r.stageId === TEST_STAGE_ID && r.templateId === TEST_TEMPLATE_ID ? { ...r, weight: 12345 } : r));
    const { status, json } = await saveStageCardDrops({ data: changed });

    assert.equal(status, 200);
    assert.equal(json.data.find((r: { stageId: number; templateId: string }) => r.stageId === TEST_STAGE_ID && r.templateId === TEST_TEMPLATE_ID).weight, 12345);
  } finally {
    await saveStageCardDrops({ data: base });
  }
});

test("스테이지 카드 드랍 저장 — payload에서 빠진 행은 삭제된다(참조 가드 없음)", async () => {
  const base = await currentStageCardDropRows();
  const withoutRow = base.filter(r => !(r.stageId === TEST_STAGE_ID && r.templateId === TEST_TEMPLATE_ID));

  try {
    const { status, json } = await saveStageCardDrops({ data: withoutRow });
    assert.equal(status, 200);
    assert.ok(!json.data.some((r: { stageId: number; templateId: string }) => r.stageId === TEST_STAGE_ID && r.templateId === TEST_TEMPLATE_ID));
  } finally {
    await saveStageCardDrops({ data: base });
  }
});

test("스테이지 카드 드랍 저장 — (stageId, templateId) 중복이면 VALIDATION_FAILED(10000)", async () => {
  const row = { stageId: TEST_STAGE_ID, templateId: TEST_TEMPLATE_ID, weight: 1 };
  const { status, json } = await saveStageCardDrops({ data: [row, row] });

  assert.equal(status, 400);
  assert.equal(json.result, 10000);
});

test("스테이지 카드 드랍 저장 — 존재하지 않는 stageId/templateId를 참조하면 VALIDATION_FAILED(10000)", async () => {
  const invalidRows = [
    { stageId: 999999, templateId: TEST_TEMPLATE_ID, weight: 1 },
    { stageId: TEST_STAGE_ID, templateId: "NO_SUCH_TEMPLATE", weight: 1 },
  ];
  for (const row of invalidRows) {
    const { status, json } = await saveStageCardDrops({ data: [row] });
    assert.equal(status, 400, JSON.stringify(row));
    assert.equal(json.result, 10000, JSON.stringify(row));
  }
});

test("스테이지 카드 드랍 저장 — 행 형식이 잘못되면 VALIDATION_FAILED(10000)", async () => {
  const invalidRows = [
    { stageId: 0, templateId: TEST_TEMPLATE_ID, weight: 1 },
    { stageId: 1.5, templateId: TEST_TEMPLATE_ID, weight: 1 },
    { stageId: TEST_STAGE_ID, templateId: "", weight: 1 },
    { stageId: TEST_STAGE_ID, templateId: TEST_TEMPLATE_ID, weight: 0 },
    { stageId: TEST_STAGE_ID, templateId: TEST_TEMPLATE_ID, weight: -1 },
  ];
  for (const row of invalidRows) {
    const { status, json } = await saveStageCardDrops({ data: [row] });
    assert.equal(status, 400, JSON.stringify(row));
    assert.equal(json.result, 10000, JSON.stringify(row));
  }
});
