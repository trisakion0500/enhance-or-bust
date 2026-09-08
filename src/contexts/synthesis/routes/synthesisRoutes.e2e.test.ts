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

/**
 * 합성 API E2E 테스트. enhancementRoutes.e2e.test.ts와 동일한 패턴 — 실제 로컬 Mongo/Redis에
 * 붙어 `createServer()`가 만드는 앱을 임시 포트로 띄운 뒤 `fetch`로 호출한다.
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

/** 지정한 원형의 카드 N장(+옵션으로 강화 대상 카드 1장)을 가진 테스트 플레이어를 만들고 세션 쿠키까지 발급한다. */
async function createTestPlayer(materialTemplateIds: string[], targetCard?: { templateId: string; enhancementLevel: number }) {
  const playerId = randomUUID();
  const materialCardIds = materialTemplateIds.map(() => randomUUID());
  const cards = materialCardIds.map((cardId, i) => new Card(cardId, materialTemplateIds[i]));
  let targetCardId: string | undefined;
  if (targetCard) {
    targetCardId = randomUUID();
    cards.push(new Card(targetCardId, targetCard.templateId, 1, 0, targetCard.enhancementLevel));
  }

  const player = new Player(
    playerId,
    0,
    "test",
    `test-${playerId}`,
    "테스트유저",
    "test@example.com",
    undefined,
    new Inventory(cards),
    new Economy(1_000_000, 1_000_000, 0),
  );
  await playerRepository.create(player);
  const token = await createSession(playerId);
  return { playerId, materialCardIds, targetCardId, cookie: `sessionToken=${token}` };
}

async function deleteTestPlayer(playerId: string) {
  await mongoClient.db(process.env.MONGO_APP_DATABASE).collection<{ _id: string }>("players").deleteOne({ _id: playerId });
}

async function readPlayer(playerId: string) {
  return mongoClient
    .db(process.env.MONGO_APP_DATABASE)
    .collection<{ _id: string; inventory: { cardId: string; templateId: string; enhancementLevel: number }[]; economy: { gold: number } }>(
      "players",
    )
    .findOne({ _id: playerId });
}

function postJson(path: string, cookie: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
}

test("N등급 카드 3장으로 승급 합성을 반복 시도하면 성공(R 승급)과 실패(소재 1장만 소모) 모두 나온다", async () => {
  // 80% 성공 확률이라 한 번으로는 어느 쪽도 보장 못 한다. 서로 다른 플레이어 60명이 각자
  // 한 번씩 시도하게 해서, 그 분포 전체에서 두 결과가 실제로 다 나오는지 확인한다 — 실패가
  // 60번 다 안 나올 확률은 100만분의 1 미만(0.8^60 ≈ 8.3e-7)이라 사실상 무시 가능한 수준.
  const TRIALS = 60;
  const players = await Promise.all(Array.from({ length: TRIALS }, () => createTestPlayer(["N_01", "N_01", "N_01"])));
  try {
    const results = await Promise.all(
      players.map(p => postJson("/synthesis/grade-upgrade", p.cookie, { materialCardIds: p.materialCardIds }).then(res => res.json())),
    );

    const successCount = results.filter(r => r.success === true).length;
    const failCount = results.filter(r => r.success === false).length;
    assert.equal(successCount + failCount, TRIALS);
    assert.ok(successCount > 0, "60번 시도 중 성공이 한 번도 안 나옴 — 확률표/구현을 다시 확인해야 함");
    assert.ok(failCount > 0, "60번 시도 중 실패가 한 번도 안 나옴 — 확률표/구현을 다시 확인해야 함");

    for (let i = 0; i < TRIALS; i++) {
      const player = await readPlayer(players[i].playerId);
      if (results[i].success) {
        assert.equal(player!.inventory.length, 1, "성공 시 소재 3장이 전부 사라지고 결과 카드 1장만 남아야 함");
        assert.equal(player!.inventory[0].cardId, results[i].resultCardId);
      } else {
        assert.equal(player!.inventory.length, 2, "실패 시 소재 3장 중 1장만 소모되고 2장은 남아야 함");
      }
    }
  } finally {
    await Promise.all(players.map(p => deleteTestPlayer(p.playerId)));
  }
});

