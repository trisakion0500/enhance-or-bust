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
   * 로그인 시 소셜 프로바이더 식별자로 기존 플레이어를 찾는다. `playerId`는 프로바이더 값과 무관한
   * 내부 식별자라 로그인 시점엔 아직 모르므로, 이 조회가 로그인 흐름의 진입점이 된다.
   * @param platformType 로그인 수단 식별자(예: "google")
   * @param platformUserId 해당 플랫폼이 발급한 고유 사용자 ID
   * @returns 해당 플레이어, 없으면 null
   */
  findByPlatform(platformType: string, platformUserId: string): Promise<Player | null>;

  /**
   * `player.version`과 DB의 현재 버전이 일치할 때만 갱신한다(조건부 업데이트).
   * @param player 저장할 플레이어(이 인스턴스의 version이 기대 버전으로 쓰인다)
   * @throws {BusinessException} 버전이 어긋나면(동시 수정 충돌) COMMON.CONFLICT — 호출부가 재조회 후 재시도한다.
   */
  save(player: Player): Promise<void>;

  /**
   * 신규 플레이어를 최초 삽입한다. 같은 `(platformType, platformUserId)`로 동시에 두 번 호출돼도(예: 최초
   * 로그인 요청 중복) 하나만 실제로 삽입되고 나머지는 조용히 무시된다 — `player.playerId`는 호출자가
   * 미리 임의로 생성한 값이라, 진 쪽은 자신이 넘긴 playerId가 실제로 저장됐다는 보장이 없다. 그래서
   * 호출부는 그 뒤 반드시 `findByPlatform`으로 다시 조회해 실제 저장된 playerId를 확인해야 한다.
   * @param player 삽입할 신규 플레이어(보통 version=0)
   */
  create(player: Player): Promise<void>;

  /**
   * 전체 플레이어를 조회한다 — gm_platform 연동(GM 운영자가 playerId 없이 전체 조회하는 경우)
   * 전용이라, 일반 게임 플레이 경로에서는 쓰지 않는다.
   * @param limit 최대 반환 개수(무제한 전체 스캔 방지)
   * @returns 플레이어 목록(정렬 순서 보장 없음)
   */
  findAll(limit: number): Promise<Player[]>;
}
