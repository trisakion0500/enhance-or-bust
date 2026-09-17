import { randomUUID } from "node:crypto";
import { config } from "../../../config/env.js";
import { redisClient } from "../../../infra/redis.js";
import { redisPlayerSessionKey, redisSessionKey } from "../../../shared-kernel/redisKeys.js";

/**
 * 세션 토큰을 발급해 Redis에 `playerId`와 함께 TTL로 저장한다(CLAUDE.md에 확정된 "세션/인증
 * 토큰 관리" Redis 용도). 토큰 자체는 서버만 아는 랜덤값이라(JWT처럼 자체 서명된 데이터가 아님)
 * Redis에서 지우면 즉시 무효화할 수 있다. 같은 플레이어의 이전 세션이 있으면 먼저 무효화해
 * 1계정 1세션만 유지한다(중복 로그인 방지).
 * @param playerId 세션을 소유할 플레이어 ID
 * @returns 발급된 세션 토큰
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 */
export async function createSession(playerId: string): Promise<string> {
  const oldToken = await redisClient.get(redisPlayerSessionKey(playerId));
  if (oldToken)
    await redisClient.del(redisSessionKey(oldToken));

  const token = randomUUID();
  await redisClient.set(redisSessionKey(token), playerId, { EX: config.sessionTtlSec });
  await redisClient.set(redisPlayerSessionKey(playerId), token, { EX: config.sessionTtlSec });
  return token;
}

/**
 * 세션 토큰으로 playerId를 조회한다.
 * @param token 세션 토큰
 * @returns 해당 세션의 playerId, 없거나 만료됐으면 undefined
 * @author trisakion
 */
export async function resolveSession(token: string): Promise<string | undefined> {
  const playerId = await redisClient.get(redisSessionKey(token));
  return playerId ?? undefined;
}

/**
 * 세션 토큰을 무효화한다(로그아웃). 존재하지 않는 토큰이어도 그냥 무해하게 넘어간다(멱등).
 * 역방향 매핑(`redisPlayerSessionKey`)도 함께 지워 다음 로그인 시 존재하지 않는 이전 토큰을
 * 삭제 시도하는 불필요한 조회가 남지 않게 한다.
 * @param token 세션 토큰
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 */
export async function deleteSession(token: string): Promise<void> {
  const playerId = await redisClient.get(redisSessionKey(token));
  await redisClient.del(redisSessionKey(token));
  if (playerId)
    await redisClient.del(redisPlayerSessionKey(playerId));
}
