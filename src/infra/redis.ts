import { createClient } from "redis";
import { config } from "../config/env.js";

/**
 * 세션/인증 토큰 관리, 분산 락(강화/합성 연타 시 낙관적 락 재시도 폭주 방지) 등에 쓰는 Redis 클라이언트.
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 */
export const redisClient = createClient({ url: config.redisUrl, password: config.redisPassword });

/**
 * Redis에 연결하고 클라이언트를 반환한다.
 * @returns 연결된 Redis 클라이언트
 */
export async function connectRedis() {
  await redisClient.connect();
  return redisClient;
}
