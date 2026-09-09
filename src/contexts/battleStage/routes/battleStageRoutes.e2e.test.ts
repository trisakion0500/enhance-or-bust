import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Card } from "../../player/domain/card.js";
import { Economy } from "../../player/domain/economy.js";
import { Inventory } from "../../player/domain/inventory.js";
import { Player } from "../../player/domain/player.js";
import { connectMongo, mongoClient } from "../../../infra/mongo.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { MongoPlayerRepository } from "../../player/infrastructure/mongoPlayerRepository.js";
import { MongoMailboxRepository } from "../../mailbox/infrastructure/mongoMailboxRepository.js";
import { connectRedis, redisClient } from "../../../infra/redis.js";
import { createSession } from "../../auth/infrastructure/sessionStore.js";
import { createServer } from "../../../server.js";

interface MailDto {
  mailId: string;
  title: string;
  sourceType: string;
  attachments: { gold?: number; enhancementStone?: number; cardTemplateIds?: string[] };
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
}

/**
 * 전투/스테이지 API E2E 테스트. 다른 컨텍스트와 동일하게 Mongo/Redis에 실제로 붙어
 * `createServer()`가 만드는 앱을 임시 포트로 띄운 뒤 `fetch`로 호출한다.
 *
 * SSR_01(공격력 100)로 스테이지 1(몬스터 체력 58)을 도전하면 항상 1라운드에 원샷으로
 * 이긴다 — 확률 요소(강화석 드랍) 없이 승패/보상 계산 자체를 결정론적으로 검증할 수 있게
 * 일부러 이 조합을 쓴다. 반대로 N_01(공격력 10)로 51스테이지처럼 훨씬 강한 몬스터에게
 * 도전하면 항상 1라운드에 진다.
 * @author trisakion
 */

let baseUrl: string;
let playerRepository: MongoPlayerRepository;
let httpServer: import("node:http").Server;

