import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Card } from "../domain/card.js";
import { Economy } from "../domain/economy.js";
import { Inventory } from "../domain/inventory.js";
import { Player } from "../domain/player.js";
import { connectMongo, mongoClient } from "../../../infra/mongo.js";
import { connectMongoLog, mongoLogClient } from "../../../infra/mongoLog.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { MongoPlayerRepository } from "../infrastructure/mongoPlayerRepository.js";
import { MongoMailboxRepository } from "../../mailbox/infrastructure/mongoMailboxRepository.js";
import { connectRedis, redisClient } from "../../../infra/redis.js";
import { createSession } from "../../auth/infrastructure/sessionStore.js";
import { createServer } from "../../../server.js";

/**
 * 플레이어 자기 자신 조회(`GET /player/me`) API E2E 테스트. 다른 컨텍스트와 동일하게
 * Mongo/Redis에 실제로 붙어 `createServer()`가 만드는 앱을 임시 포트로 띄운 뒤 `fetch`로 호출한다.
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
  httpServer = createServer(playerRepository, new MongoMailboxRepository(db)).listen(0);
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

/** 카드 1장(N_01)을 가진 테스트 플레이어를 만들고, 로그인 세션 쿠키까지 발급해 반환한다. */
async function createTestPlayer() {
  const playerId = randomUUID();
  const cardId = randomUUID();
  const player = new Player(
    playerId,
    0,
    "test",
    `test-${playerId}`,
    "테스트유저",
    "test@example.com",
    "https://example.com/pic.png",
    new Inventory([new Card(cardId, "N_01", 3, 40, 0)]),
    new Economy(1000, 5, 0),
    2,
  );
  await playerRepository.create(player);
  const token = await createSession(playerId);
  return { playerId, cardId, cookie: `sessionToken=${token}` };
}

/** 테스트가 만든 플레이어 문서를 지운다. */
async function deleteTestPlayer(playerId: string) {
  await mongoClient.db(process.env.MONGO_APP_DATABASE).collection<{ _id: string }>("players").deleteOne({ _id: playerId });
}

test("로그인한 플레이어는 자신의 재화/clearedStage/보유 카드(원형 정보 조인)를 조회할 수 있다", async () => {
  const { playerId, cardId, cookie } = await createTestPlayer();
  try {
    const res = await fetch(`${baseUrl}/player/me`, { headers: { Cookie: cookie } });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.result, 0);
    assert.equal(body.name, "테스트유저");
    assert.deepEqual(body.economy, { gold: 1000, enhancementStone: 5, diamond: 0 });
    assert.equal(body.clearedStage, 2);
    assert.equal(body.inventory.length, 1);
    assert.deepEqual(body.inventory[0], {
      cardId,
      templateId: "N_01",
      grade: "N",
      baseAttack: body.inventory[0].baseAttack,
      baseHp: body.inventory[0].baseHp,
      element: body.inventory[0].element,
      level: 3,
      exp: 40,
      enhancementLevel: 0,
    });
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("세션 쿠키 없이 요청하면 401로 거부된다", async () => {
  const res = await fetch(`${baseUrl}/player/me`);
  assert.equal(res.status, 401);
});
