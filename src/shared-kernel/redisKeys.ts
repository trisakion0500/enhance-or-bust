import { config } from "../config/env.js";

/**
 * 세션 토큰을 저장하는 Redis 키를 만든다.
 * @param token 세션 토큰
 * @returns Redis 키
 * @author trisakion
 */
export function redisSessionKey(token: string): string {
  return `${config.redisKeyPrefix}session:${token}`;
}

/**
 * 플레이어 단위 분산 락 Redis 키를 만든다.
 * @param playerId 락을 걸 플레이어 ID
 * @returns Redis 키
 * @author trisakion
 */
export function redisLockKey(playerId: string): string {
  return `${config.redisKeyPrefix}lock:player:${playerId}`;
}