before(async () => {
  const db = await connectMongo();
  await connectRedis();
  await masterDataCache.loadAll(db);

  playerRepository = new MongoPlayerRepository(db);
  httpServer = createServer(playerRepository, new MongoMailboxRepository(db)).listen(0);
  await new Promise<void>(resolve => httpServer.once("listening", resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise(resolve => httpServer.close(resolve));
  await mongoClient.close();
  await redisClient.quit();
});

interface TestPlayerOptions {
  templateId?: string;
  level?: number;
  exp?: number;
  enhancementLevel?: number;
  clearedStage?: number;
  gold?: number;
  enhancementStone?: number;
}

/** 카드 1장을 가진 테스트 플레이어를 만들고, 로그인 세션 쿠키까지 발급해 반환한다. */
async function createTestPlayer(options: TestPlayerOptions = {}) {
  const playerId = randomUUID();
  const cardId = randomUUID();
  const player = new Player(
    playerId,
    0,
    "test",
    `test-${playerId}`,
    "테스트유저",
    "test@example.com",
    undefined,
    new Inventory([new Card(cardId, options.templateId ?? "SSR_01", options.level ?? 1, options.exp ?? 0, options.enhancementLevel ?? 0)]),
    new Economy(options.gold ?? 1_000_000, options.enhancementStone ?? 0, 0),
    options.clearedStage ?? 0,
  );
  await playerRepository.create(player);
  const token = await createSession(playerId);
  return { playerId, cardId, cookie: `sessionToken=${token}` };
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
      clearedStage: number;
      inventory: { cardId: string; templateId: string; level: number; exp: number }[];
      economy: { gold: number; enhancementStone: number };
    }>("players")
    .findOne({ _id: playerId });
}

async function clearStage(stageId: number, squadCardIds: string[], cookie: string) {
  const res = await fetch(`${baseUrl}/battle-stage/${stageId}/clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ squadCardIds }),
  });
  return { res, body: await res.json() };
}

/** 클리어 보상은 이제 즉시 지급이 아니라 우편 발송이라 응답만으로는 검증 못 하고, 우편함을 직접 조회해야 한다. */
async function listMails(cookie: string): Promise<MailDto[]> {
  const res = await fetch(`${baseUrl}/mailbox`, { headers: { Cookie: cookie } });
  const body = await res.json();
  return body.mails;
}

async function claimMail(mailId: string, cookie: string) {
  const res = await fetch(`${baseUrl}/mailbox/${mailId}/claim`, { method: "POST", headers: { Cookie: cookie } });
  return { res, body: await res.json() };
}

test("최초 클리어 성공 시 clearedStage/EXP는 즉시 반영되고, 골드/강화석은 우편으로 발송된다", async () => {
  const { playerId, cardId, cookie } = await createTestPlayer();
  try {
    const { res, body } = await clearStage(1, [cardId], cookie);

    assert.equal(res.status, 200);
    assert.equal(body.result, 0);
    assert.equal(body.won, true);
    assert.equal(body.rewardGold, 10);
    assert.equal(body.clearedStage, 1);
    assert.equal(body.gold, 1_000_000); // 우편 수령 전이라 아직 안 오름
    assert.deepEqual(body.expGained, [{ cardId, exp: 5, leveledUp: false, levelsGained: 0 }]);
    // stage1: enhancementStoneMin=1, enhancementStoneMax=2, 드랍률 50% — 드랍 안 되면 0, 되면 1~2.
    assert.ok(body.rewardEnhancementStone === 0 || (body.rewardEnhancementStone >= 1 && body.rewardEnhancementStone <= 2), JSON.stringify(body));
    // 카드 드랍(cardDropRateFirstClear 30%) — 드랍 안 되면 null, 되면 카드 원형 ID 문자열.
    assert.ok(body.rewardCardTemplateId === null || typeof body.rewardCardTemplateId === "string", JSON.stringify(body));

    const player = await readPlayer(playerId);
    assert.equal(player!.clearedStage, 1);
    assert.equal(player!.inventory.find(c => c.cardId === cardId)!.exp, 5);
    assert.equal(player!.economy.gold, 1_000_000); // 우편 수령 전이라 아직 안 오름

    const mails = await listMails(cookie);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].title, "스테이지 클리어 보상"); // MAIL_CONTENTS.STAGE_CLEAR.title
    assert.equal(mails[0].sourceType, "stage_clear");
    assert.equal(mails[0].attachments.gold, body.rewardGold);
    assert.equal(mails[0].attachments.enhancementStone, body.rewardEnhancementStone);
    if (body.rewardCardTemplateId) assert.deepEqual(mails[0].attachments.cardTemplateIds, [body.rewardCardTemplateId]);
    else assert.equal(mails[0].attachments.cardTemplateIds, undefined);
    assert.equal(mails[0].claimedAt, null);
    // MAIL_CONTENTS.STAGE_CLEAR.expiryMs가 실제로 적용됐는지 — 발송~만료 간격을 직접 확인.
    const expiryMs = new Date(mails[0].expiresAt).getTime() - new Date(mails[0].createdAt).getTime();
    assert.equal(expiryMs, 7 * 24 * 60 * 60 * 1000);

    const { res: claimRes } = await claimMail(mails[0].mailId, cookie);
    assert.equal(claimRes.status, 200);
    const claimedPlayer = await readPlayer(playerId);
    assert.equal(claimedPlayer!.economy.gold, 1_000_000 + body.rewardGold);
    assert.equal(claimedPlayer!.economy.enhancementStone, body.rewardEnhancementStone);
    assert.equal(claimedPlayer!.inventory.length, body.rewardCardTemplateId ? 2 : 1);
    if (body.rewardCardTemplateId) {
      const droppedCard = claimedPlayer!.inventory.find(c => c.cardId !== cardId);
      assert.ok(droppedCard, JSON.stringify(claimedPlayer));
      assert.equal(droppedCard!.templateId, body.rewardCardTemplateId);
      assert.equal(droppedCard!.level, 1);
      assert.equal(droppedCard!.exp, 0);
    }
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("EXP가 다음 레벨 필요치를 채우면 레벨업하고 잔여 EXP가 정산된다", async () => {
  // level 1 → 2 필요 EXP는 50 × 1^1.5 = 50. exp 45에서 스테이지1(rewardExp 5)을 클리어하면 정확히 50 채워 레벨업.
  const { playerId, cardId, cookie } = await createTestPlayer({ exp: 45 });
  try {
    const { body } = await clearStage(1, [cardId], cookie);
    assert.equal(body.expGained[0].leveledUp, true);
    assert.equal(body.expGained[0].levelsGained, 1);

    const player = await readPlayer(playerId);
    const card = player!.inventory.find(c => c.cardId === cardId)!;
    assert.equal(card.level, 2);
    assert.equal(card.exp, 0);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("클리어한 스테이지를 재도전(파밍)하면 clearedStage는 그대로고 보상은 farmRewardRate만큼 축소돼 우편으로 발송된다", async () => {
  const { playerId, cardId, cookie } = await createTestPlayer({ clearedStage: 5 });
  try {
    const { body } = await clearStage(3, [cardId], cookie);

    assert.equal(body.won, true);
    assert.equal(body.rewardGold, 15); // stage3 rewardGold(30) × farmRewardRate(0.5)
    assert.equal(body.clearedStage, 5);
    assert.equal(body.expGained[0].exp, 8); // round(stage3 rewardExp(15) × 0.5) = round(7.5) = 8

    const player = await readPlayer(playerId);
    assert.equal(player!.clearedStage, 5);

    const mails = await listMails(cookie);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].attachments.gold, 15);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("전투력이 부족한 스테이지에 도전하면 패배하고 보상/clearedStage 변화가 없다", async () => {
  const { playerId, cardId, cookie } = await createTestPlayer({ templateId: "N_01", clearedStage: 50 });
  try {
    const { res, body } = await clearStage(51, [cardId], cookie);

    assert.equal(res.status, 200);
    assert.equal(body.won, false);
    assert.equal(body.rewardGold, 0);
    assert.equal(body.rewardEnhancementStone, 0);
    assert.deepEqual(body.expGained, []);
    assert.equal(body.clearedStage, 50);
    assert.equal(body.gold, 1_000_000);

    const player = await readPlayer(playerId);
    assert.equal(player!.clearedStage, 50);
    assert.equal(player!.economy.gold, 1_000_000);

    const mails = await listMails(cookie);
    assert.equal(mails.length, 0); // 패배 시엔 우편도 발송되지 않아야 함
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("clearedStage+1을 넘어서는 스테이지는 STAGE_LOCKED(8002)로 거부된다", async () => {
  const { playerId, cardId, cookie } = await createTestPlayer();
  try {
    const { res, body } = await clearStage(2, [cardId], cookie);
    assert.equal(res.status, 409);
    assert.equal(body.result, 8002);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("보유하지 않은 카드를 출전시키면 404로 거부된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    const { res, body } = await clearStage(1, [randomUUID()], cookie);
    assert.equal(res.status, 404);
    assert.equal(body.result, 8001);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("출전 카드 0장 또는 중복 ID는 VALIDATION_FAILED(8000)로 거부된다", async () => {
  const { playerId, cardId, cookie } = await createTestPlayer();
  try {
    const empty = await clearStage(1, [], cookie);
    assert.equal(empty.res.status, 400);
    assert.equal(empty.body.result, 8000);

    const duplicate = await clearStage(1, [cardId, cardId], cookie);
    assert.equal(duplicate.res.status, 400);
    assert.equal(duplicate.body.result, 8000);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("세션 쿠키 없이 요청하면 401로 거부된다", async () => {
  const { playerId, cardId } = await createTestPlayer();
  try {
    const res = await fetch(`${baseUrl}/battle-stage/1/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ squadCardIds: [cardId] }),
    });
    assert.equal(res.status, 401);
  } finally {
    await deleteTestPlayer(playerId);
  }
});
