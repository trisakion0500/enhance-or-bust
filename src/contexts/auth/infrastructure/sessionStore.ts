import { randomUUID } from "node:crypto";
import { config } from "../../../config/env.js";
import { redisClient } from "../../../infra/redis.js";

const SESSION_KEY_PREFIX = config.redisKeyPrefix + "session:";

/**
 * 세션 토큰을 발급해 Redis에 `playerId`와 함께 TTL로 저장한다(CLAUDE.md에 확정된 "세션/인증
 * 토큰 관리" Redis 용도). 토큰 자체는 서버만 아는 랜덤값이라(JWT처럼 자체 서명된 데이터가 아님)
 * Redis에서 지우면 즉시 무효화할 수 있다.
 * @param playerId 세션을 소유할 플레이어 ID
 * @returns 발급된 세션 토큰
 * @author trisakion
 */
export async function createSession(playerId: string): Promise<string> {
  const token = randomUUID();
  await redisClient.set(SESSION_KEY_PREFIX + token, playerId, { EX: config.sessionTtlSec });
  return token;
}

/**
 * 세션 토큰으로 playerId를 조회한다.
 * @param token 세션 토큰
 * @returns 해당 세션의 playerId, 없거나 만료됐으면 undefined
 */
export async function resolveSession(token: string): Promise<string | undefined> {
  const playerId = await redisClient.get(SESSION_KEY_PREFIX + token);
  return playerId ?? undefined;
}
