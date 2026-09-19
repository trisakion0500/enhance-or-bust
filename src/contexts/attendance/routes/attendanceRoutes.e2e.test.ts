import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Card } from "../../player/domain/card.js";
import { Economy } from "../../player/domain/economy.js";
import { Inventory } from "../../player/domain/inventory.js";
import { Player } from "../../player/domain/player.js";
import { config } from "../../../config/env.js";
import { connectMongo, mongoClient } from "../../../infra/mongo.js";
import { connectMongoLog, mongoLogClient } from "../../../infra/mongoLog.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { COLLECTIONS } from "../../../shared-kernel/collectionNames.js";
import { addDaysToDateString, todayDateString } from "../../../shared-kernel/dateUtil.js";
import { MongoPlayerRepository } from "../../player/infrastructure/mongoPlayerRepository.js";
import { MongoMailboxRepository } from "../../mailbox/infrastructure/mongoMailboxRepository.js";
import { connectRedis, redisClient } from "../../../infra/redis.js";
import { createSession } from "../../auth/infrastructure/sessionStore.js";
import { createServer } from "../../../server.js";
import { EVENT_NEWBIE_DEF_ID, GENERAL_LAUNCH_DEF_ID } from "../seedData.js";

/**
 * 출석보상 API E2E 테스트. 다른 컨텍스트와 동일하게 Mongo/Redis에 실제로 붙어 `createServer()`가
 * 만드는 앱을 임시 포트로 띄운 뒤 `fetch`로 호출한다. 로그인(`GET /player/me`)이 곧 출석 처리
 * 진입점이라(23_GAME_DESIGN_ATTENDANCE.md "로그인 시 처리 흐름" 절) 이 테스트도 출석 API 자체와
 * `GET /player/me`를 함께 호출한다. 며칠 지난 상황(캐치업 가능 날짜, 로테이션 리셋)은 실제
 * 시간을 기다릴 수 없어 `player_attendance` 문서의 `startDate`/`endDate`를 테스트가 직접
 * 뒤로 돌려 재현한다.
 * @author trisakion
 */

let baseUrl: string;
let playerRepository: MongoPlayerRepository;
let httpServer: import("node:http").Server;

before(async () => {
  const db = await connectMongo();
  await connectMongoLog();
  await connectRedis();
  await masterDataCache.loadAll(db);

  playerRepository = new MongoPlayerRepository(db);
  httpServer = createServer(playerRepository, new MongoMailboxRepository(db), db).listen(0);
  await new Promise<void>(resolve => httpServer.once("listening", resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise(resolve => httpServer.close(resolve));
  await mongoClient.close();
  await mongoLogClient.close();
  await redisClient.quit();
});

interface AttendanceInstanceDoc {
  _id: string;
  playerId: string;
  defId: string;
  rotationCount: number;
  catchupPurchaseCount: number;
  startDate: string;
  endDate: string;
  attendedDays: number[];
  status: string;
}

function attendanceCollection() {
  return mongoClient.db(process.env.MONGO_APP_DATABASE).collection<AttendanceInstanceDoc>(COLLECTIONS.ATTENDANCE_INSTANCES);
}

/** 골드 `gold`를 가진 테스트 플레이어를 만들고, 로그인 세션 쿠키까지 발급해 반환한다. */
async function createTestPlayer(gold = 10000) {
  const playerId = randomUUID();
  const player = new Player(
    playerId,
    0,
    "test",
    `test-${playerId}`,
    "테스트유저",
    "test@example.com",
    undefined,
    new Inventory([new Card(randomUUID(), "N_01")]),
    new Economy(gold, 0, 0),
    0,
  );
  await playerRepository.create(player);
  const token = await createSession(playerId);
  return { playerId, cookie: `sessionToken=${token}` };
}

/** 테스트가 만든 플레이어/우편/출석 인스턴스 문서를 지운다. */
async function deleteTestPlayer(playerId: string) {
  const db = mongoClient.db(process.env.MONGO_APP_DATABASE);
  await db.collection<{ _id: string }>(COLLECTIONS.PLAYERS).deleteOne({ _id: playerId });
  await db.collection<{ playerId: string }>(COLLECTIONS.MAILBOX).deleteMany({ playerId });
  await attendanceCollection().deleteMany({ playerId });
}

async function getPlayerMe(cookie: string) {
  const res = await fetch(`${baseUrl}/player/me`, { headers: { Cookie: cookie } });
  return { res, body: await res.json() };
}

async function getAttendanceStatus(cookie: string) {
  const res = await fetch(`${baseUrl}/attendance`, { headers: { Cookie: cookie } });
  return { res, body: await res.json() };
}

async function postCatchup(defId: string, day: number, cookie: string) {
  const res = await fetch(`${baseUrl}/attendance/${defId}/catchup`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ day }),
  });
  return { res, body: await res.json() };
}

