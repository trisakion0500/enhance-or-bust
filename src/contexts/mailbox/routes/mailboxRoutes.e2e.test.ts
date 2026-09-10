import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Card } from "../../player/domain/card.js";
import { config } from "../../../config/env.js";
import { Economy } from "../../player/domain/economy.js";
import { Inventory } from "../../player/domain/inventory.js";
import { Mail } from "../domain/mail.js";
import { Player } from "../../player/domain/player.js";
import { connectMongo, mongoClient } from "../../../infra/mongo.js";
import { connectMongoLog, mongoLogClient } from "../../../infra/mongoLog.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { MongoMailboxRepository } from "../infrastructure/mongoMailboxRepository.js";
import { MongoPlayerRepository } from "../../player/infrastructure/mongoPlayerRepository.js";
import { connectRedis, redisClient } from "../../../infra/redis.js";
import { createSession } from "../../auth/infrastructure/sessionStore.js";
import { createServer } from "../../../server.js";
import { sendMail } from "../application/mailboxService.js";

/**
 * 우편함 API E2E 테스트. 다른 컨텍스트와 동일하게 Mongo/Redis에 실제로 붙어 `createServer()`가
 * 만드는 앱을 임시 포트로 띄운 뒤 `fetch`로 호출한다. 발송(SendMail)은 플레이어가 직접 부르는
 * API가 없으므로(실제 시스템에서도 다른 Use-case가 내부적으로 호출) `sendMail()`을 테스트가
 * 직접 호출해 우편을 시딩한다.
 * @author trisakion
 */

let baseUrl: string;
let playerRepository: MongoPlayerRepository;
let mailboxRepository: MongoMailboxRepository;
let httpServer: import("node:http").Server;

