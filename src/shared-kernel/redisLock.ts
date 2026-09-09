import { randomUUID } from "node:crypto";
import { redisClient } from "../infra/redis.js";
import { BusinessException } from "./businessException.js";
import { ERROR_MAP } from "./errorMap.js";
import { redisLockKey } from "./redisKeys.js";

/** 락 유지 시간 — 락 안에서 도는 낙관적 재시도 루프(최대 5회) 전체를 여유 있게 커버한다. */
const LOCK_TTL_MS = 5000;

/** 락 획득 재시도 횟수 — 짧게 몇 번만 시도하고 포기한다(부하 감소/연타 방지가 목적이라 오래 기다릴 이유가 없음). */
const ACQUIRE_RETRIES = 3;

/** 락 획득 재시도 간격(ms). */
const ACQUIRE_INTERVAL_MS = 50;

/** 락을 쥔 토큰이 일치할 때만 삭제 — TTL 만료 후 다른 요청이 잡은 락을 잘못 지우는 것을 방지한다. */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 같은 플레이어의 쓰기 요청을 Redis 짧은 TTL 락으로 직렬화한다(CLAUDE.md "Redis 용도" —
 * 강화/합성 연타로 인한 낙관적 락 재시도 폭주 방지). 정합성은 이미 Player 애그리게잇의
 * `version` 낙관적 락이 보장하므로, 이 락은 순수 성능/부하 최적화다 — 그래서 획득 실패
 * 시(부하 감소 + 실수 연타 방지 목적) 대기하지 않고 즉시 거부(fail-fast)한다. Redis 자체
 * 오류도 "획득 실패"와 동일하게 취급해 일관되게 거부한다.
 * @param playerId 락을 걸 플레이어(락 키 단위 — Player 애그리게잇 문서 경계와 동일)
 * @param fn 락을 쥔 상태에서 실행할 작업
 * @returns `fn`의 반환값
 * @throws {BusinessException} 짧은 재시도 안에 락을 못 잡으면 COMMON.LOCKED(429)
 * @author trisakion
 */
export async function withPlayerLock<T>(playerId: string, fn: () => Promise<T>): Promise<T> {
  const key = redisLockKey(playerId);
  const token = randomUUID();
  let acquired = false;

  try {
    for (let i = 0; i < ACQUIRE_RETRIES && !acquired; i++) {
      acquired = (await redisClient.set(key, token, { NX: true, PX: LOCK_TTL_MS })) === "OK";
      if (!acquired) await sleep(ACQUIRE_INTERVAL_MS);
    }
  } catch {
    acquired = false;
  }

  if (!acquired) throw new BusinessException(ERROR_MAP.COMMON.LOCKED, { playerId });

  try {
    return await fn();
  } finally {
    // 해제 실패는 무해하게 무시 — 최악의 경우 TTL(5초) 만료로 자연히 풀린다.
    await redisClient.eval(RELEASE_SCRIPT, { keys: [key], arguments: [token] }).catch(() => {});
  }
}
