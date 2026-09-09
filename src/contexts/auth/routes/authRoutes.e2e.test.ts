import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Economy } from "../../player/domain/economy.js";
import { Inventory } from "../../player/domain/inventory.js";
import { Player } from "../../player/domain/player.js";
import { connectMongo, mongoClient } from "../../../infra/mongo.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { MongoPlayerRepository } from "../../player/infrastructure/mongoPlayerRepository.js";
import { MongoMailboxRepository } from "../../mailbox/infrastructure/mongoMailboxRepository.js";
import { connectRedis, redisClient } from "../../../infra/redis.js";
import { createSession, resolveSession } from "../infrastructure/sessionStore.js";
import { createServer } from "../../../server.js";

/**
 * 인증 라우터 E2E 테스트(로그아웃만 대상 — 구글 로그인은 실제 구글 서버 연동이 필요해 이
 * 테스트 전략(mock 없음)으로는 검증 불가하므로 범위 밖). 실제 Mongo/Redis에 붙어
 * `createServer()`가 만드는 앱을 임시 포트로 띄운 뒤 `fetch`로 호출한다.
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

test("로그아웃하면 세션이 Redis에서 지워지고 쿠키도 함께 삭제된다", async () => {
  const playerId = randomUUID();
  const player = new Player(playerId, 0, "test", `test-${playerId}`, "테스트유저", "test@example.com", undefined, new Inventory([]), new Economy(0, 0, 0));
  await playerRepository.create(player);
  const token = await createSession(playerId);
  try {
    const res = await fetch(`${baseUrl}/auth/logout`, { method: "POST", headers: { Cookie: `sessionToken=${token}` } });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.deepEqual(body, { result: 0 });
    assert.equal(await resolveSession(token), undefined);
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /sessionToken=;/, `쿠키 삭제 지시가 없음: ${setCookie}`);
  } finally {
    await mongoClient.db(process.env.MONGO_APP_DATABASE).collection<{ _id: string }>("players").deleteOne({ _id: playerId });
  }
});

test("세션 쿠키 없이 로그아웃을 호출해도 에러 없이 성공한다(멱등)", async () => {
  const res = await fetch(`${baseUrl}/auth/logout`, { method: "POST" });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(body, { result: 0 });
});
