import { createClient } from "redis";
import { config } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * 연결이 끊긴 뒤 "다운"으로 판정하기까지 버티는 시간 겸, 명령 하나가 끝나길 기다리는 상한
 * — 이 안에 복구되면(네트워크 순단 등) 그동안 큐에 쌓여있던 명령이 그대로 이어서 처리되고,
 * 못 넘기면(VM 재부팅처럼 오래 걸리는 다운) `redisCall()`로 감싼 명령들이 이 시점에 타임아웃
 * 처리된다. 재연결 시도 자체는 이 시한과 무관하게 계속된다(아래 reconnectStrategy 참고) —
 * 그래야 복구됐을 때 사람 개입 없이 다시 열린다.
 */
const RECONNECT_GIVE_UP_MS = 12000;

/** 재연결 재시도가 시작된 시각(연결이 끊긴 기준점) — `ready` 이벤트에서 리셋한다. */
let disconnectedAt: number | null = null;

/**
 * 다운으로 판정되면(연결 끊김이 RECONNECT_GIVE_UP_MS를 넘기면) false, `ready`로 복구를
 * 확인하면 true로 자동 복원된다 — `dbHealthGate` 미들웨어가 이 값을 보고 다운 중엔 요청을
 * 라우트까지 보내지 않고 즉시 거부한다(circuit breaker). 재연결 자체는 계속 시도되므로
 * 복구되면 이 값도 사람 개입 없이 다시 true로 돌아온다.
 */
let redisHealthy = true;

/**
 * 지금 Redis 명령을 즉시 처리할 수 있는 상태인지.
 * @returns 다운으로 판정된 상태가 아니면 true
 * @author trisakion
 */
export function isRedisHealthy(): boolean {
  return redisHealthy;
}

/**
 * 세션/인증 토큰 관리, 분산 락(강화/합성 연타 시 낙관적 락 재시도 폭주 방지) 등에 쓰는 Redis 클라이언트.
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 * @modified 2026-09-20 trisakion Redis 다운 시 요청이 무한정 걸려있지 않도록 다운 판정
 *   (redisHealthy) 추가 — reconnectStrategy 자체는 절대 포기하지 않고 계속 재시도해야
 *   복구 시 자동으로 다시 열린다(한 번 포기(Error 반환)하면 node-redis가 재연결을 영구
 *   중단해버려 자동 복구가 안 됨 — 실제로 재현해서 확인함). 명령 단위 타임아웃은
 *   `redisCall()`이 담당한다.
 */
export const redisClient = createClient({
  url: config.redisUrl,
  password: config.redisPassword,
  socket: {
    reconnectStrategy: retries => {
      disconnectedAt ??= Date.now();
      if (Date.now() - disconnectedAt > RECONNECT_GIVE_UP_MS) redisHealthy = false;
      return Math.min(retries * 50, 500);
    },
  },
});
redisClient.on("ready", () => {
  disconnectedAt = null;
  redisHealthy = true;
});
// 재연결 시도가 실패할 때마다(다운 판정 여부와 무관하게) 'error'가 emit된다 — 리스너가
// 하나도 없으면 Node EventEmitter가 이걸 uncaught exception으로 던져 프로세스가 죽는다.
// 로그만 남기고 삼킨다(각 호출부는 어차피 자기 명령의 rejected promise로 실패를 안다).
redisClient.on("error", err => {
  logger.error("Redis client error", err);
});

/**
 * Redis 명령이 다운 판정 시한(RECONNECT_GIVE_UP_MS) 안에 끝나지 않으면 타임아웃시킨다.
 * node-redis는 연결이 끊긴 동안 들어온 명령을 기본적으로 큐에 쌓아 재연결까지 무기한
 * 기다리게 하는데(짧은 순단은 버티게 해주는 유용한 동작이지만 장기 다운에선 요청이 영원히
 * 걸려있게 만든다), 이 래퍼로 그 대기 시간에 상한을 둔다. Redis를 호출하는 모든 지점
 * (`sessionStore.ts`/`pendingRegistrationStore.ts`/`redisLock.ts`)이 재사용한다.
 * @param promise 감쌀 redisClient 명령 Promise
 * @returns 원래 명령의 결과, 시한을 넘기면 reject
 * @author trisakion
 */
export function redisCall<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Redis command timed out")), RECONNECT_GIVE_UP_MS);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * 부팅 단계 최초 연결 시도의 포기 시한 — 운영 중 재연결(`reconnectStrategy`, 절대 포기 안 함)과는
 * 별개 개념이다. `reconnectStrategy`가 초기 연결에도 그대로 적용되기 때문에(재연결 시도마다
 * 항상 backoff 숫자만 반환하고 `Error`를 반환하는 법이 없어서), 이 시한이 없으면 Redis가 애초에
 * 연결 안 되는 상황(잘못된 REDIS_URL, Redis 미기동 등)에서 `connectRedis()`가 영원히 resolve도
 * reject도 안 된다(실사용 중 재현 확인). 부팅 시점은 관리자가 화면을 보고 있어, 늦게라도 자동
 * 복구되길 기다리기보다 바로 실패를 알리고 멈추는 쪽이 낫다(CLAUDE.md 확정) — 그래서
 * `connectRedis()`는 이 시한을 넘기면 던진다. 실제 "구동 시 실패하면 즉시 종료" 처리(`process.exit`)는
 * 이 함수가 아니라 호출부(`index.ts`)의 책임이다 — e2e 테스트도 이 함수를 그대로 호출하는데,
 * 거기서까지 프로세스를 죽이면 안 되기 때문(node:test가 `before` 훅 실패로 깔끔하게 보고해야 함).
 */
const BOOT_CONNECT_TIMEOUT_MS = 12000;

/**
 * Redis에 연결하고 클라이언트를 반환한다. 최초 연결이 `BOOT_CONNECT_TIMEOUT_MS` 안에 안 되면
 * 던진다(위 JSDoc 참고) — 이후의 재연결(운영 중 다운)은 이 시한과 무관하게 `reconnectStrategy`가
 * 계속 시도한다.
 * @returns 연결된 Redis 클라이언트
 * @throws {Error} 최초 연결이 시한 안에 성공하지 못하면
 * @author trisakion
 * @modified 2026-09-29 trisakion 부팅 단계 연결 시한 추가 — 이전엔 잘못된 REDIS_URL 등으로
 *   최초 연결 자체가 안 되면 이 함수가 무기한 대기했다(reconnectStrategy가 초기 연결에도
 *   적용돼 절대 포기하지 않아서)
 */
export async function connectRedis() {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Redis 최초 연결 시간 초과(${BOOT_CONNECT_TIMEOUT_MS}ms) — REDIS_URL 등 설정을 확인하세요.`)), BOOT_CONNECT_TIMEOUT_MS),
  );
  await Promise.race([redisClient.connect(), timeout]);
  return redisClient;
}
