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
 * gm_platform 연동(`/gm/*`) E2E 테스트 — 현재는 출석부 저장 API 3종(`save-attendance-def`/
 * `save-attendance-rewards`/`save-attendance-catchup-prices`) 검증만 다룬다. 다른 GM 조회
 * 엔드포인트는 파라미터가 거의 없어(마스터데이터 덤프/로그 조회) 검증 실패 경로 자체가 얇아 별도
 * 테스트를 두지 않았다(`17_GM_API.md` 참고). `GM_PLATFORM_API_KEY`가 `.env`에 설정돼 있으면
 * `X-API-Key` 헤더로 실어 보낸다(설정 안 되어 있으면 `gmApiKeyAuth.ts`가 검증 자체를 건너뜀).
 * @author trisakion
 */

let baseUrl: string;
let httpServer: import("node:http").Server;
const createdDefIds: string[] = [];

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
