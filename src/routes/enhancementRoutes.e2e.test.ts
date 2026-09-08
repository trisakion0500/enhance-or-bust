import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Card } from "../domain/player/card.js";
import { Economy } from "../domain/player/economy.js";
import { Inventory } from "../domain/player/inventory.js";
import { Player } from "../domain/player/player.js";
import { connectMongo, mongoClient } from "../infra/mongo.js";
import { masterDataCache } from "../infra/masterDataCache.js";
import { MongoPlayerRepository } from "../infra/mongoPlayerRepository.js";
import { connectRedis, redisClient } from "../infra/redis.js";
import { createSession } from "../infra/sessionStore.js";
import { createServer } from "../server.js";

/**
 * 강화 API E2E 테스트. Mongo/Redis에 실제로 붙어 `createServer()`가 만드는 앱을 임시 포트로
 * 띄운 뒤 `fetch`로 호출한다 — 목(mock)이나 인메모리 DB 대역 라이브러리를 쓰지 않고 로컬
 * 개발 인프라를 그대로 사용한다(테스트 데이터는 각 테스트가 스스로 만들고 지운다).
 * `node --test`(내장 테스트 러너)만 쓰고 별도 테스트 프레임워크 의존성은 추가하지 않는다.
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
  httpServer = createServer(playerRepository).listen(0);
  await new Promise<void>(resolve => httpServer.once("listening", resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise(resolve => httpServer.close(resolve));
  await mongoClient.close();
  await redisClient.quit();
});

/** 카드 1장을 가진 테스트 플레이어를 만들고, 로그인 세션 쿠키까지 발급해 반환한다. */
async function createTestPlayer(enhancementLevel = 0, templateId = "N_01") {
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
    new Inventory([new Card(cardId, templateId, 1, 0, enhancementLevel)]),
    new Economy(1_000_000, 1_000_000, 0),
  );
  await playerRepository.create(player);
  const token = await createSession(playerId);
  return { playerId, cardId, cookie: `sessionToken=${token}` };
}

/** 테스트가 만든 플레이어 문서를 지운다. */
async function deleteTestPlayer(playerId: string) {
  await mongoClient.db(process.env.MONGO_APP_DATABASE).collection<{ _id: string }>("players").deleteOne({ _id: playerId });
}

/** playerId로 현재 플레이어 문서를 직접 읽는다(응답 바디만으로는 확인 못 하는 최종 DB 상태 검증용). */
async function readPlayer(playerId: string) {
  return mongoClient
    .db(process.env.MONGO_APP_DATABASE)
    .collection<{ _id: string; inventory: { cardId: string; enhancementLevel: number }[]; economy: { gold: number; enhancementStone: number } }>("players")
    .findOne({ _id: playerId });
}

/**
 * 강화 성공 또는 카드 파괴 중 하나가 나올 때까지 같은 카드에 반복 요청한다(확률 구간 테스트용).
 * 두 결과 다 그 즉시 최종 상태라 — 성공하면 그 카드는 더 시도할 이유가 없고, 파괴되면 카드 자체가
 * 사라진다 — 재시도할 필요 없이 응답 하나로 종료 여부를 판단할 수 있다.
 */