before(async () => {
  const db = await connectMongo();
  await connectMongoLog();
  await connectRedis();
  await masterDataCache.loadAll(db);

  playerRepository = new MongoPlayerRepository(db);
  mailboxRepository = new MongoMailboxRepository(db);
  httpServer = createServer(playerRepository, mailboxRepository).listen(0);
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

/** 카드 `cardCount`장을 가진 테스트 플레이어를 만들고, 로그인 세션 쿠키까지 발급해 반환한다. */
async function createTestPlayer(cardCount = 1) {
  const playerId = randomUUID();
  const cards = Array.from({ length: cardCount }, () => new Card(randomUUID(), "N_01"));
  const player = new Player(
    playerId,
    0,
    "test",
    `test-${playerId}`,
    "테스트유저",
    "test@example.com",
    undefined,
    new Inventory(cards),
    new Economy(1000, 0, 0),
    0,
  );
  await playerRepository.create(player);
  const token = await createSession(playerId);
  return { playerId, cookie: `sessionToken=${token}` };
}

/** 테스트가 만든 플레이어/우편 문서를 지운다. */
async function deleteTestPlayer(playerId: string) {
  const db = mongoClient.db(process.env.MONGO_APP_DATABASE);
  await db.collection<{ _id: string }>("players").deleteOne({ _id: playerId });
  await db.collection<{ playerId: string }>("mailbox").deleteMany({ playerId });
}

/** playerId로 현재 플레이어 문서를 직접 읽는다(응답 바디만으로는 확인 못 하는 최종 DB 상태 검증용). */
async function readPlayer(playerId: string) {
  return mongoClient
    .db(process.env.MONGO_APP_DATABASE)
    .collection<{
      _id: string;
      inventory: { cardId: string; templateId: string }[];
      economy: { gold: number; enhancementStone: number; diamond: number };
    }>("players")
    .findOne({ _id: playerId });
}

async function listMails(cookie: string) {
  const res = await fetch(`${baseUrl}/mailbox`, { headers: { Cookie: cookie } });
  return { res, body: await res.json() };
}

async function claimMail(mailId: string, cookie: string) {
  const res = await fetch(`${baseUrl}/mailbox/${mailId}/claim`, { method: "POST", headers: { Cookie: cookie } });
  return { res, body: await res.json() };
}

async function deleteMailReq(mailId: string, cookie: string) {
  const res = await fetch(`${baseUrl}/mailbox/${mailId}`, { method: "DELETE", headers: { Cookie: cookie } });
  return { res, body: await res.json() };
}

test("발송된 우편이 목록에 나타나고, 수령하면 골드/강화석/카드가 지급된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await sendMail(playerId, "스테이지 클리어 보상", { gold: 100, enhancementStone: 3, cardTemplateIds: ["N_01"] }, "test", randomUUID(), mailboxRepository);

    const { body: listBody } = await listMails(cookie);
    assert.equal(listBody.mails.length, 1);
    const mailId = listBody.mails[0].mailId;
    assert.equal(listBody.mails[0].claimedAt, null);

    const { res, body } = await claimMail(mailId, cookie);
    assert.equal(res.status, 200);
    assert.equal(body.result, 0);
    assert.ok(body.mail.claimedAt);

    const player = await readPlayer(playerId);
    assert.equal(player!.economy.gold, 1100);
    assert.equal(player!.economy.enhancementStone, 3);
    assert.equal(player!.inventory.length, 2);
    assert.ok(player!.inventory.some(c => c.templateId === "N_01" && c.cardId !== undefined));
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("이미 수령한 우편을 다시 수령하면 409/7002로 거부된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await sendMail(playerId, "테스트 우편", { gold: 10 }, "test", randomUUID(), mailboxRepository);
    const { body: listBody } = await listMails(cookie);
    const mailId = listBody.mails[0].mailId;

    await claimMail(mailId, cookie);
    const { res, body } = await claimMail(mailId, cookie);
    assert.equal(res.status, 409);
    assert.equal(body.result, 7002);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("존재하지 않거나 남의 우편을 수령하면 404/7001로 거부된다", async () => {
  const { playerId: ownerId, cookie: ownerCookie } = await createTestPlayer();
  const { playerId: otherId, cookie: otherCookie } = await createTestPlayer();
  try {
    await sendMail(ownerId, "테스트 우편", { gold: 10 }, "test", randomUUID(), mailboxRepository);
    const { body: listBody } = await listMails(ownerCookie);
    const mailId = listBody.mails[0].mailId;

    const otherAttempt = await claimMail(mailId, otherCookie);
    assert.equal(otherAttempt.res.status, 404);
    assert.equal(otherAttempt.body.result, 7001);

    const missingAttempt = await claimMail(randomUUID(), ownerCookie);
    assert.equal(missingAttempt.res.status, 404);
    assert.equal(missingAttempt.body.result, 7001);
  } finally {
    await deleteTestPlayer(ownerId);
    await deleteTestPlayer(otherId);
  }
});

test("만료된 우편을 수령하면 409/7003으로 거부되고 목록에도 나타나지 않는다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    const past = new Date(Date.now() - 1000);
    const expiredMail = new Mail(randomUUID(), playerId, "만료된 우편", { gold: 10 }, "test", randomUUID(), past, past, null);
    await mailboxRepository.insertMail(expiredMail);

    const { body: listBody } = await listMails(cookie);
    assert.equal(listBody.mails.length, 0);

    const { res, body } = await claimMail(expiredMail.mailId, cookie);
    assert.equal(res.status, 409);
    assert.equal(body.result, 7003);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("동일 sourceType+sourceId로 두 번 발송해도 우편은 1건만 생성된다(멱등)", async () => {
  const { playerId, cookie } = await createTestPlayer();
  const sourceId = randomUUID();
  try {
    await sendMail(playerId, "중복 발송 테스트", { gold: 10 }, "test", sourceId, mailboxRepository);
    await sendMail(playerId, "중복 발송 테스트", { gold: 10 }, "test", sourceId, mailboxRepository);

    const { body: listBody } = await listMails(cookie);
    assert.equal(listBody.mails.length, 1);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("인벤토리가 상한에 도달한 상태에서 카드 첨부 우편을 수령하면 409/7004로 거부되고 미수령 상태로 남는다", async () => {
  const { playerId, cookie } = await createTestPlayer(config.inventorySlotCap);
  try {
    await sendMail(playerId, "카드 보상", { gold: 50, cardTemplateIds: ["N_01"] }, "test", randomUUID(), mailboxRepository);
    const { body: listBody } = await listMails(cookie);
    const mailId = listBody.mails[0].mailId;

    const { res, body } = await claimMail(mailId, cookie);
    assert.equal(res.status, 409);
    assert.equal(body.result, 7004);

    const player = await readPlayer(playerId);
    assert.equal(player!.inventory.length, config.inventorySlotCap); // 카드 지급 안 됨
    assert.equal(player!.economy.gold, 1000); // 골드도 함께 거부(all-or-nothing)

    const { body: listAfter } = await listMails(cookie);
    assert.equal(listAfter.mails[0].claimedAt, null); // 우편은 미수령 상태 그대로
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("인벤토리가 상한 바로 아래일 때 카드 1장 수령은 상한에 딱 맞아 성공한다", async () => {
  const { playerId, cookie } = await createTestPlayer(config.inventorySlotCap - 1);
  try {
    await sendMail(playerId, "카드 보상", { cardTemplateIds: ["N_01"] }, "test", randomUUID(), mailboxRepository);
    const { body: listBody } = await listMails(cookie);
    const mailId = listBody.mails[0].mailId;

    const { res, body } = await claimMail(mailId, cookie);
    assert.equal(res.status, 200);
    assert.equal(body.result, 0);

    const player = await readPlayer(playerId);
    assert.equal(player!.inventory.length, config.inventorySlotCap);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("수령한 우편을 삭제하면 목록에서 사라진다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await sendMail(playerId, "테스트 우편", { gold: 10 }, "test", randomUUID(), mailboxRepository);
    const { body: listBody } = await listMails(cookie);
    const mailId = listBody.mails[0].mailId;

    await claimMail(mailId, cookie);
    const { res, body } = await deleteMailReq(mailId, cookie);
    assert.equal(res.status, 200);
    assert.equal(body.result, 0);

    const { body: listAfter } = await listMails(cookie);
    assert.equal(listAfter.mails.length, 0);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("미수령 우편을 삭제하려 하면 409/7005로 거부된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    await sendMail(playerId, "테스트 우편", { gold: 10 }, "test", randomUUID(), mailboxRepository);
    const { body: listBody } = await listMails(cookie);
    const mailId = listBody.mails[0].mailId;

    const { res, body } = await deleteMailReq(mailId, cookie);
    assert.equal(res.status, 409);
    assert.equal(body.result, 7005);

    const { body: listAfter } = await listMails(cookie);
    assert.equal(listAfter.mails.length, 1); // 여전히 목록에 남아있음
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("세션 쿠키 없이 요청하면 401로 거부된다", async () => {
  const res = await fetch(`${baseUrl}/mailbox`);
  assert.equal(res.status, 401);
});
