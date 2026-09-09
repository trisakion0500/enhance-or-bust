import { BusinessException } from "./businessException.js";
import { ERROR_MAP } from "./errorMap.js";
import { withPlayerLock } from "./redisLock.js";
import type { Player } from "../contexts/player/domain/player.js";
import type { PlayerRepository } from "../contexts/player/domain/playerRepository.js";

/** 낙관적 락 충돌 시 재조회 후 재시도할 최대 횟수(강화/합성/전투-스테이지 API 공통 정책). */
const MAX_OPTIMISTIC_LOCK_RETRIES = 5;

/** {@link withOptimisticRetry}의 선택적 훅. */
export interface OptimisticRetryHooks<T> {
  /** `save()` 성공 직후에만 실행할 부수효과(예: 우편 발송) — 재시도 전체에서 한 번만 호출된다. */
  onSaved?: (result: T) => Promise<void>;
  /**
   * `apply`가 실제로 `player`를 바꿨는지 판단한다 — false면 `save()`(및 `onSaved`)를 건너뛰고
   * 그 자리에서 바로 반환한다(예: 전투 패배처럼 상태 변경이 없는 경우 불필요한 쓰기를 피함).
   * 생략 시 항상 저장한다.
   */
  shouldSave?: (result: T) => boolean;
}

/**
 * Player 애그리게잇에 쓰기를 시도하는 Use-case 공통 패턴(재조회 → 메모리에서 변경 → 낙관적 락
 * 저장 → 충돌 시 재시도)을 한 곳에 모은다 — 강화/합성/전투-스테이지 세 컨텍스트가 거의 동일한
 * 루프를 각자 갖고 있던 것을 통합했다. Redis 짧은 TTL 락(`withPlayerLock`)으로 전체를 감싸
 * 같은 플레이어의 동시 요청이 서로 낙관적 락 충돌·재시도를 반복하며 재조회 폭주를 일으키는
 * 것을 막는다.
 * @param playerId 쓰기 대상 플레이어
 * @param playerRepository Player 영속성 포트
 * @param apply `player`를 제자리에서 변경하고 응답으로 돌려줄 결과를 반환하는 순수 로직
 * @param hooks 선택적 훅({@link OptimisticRetryHooks}) — 필요 없으면 생략
 * @returns `apply`가 반환한 결과
 * @throws {BusinessException} `playerId`를 찾지 못하면 COMMON.NOT_FOUND, 재시도를 모두
 *   소진하면 COMMON.CONFLICT, Redis 락을 못 잡으면 COMMON.LOCKED
 * @author trisakion
 */
export async function withOptimisticRetry<T>(
  playerId: string,
  playerRepository: PlayerRepository,
  apply: (player: Player) => T,
  hooks: OptimisticRetryHooks<T> = {},
): Promise<T> {
  const { onSaved, shouldSave } = hooks;

  return withPlayerLock(playerId, async () => {
    for (let attempt = 0; attempt < MAX_OPTIMISTIC_LOCK_RETRIES; attempt++) {
      const player = await playerRepository.findById(playerId);
      if (!player) throw new BusinessException(ERROR_MAP.COMMON.NOT_FOUND, { playerId });

      const result = apply(player);
      if (shouldSave && !shouldSave(result)) return result;

      try {
        await playerRepository.save(player);
        if (onSaved) await onSaved(result);
        return result;
      } catch (err) {
        if (!(err instanceof BusinessException) || err.entry !== ERROR_MAP.COMMON.CONFLICT) throw err;
      }
    }

    throw new BusinessException(ERROR_MAP.COMMON.CONFLICT, { playerId });
  });
}