async function enhanceUntilTerminal(cardId: string, cookie: string, maxAttempts = 100): Promise<"success" | "destroyed"> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${baseUrl}/enhancement/${cardId}`, { method: "POST", headers: { Cookie: cookie } });
    const body = await res.json();
    if (body.success) return "success";
    if (body.destroyed) return "destroyed";
  }
  throw new Error(`${maxAttempts}번 시도해도 종료 상태(성공/파괴)에 도달하지 못함`);
}

test("강화 성공 시(+0~5 구간, 100% 성공) 강화 단계가 오르고 재화가 규칙대로 차감된다", async () => {
  const { playerId, cardId, cookie } = await createTestPlayer();
  try {
    const res = await fetch(`${baseUrl}/enhancement/${cardId}`, { method: "POST", headers: { Cookie: cookie } });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { result: 0, success: true, destroyed: false, enhancementLevel: 1, gold: 999_900, enhancementStone: 999_999 });
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("이미 최대 강화 단계(N등급 +5)인 카드는 MAX_LEVEL_REACHED로 거부된다", async () => {
  const { playerId, cardId, cookie } = await createTestPlayer(5);
  try {
    const res = await fetch(`${baseUrl}/enhancement/${cardId}`, { method: "POST", headers: { Cookie: cookie } });
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.equal(body.result, 3002);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("존재하지 않는 카드를 강화 시도하면 404로 거부된다", async () => {
  const { playerId, cookie } = await createTestPlayer();
  try {
    const res = await fetch(`${baseUrl}/enhancement/${randomUUID()}`, { method: "POST", headers: { Cookie: cookie } });
    const body = await res.json();

    assert.equal(res.status, 404);
    assert.equal(body.result, 2001);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("세션 쿠키 없이 요청하면 401로 거부된다", async () => {
  const { playerId, cardId } = await createTestPlayer();
  try {
    const res = await fetch(`${baseUrl}/enhancement/${cardId}`, { method: "POST" });
    assert.equal(res.status, 401);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("동시 강화 요청은 손실 없이 순차 실행과 동일한 결과로 수렴한다(낙관적 락 재시도, TOCTOU 방지)", async () => {
  // N등급 카드(+0~5, 100% 성공)라 결과가 확률에 안 흔들린다 — 동시 요청 8개를 던지면
  // 카드가 최대 강화 단계(+5)에 도달할 때까지만 성공하고(딱 5번), 나머지는 최대 단계 도달
  // (3002) 또는 낙관적 락 재시도 초과(1002) 중 하나로 끝나야 한다. 어느 요청이 어느 결과를
  // 받든, "몇 번 성공했는지 · 최종 강화 단계 · 차감된 재화"는 순차 실행했을 때와 같아야
  // 한다 — 이게 달라지면 동시 요청 중 일부가 유실되거나 이중 반영됐다는 뜻이다.
  const CONCURRENT_REQUESTS = 8;
  const { playerId, cardId, cookie } = await createTestPlayer(0);
  try {
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () =>
        fetch(`${baseUrl}/enhancement/${cardId}`, { method: "POST", headers: { Cookie: cookie } }).then(res => res.json()),
      ),
    );

    const successes = responses.filter(body => body.success === true);
    const failures = responses.filter(body => body.success !== true);
    assert.equal(successes.length, 5, `성공 횟수는 강화 상한(+5)만큼만 나와야 함: ${JSON.stringify(responses)}`);
    for (const body of failures) assert.ok([1002, 3002].includes(body.result), `예상 못한 에러 코드: ${JSON.stringify(body)}`);

    const player = await readPlayer(playerId);
    const card = player!.inventory.find(c => c.cardId === cardId)!;
    assert.equal(card.enhancementLevel, 5);
    assert.equal(player!.economy.gold, 1_000_000 - 100 * (1 + 2 + 3 + 4 + 5));
    assert.equal(player!.economy.enhancementStone, 1_000_000 - 5);
  } finally {
    await deleteTestPlayer(playerId);
  }
});

test("SSR 카드는 +14~+15 구간에서 반복 시도 시 성공(+15 도달) 또는 파괴로 끝나며, 두 결과가 실제로 다 나온다", async () => {
  // +11~15 구간은 성공 40% / 실패 시 파괴 10%라 한두 번 시도로는 어느 쪽도 보장 못 한다.
  // 서로 다른 플레이어 100명이 각자 "성공 또는 파괴"에 도달할 때까지 독립적으로 반복 시도하게 해서,
  // 그 분포 전체에서 두 결과가 실제로 다 나오는지 확인한다 — 파괴가 100번 다 안 나올 확률은
  // 1000분의 1 미만(0.87^100 ≈ 8.5e-7)이라 사실상 무시 가능한 수준.
  const TRIALS = 100;
  const players = await Promise.all(Array.from({ length: TRIALS }, () => createTestPlayer(14, "SSR_01")));
  try {
    const outcomes = await Promise.all(players.map(p => enhanceUntilTerminal(p.cardId, p.cookie)));

    const successCount = outcomes.filter(o => o === "success").length;
    const destroyedCount = outcomes.filter(o => o === "destroyed").length;
    assert.equal(successCount + destroyedCount, TRIALS);
    assert.ok(successCount > 0, "100번 시도 중 성공이 한 번도 안 나옴 — 확률표/구현을 다시 확인해야 함");
    assert.ok(destroyedCount > 0, "100번 시도 중 파괴가 한 번도 안 나옴 — 확률표/구현을 다시 확인해야 함");
  } finally {
    await Promise.all(players.map(p => deleteTestPlayer(p.playerId)));
  }
});
