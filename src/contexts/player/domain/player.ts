import type { Economy } from "./economy.js";
import type { Inventory } from "./inventory.js";

/**
 * 플레이어 애그리게잇 루트. Inventory/Progression(카드별 level·exp)/Economy/Battle-Stage
 * 4개 컨텍스트가 하나의 문서에서 낙관적 락으로 원자적으로 바뀌므로, DDD 애그리게잇 경계(=원자성
 * 경계) 기준으로 이 넷은 이미 하나의 애그리게잇이다 — 그래서 Repository도 컨텍스트별로 쪼개지
 * 않고 `PlayerRepository` 하나로 둔다. 상세는 CLAUDE.md의 바운디드 컨텍스트 절 참고.
 * @author trisakion
 * @modified 2026-09-17 trisakion 출석부 발동 타입 판정용 createdAt/lastLoginAt 필드 추가
 */
export class Player {
  /**
   * @param playerId 플레이어 ID — 로그인 수단(구글 sub 등)과 무관한 내부 전용 식별자(`randomUUID()`).
   *   여러 소셜 로그인 수단을 한 플레이어에 연결하는 확장을 대비해, 외부 프로바이더 값을 그대로
   *   쓰지 않고 분리했다. 실제 프로바이더 식별은 `platformType`/`platformUserId`가 담당한다.
   * @param version 낙관적 락 버전 — 이 인스턴스를 읽어온 시점의 버전. save() 시 이 값과 DB의 현재 버전이 일치할 때만 갱신된다.
   * @param platformType 로그인 수단 식별자(예: "google"). 현재는 구글 하나뿐이지만 필드 자체는 미리 분리해둠.
   * @param platformUserId 해당 플랫폼이 발급한 고유 사용자 ID(구글이면 `sub`). `(platformType, platformUserId)` 조합에 DB 복합 unique 인덱스가 걸려있다.
   * @param name 닉네임 — 최초 가입 시 구글 프로필에서 가져온 값. 이후 게임 내에서 변경될 수 있어 readonly가 아니다.
   * @param email 이메일 — 최초 가입 시 구글 프로필에서 가져온 값(표시용, 구글과 재동기화하지 않음)
   * @param picture 프로필 사진 URL — 최초 가입 시 구글 프로필에서 가져온 값. 이후 게임 내에서 변경될 수 있어 readonly가 아니다.
   * @param inventory 보유 카드 목록
   * @param economy 보유 재화
   * @param clearedStage 클리어한 최대 스테이지(기본 0)
   * @param createdAt 가입일시(`completeRegistration()` 시점 고정, 이후 불변) — 출석부
   *   `targetAudience=NEW_USER` 판정에 쓰인다(23_GAME_DESIGN_ATTENDANCE.md "발동 타입" 절)
   * @param lastLoginAt 마지막 로그인일시 — `GET /player/me` 처리마다 갱신된다. 출석부
   *   `targetAudience=RETURNING_USER` 판정은 이 값이 갱신되기 *전* 시점을 읽어야 하므로,
   *   호출부(`playerService.ts`)가 갱신 순서를 반드시 지킨다
   */
  constructor(
    public readonly playerId: string,
    public readonly version: number,
    public readonly platformType: string,
    public readonly platformUserId: string,
    public name: string,
    public readonly email: string,
    public picture: string | undefined,
    public readonly inventory: Inventory,
    public readonly economy: Economy,
    public clearedStage: number = 0,
    public readonly createdAt: Date = new Date(),
    public lastLoginAt: Date = new Date(),
  ) {}
}
