import type { Player } from "./player.js";

/**
 * `Player` 애그리게잇의 영속성 포트. 구현체(Mongo)는 인프라 레이어에 둔다.
 * @author trisakion
 */
export interface PlayerRepository {
  /**
   * @param playerId 조회할 플레이어 ID
   * @returns 해당 플레이어, 없으면 null
   */
  findById(playerId: string): Promise<Player | null>;

  /**
   * `player.version`과 DB의 현재 버전이 일치할 때만 갱신한다(조건부 업데이트).
   * @param player 저장할 플레이어(이 인스턴스의 version이 기대 버전으로 쓰인다)
   * @throws {BusinessException} 버전이 어긋나면(동시 수정 충돌) COMMON.CONFLICT — 호출부가 재조회 후 재시도한다.
   */
  save(player: Player): Promise<void>;
}