async function listMails(cookie: string) {
  const res = await fetch(`${baseUrl}/mailbox`, { headers: { Cookie: cookie } });
  return { res, body: await res.json() };
}

/**
 * 최초 로그인(1일차 자동 지급) 뒤, GENERAL 인스턴스의 `startDate`를 `gapDays`일 전으로
 * 돌리고 재로그인한다 — "며칠 지나 다시 접속" 상황을 재현해 그 사이 날짜(2일차~gapDays일차)를
 * 캐치업 가능 상태로 만든다. 재로그인은 오늘(= gapDays+1일차) 보상을 자동 지급한다.
 */
async function loginAndCreateCatchupGap(cookie: string, playerId: string, gapDays: number) {
  await getPlayerMe(cookie);
  await attendanceCollection().updateOne(
    { playerId, defId: GENERAL_LAUNCH_DEF_ID },
    { $set: { startDate: addDaysToDateString(todayDateString(), -gapDays) } },
  );
  await getPlayerMe(cookie);
}

test("로그인하면 GENERAL/EVENT 출석부가 자동 발급되고 1일차 보상이 우편으로 지급된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    const { body } = await getPlayerMe(cookie);
    assert.equal(body.attendanceNotice.generalStarted, true);
    assert.equal(body.attendanceNotice.granted.length, 3); // GENERAL + newbie + new_user_welcome
    assert.ok(body.attendanceNotice.granted.every((g: { day: number }) => g.day === 1));

    const { body: mailBody } = await listMails(cookie);
    assert.equal(mailBody.mails.length, 3);
    assert.ok(mailBody.mails.every((m: { attachments: { gold: number } }) => m.attachments.gold === 100));
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("GET /attendance는 오늘 상태와 캐치업 구매 정보를 함께 보여준다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await getPlayerMe(cookie);
    const { body } = await getAttendanceStatus(cookie);

    assert.equal(body.general.defId, GENERAL_LAUNCH_DEF_ID);
    assert.equal(body.general.name, "일일 출석");
    assert.equal(body.general.days.length, 30);
    assert.equal(body.general.days[0].state, "TODAY"); // 1일차, 오늘 출석 처리됨
    assert.deepEqual(body.general.catchup, { remainingPurchases: 3, nextPrice: 200, canAfford: true });
    assert.equal(body.events.length, 2); // newbie + new_user_welcome (returning_user는 신규 유저라 대상 아님)
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("캐치업 구매에 성공하면 골드가 차감되고 보상이 우편으로 지급된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await loginAndCreateCatchupGap(cookie, playerId, 3); // 2·3일차가 캐치업 가능 상태가 됨

    const { res, body } = await postCatchup(GENERAL_LAUNCH_DEF_ID, 2, cookie);
    assert.equal(res.status, 200);
    assert.equal(body.result, 0);
    assert.equal(body.price, 200);
    assert.deepEqual(body.attachments, { gold: 200 });

    const player = await playerRepository.findById(playerId);
    assert.equal(player!.economy.gold, 10000 - 200); // 캐치업 가격만 즉시 차감, 보상은 우편으로 별도 수령

    const { body: mailBody } = await listMails(cookie);
    const catchupMail = mailBody.mails.find((m: { title: string }) => m.title.includes("(캐치업)"));
    assert.ok(catchupMail);
    assert.equal(catchupMail.title, "[일일 출석] 1회차 2일차 출석 보상(캐치업)");
    assert.deepEqual(catchupMail.attachments, { gold: 200 });

    const { body: statusBody } = await getAttendanceStatus(cookie);
    assert.equal(statusBody.general.days[1].state, "ATTENDED"); // 2일차(index 1)
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("이미 출석 처리된 날짜를 캐치업 구매하려 하면 409/12002로 거부된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await loginAndCreateCatchupGap(cookie, playerId, 3);
    const { res, body } = await postCatchup(GENERAL_LAUNCH_DEF_ID, 1, cookie); // 1일차는 최초 로그인 때 이미 지급됨
    assert.equal(res.status, 409);
    assert.equal(body.result, 12002);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("오늘 이후(또는 오늘) 날짜를 캐치업 구매하려 하면 400/12000으로 거부된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await loginAndCreateCatchupGap(cookie, playerId, 3); // 오늘 = 4일차
    const { res, body } = await postCatchup(GENERAL_LAUNCH_DEF_ID, 4, cookie);
    assert.equal(res.status, 400);
    assert.equal(body.result, 12000);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("골드가 부족하면 409/12003으로 거부된다", async () => {
  const { playerId, cookie } = await createTestPlayer(0);
  try {
    await loginAndCreateCatchupGap(cookie, playerId, 3);
    const { res, body } = await postCatchup(GENERAL_LAUNCH_DEF_ID, 2, cookie);
    assert.equal(res.status, 409);
    assert.equal(body.result, 12003);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("캐치업 구매 가능 횟수를 초과하면 409/12004로 거부된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await loginAndCreateCatchupGap(cookie, playerId, 3);
    await attendanceCollection().updateOne({ playerId, defId: GENERAL_LAUNCH_DEF_ID }, { $set: { catchupPurchaseCount: 3 } }); // catchupMaxCount=3

    const { res, body } = await postCatchup(GENERAL_LAUNCH_DEF_ID, 2, cookie);
    assert.equal(res.status, 409);
    assert.equal(body.result, 12004);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("존재하지 않는 출석부를 캐치업 구매하려 하면 404/12001로 거부된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await getPlayerMe(cookie);
    const { res, body } = await postCatchup("no_such_def", 1, cookie);
    assert.equal(res.status, 404);
    assert.equal(body.result, 12001);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("이미 종료된(로테이션 없는 EVENT) 출석부를 캐치업 구매하려 하면 409/12005로 거부된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await getPlayerMe(cookie); // event_newbie_attendance 발급 + 1일차 지급
    await attendanceCollection().updateOne(
      { playerId, defId: EVENT_NEWBIE_DEF_ID },
      { $set: { endDate: addDaysToDateString(todayDateString(), -1) } },
    );
    await getPlayerMe(cookie); // endDate가 지났으니 이 로그인에서 COMPLETED 처리됨(재발급 없음, maxRotationCount=0)

    const { res, body } = await postCatchup(EVENT_NEWBIE_DEF_ID, 1, cookie);
    assert.equal(res.status, 409);
    assert.equal(body.result, 12005);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("GENERAL 출석부가 종료되면 같은 문서가 in-place로 리셋되어 재사용되고 reset 감사 로그가 남는다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await getPlayerMe(cookie);
    const before = await attendanceCollection().findOne({ playerId, defId: GENERAL_LAUNCH_DEF_ID });
    assert.equal(before!.rotationCount, 1);

    await attendanceCollection().updateOne(
      { playerId, defId: GENERAL_LAUNCH_DEF_ID },
      { $set: { endDate: addDaysToDateString(todayDateString(), -1) } },
    );
    await getPlayerMe(cookie); // 완료 처리 + 로테이션 재발급이 같은 로그인 호출 안에서 일어남

    const after = await attendanceCollection().findOne({ playerId, defId: GENERAL_LAUNCH_DEF_ID });
    assert.equal(after!._id, before!._id); // 새 문서가 아니라 같은 문서를 재사용
    assert.equal(after!.rotationCount, 2);
    assert.equal(after!.status, "ACTIVE");
    assert.deepEqual(after!.attendedDays, [1]); // 새 사이클 1일차만 지급됨

    const resetLog = await mongoLogClient
      .db(config.mongoAppDatabaseLog)
      .collection<{ actorId: string; action: string; changes: { defId: string; rotationCount: number } }>(COLLECTIONS.LOG_ATTENDANCE)
      .findOne({ actorId: playerId, action: "reset" });
    assert.ok(resetLog);
    assert.equal(resetLog!.changes.defId, GENERAL_LAUNCH_DEF_ID);
    assert.equal(resetLog!.changes.rotationCount, 1); // 리셋되기 직전 옛 사이클의 rotationCount
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("세션 쿠키 없이 요청하면 401로 거부된다", async () => {
  const statusRes = await fetch(`${baseUrl}/attendance`);
  assert.equal(statusRes.status, 401);

  const catchupRes = await fetch(`${baseUrl}/attendance/${GENERAL_LAUNCH_DEF_ID}/catchup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ day: 1 }),
  });
  assert.equal(catchupRes.status, 401);
});