test("등급이 섞인 소재로 승급 합성을 시도하면 검증 실패로 거부된다", async () => {
  const { playerId, materialCardIds, cookie } = await createTestPlayer(["N_01", "N_01", "R_01"]);
  try {
    const res = await postJson("/synthesis/grade-upgrade", cookie, { materialCardIds });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.result, 4000);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("최상위 등급(SSR) 카드는 더 승급할 곳이 없어 거부된다", async () => {
  const { playerId, materialCardIds, cookie } = await createTestPlayer(["SSR_01", "SSR_01", "SSR_01"]);
  try {
    const res = await postJson("/synthesis/grade-upgrade", cookie, { materialCardIds });
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.result, 4003);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("동일 소재 카드를 중복 지정하면 검증 실패로 거부된다", async () => {
  const { playerId, materialCardIds, cookie } = await createTestPlayer(["N_01", "N_01", "N_01"]);
  try {
    const res = await postJson("/synthesis/grade-upgrade", cookie, {
      materialCardIds: [materialCardIds[0], materialCardIds[0], materialCardIds[1]],
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.result, 4000);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("소재 카드 2장을 동시에 두 승급 요청에 겹쳐 쓰면 하나만 성공하고 나머지는 카드 유실 없이 거부된다", async () => {
  // 같은 소재 카드 1장(materialCardIds[0])을 두 요청 모두에 포함시켜 동시에 쏜다. 낙관적 락 덕에
  // 둘 다 성공(=카드가 두 번 소모)하는 일은 없어야 하고, DB에 남는 카드 수는 항상 정합적이어야 한다.
  const { playerId, materialCardIds, cookie } = await createTestPlayer(["N_01", "N_01", "N_01", "N_01", "N_01"]);
  try {
    const [resA, resB] = await Promise.all([
      postJson("/synthesis/grade-upgrade", cookie, { materialCardIds: [materialCardIds[0], materialCardIds[1], materialCardIds[2]] }),
      postJson("/synthesis/grade-upgrade", cookie, { materialCardIds: [materialCardIds[0], materialCardIds[3], materialCardIds[4]] }),
    ]);
    const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);

    const okCount = [bodyA, bodyB].filter(b => b.result === 0).length;
    const conflictOrNotFound = [bodyA, bodyB].filter(b => [1002, 4001].includes(b.result)).length;
    assert.equal(okCount, 1, `겹치는 소재를 쓴 동시 요청 중 하나만 처리돼야 함: ${JSON.stringify([bodyA, bodyB])}`);
    assert.equal(conflictOrNotFound, 1);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("강화 재료 합성 성공 시 대상 카드 강화 단계가 +1 되고 재료·골드가 소모된다", async () => {
  const { playerId, materialCardIds, targetCardId, cookie } = await createTestPlayer(["N_01", "N_01"], {
    templateId: "N_01",
    enhancementLevel: 2,
  });
  try {
    const res = await postJson("/synthesis/enhance-material", cookie, { targetCardId, materialCardIds });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { result: 0, enhancementLevel: 3, gold: 999_500 });

    const player = await readPlayer(playerId);
    assert.equal(player!.inventory.length, 1);
    assert.equal(player!.inventory[0].cardId, targetCardId);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("이미 최대 강화 단계인 카드는 강화 재료 합성도 MAX_LEVEL_REACHED로 거부된다", async () => {
  const { playerId, materialCardIds, targetCardId, cookie } = await createTestPlayer(["N_01", "N_01"], {
    templateId: "N_01",
    enhancementLevel: 5,
  });
  try {
    const res = await postJson("/synthesis/enhance-material", cookie, { targetCardId, materialCardIds });
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.result, 4002);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("원형이 다른 재료로 강화 재료 합성을 시도하면 검증 실패로 거부된다", async () => {
  const { playerId, materialCardIds, targetCardId, cookie } = await createTestPlayer(["N_01", "N_02"], {
    templateId: "N_01",
    enhancementLevel: 0,
  });
  try {
    const res = await postJson("/synthesis/enhance-material", cookie, { targetCardId, materialCardIds });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.result, 4000);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("대상 카드 자신을 재료로 지정하면 검증 실패로 거부된다", async () => {
  const { playerId, materialCardIds, targetCardId, cookie } = await createTestPlayer(["N_01", "N_01"], {
    templateId: "N_01",
    enhancementLevel: 0,
  });
  try {
    const res = await postJson("/synthesis/enhance-material", cookie, {
      targetCardId,
      materialCardIds: [targetCardId, materialCardIds[0]],
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.result, 4000);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("세션 쿠키 없이 합성을 요청하면 401로 거부된다", async () => {
  const { playerId, materialCardIds } = await createTestPlayer(["N_01", "N_01", "N_01"]);
  try {
    const res = await fetch(`${baseUrl}/synthesis/grade-upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ materialCardIds }),
    });
    assert.equal(res.status, 401);
  } finally {
    await deleteTestPlayer(playerId);
  }
});
