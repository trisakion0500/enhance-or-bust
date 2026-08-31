import type { Economy } from "./economy.js";
import type { Inventory } from "./inventory.js";

/**
 * 플레이어 애그리게잇 루트. Inventory/Progression(카드별 level·exp)/Economy/Battle-Stage
 * 4개 컨텍스트가 하나의 문서에서 낙관적 락으로 원자적으로 바뀌므로, DDD 애그리게잇 경계(=원자성
 * 경계) 기준으로 이 넷은 이미 하나의 애그리게잇이다 — 그래서 Repository도 컨텍스트별로 쪼개지
 * 않고 `PlayerRepository` 하나로 둔다. 상세는 CLAUDE.md의 바운디드 컨텍스트 절 참고.
 * @author trisakion
 */
export class Player {
  /**
   * @param playerId 플레이어 ID
   * @param version 낙관적 락 버전 — 이 인스턴스를 읽어온 시점의 버전. save() 시 이 값과 DB의 현재 버전이 일치할 때만 갱신된다.
   * @param inventory 보유 카드 목록
   * @param economy 보유 재화
   * @param clearedStage 클리어한 최대 스테이지(기본 0)
   */
  constructor(
    public readonly playerId: string,
    public readonly version: number,
    public readonly inventory: Inventory,
    public readonly economy: Economy,
    public clearedStage: number = 0,
  ) {}
}
