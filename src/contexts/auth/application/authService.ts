import { randomUUID } from "node:crypto";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { Card } from "../../player/domain/card.js";
import { Economy } from "../../player/domain/economy.js";
import { Inventory } from "../../player/domain/inventory.js";
import { Player } from "../../player/domain/player.js";
import type { PlayerRepository } from "../../player/domain/playerRepository.js";
import { verifyGoogleIdToken } from "../infrastructure/googleAuth.js";
import type { SocialAuthProvider } from "../infrastructure/socialAuthProvider.js";
import { createSession } from "../infrastructure/sessionStore.js";
import { writeAuditLog } from "../../../shared-kernel/auditLog.js";

/** 신규 플레이어에게 지급하는 초기 골드. */
const INITIAL_GOLD = 1000;

/** 최저 등급(GAME_DESIGN.md 1절 등급 순서 N < R < SR < SSR 중 최하위) — 신규 가입 시 이 등급에서 카드 1장을 랜덤으로 뽑아 지급한다. */
const STARTER_CARD_GRADE = "N";

/**
 * 신규 가입 시 지급할 시작 카드를 최저 등급 원형 중에서 균등 확률로 하나 뽑는다(등급 내
 * 드랍 가중치를 따로 두는 스테이지 카드 드랍과 달리, 시작 카드는 원형 종류만 다를 뿐
 * 전부 같은 등급이라 가중치를 둘 이유가 없다).
 * @throws {BusinessException} 최저 등급 원형이 시드되어 있지 않으면 AUTH.INTERNAL_ERROR(마스터 데이터 누락)
 */
function pickStarterCard(): Card {
  const templates = masterDataCache.getCardTemplatesByGrade(STARTER_CARD_GRADE);
  if (templates.length === 0) throw new BusinessException(ERROR_MAP.AUTH.INTERNAL_ERROR, { grade: STARTER_CARD_GRADE });
  const template = templates[Math.floor(Math.random() * templates.length)];
  return new Card(randomUUID(), template.templateId);
}

/**
 * 검증된 소셜 프로필로 로그인하고, 처음 로그인하는 사용자면 신규 Player를 생성한다. `playerId`는
 * 프로바이더 값(`sub` 등)과 무관한 내부 식별자(`randomUUID()`)로 새로 발급한다 — 나중에 구글 외
 * 다른 로그인 수단이 추가되거나, 여러 수단을 한 플레이어에 연결하는 기능이 생겨도 `playerId` 체계를
 * 안 건드리기 위함. 어느 플로우든 프로바이더 프로필 검증까지 끝낸 뒤 이 함수로 합류한다.
 * @param platformType 로그인 수단 식별자(예: "google", "facebook")
 * @param profile 검증된 소셜 프로필 — 프로바이더마다 원본 필드명은 달라도(구글 `sub`/페이스북 `id`
 *   등) 각 infrastructure 모듈이 이 공통 형태로 미리 변환해 넘긴다(별도 공유 타입 없이 구조적
 *   타이핑으로 충분해 새 타입을 만들지 않음)
 * @param playerRepository Player 영속성 포트
 * @returns 발급된 세션 토큰
 */
async function loginOrRegister(
  platformType: string,
  profile: { sub: string; name?: string; email?: string; picture?: string },
  playerRepository: PlayerRepository,
): Promise<string> {
  const { sub: platformUserId, name, email, picture } = profile;

  const existing = await playerRepository.findByPlatform(platformType, platformUserId);
  if (existing) {
    await writeAuditLog("log_auth", { actorId: existing.playerId, action: "login", changes: { platformType } });
    return createSession(existing.playerId);
  }

  const starterCard = pickStarterCard();
  const player = new Player(
    randomUUID(),
    0,
    platformType,
    platformUserId,
    name ?? "",
    email ?? "",
    picture,
    new Inventory([starterCard]),
    new Economy(INITIAL_GOLD),
  );
  await playerRepository.create(player);

  // create()가 동시 최초 로그인 레이스로 조용히 무시됐을 수 있다 — 이 경우 위에서 만든 player.playerId는
  // 실제로 저장되지 않았으므로, 실제 저장된(먼저 이긴 쪽의) playerId를 다시 조회해 세션을 발급해야 한다.
  const persisted = await playerRepository.findByPlatform(platformType, platformUserId);
  // 이 요청이 실제로 생성에 성공했는지(playerId가 자신의 것인지)로 register/login을 구분한다 —
  // 레이스에서 졌다면(다른 요청이 먼저 만들었다면) 자신이 만든 starterCard/골드는 실제로 저장된
  // 적이 없으므로, 그 값으로 "register" 로그를 남기면 사실과 다른 내용이 된다.
  const won = persisted!.playerId === player.playerId;
  await writeAuditLog(
    "log_auth",
    won
      ? {
          actorId: persisted!.playerId,
          action: "register",
          changes: { platformType, starterCardTemplateId: starterCard.templateId, initialGold: INITIAL_GOLD },
        }
      : { actorId: persisted!.playerId, action: "login", changes: { platformType } },
  );
  return createSession(persisted!.playerId);
}

/**
 * Google Identity Services 방식 로그인 — 프론트가 이미 발급받은 ID 토큰을 검증해 로그인/가입한다.
 * @param idToken 프론트에서 받은 구글 ID 토큰(credential)
 * @param playerRepository Player 영속성 포트
 * @returns 발급된 세션 토큰
 * @author trisakion
 */
export async function loginWithGoogleIdToken(idToken: string, playerRepository: PlayerRepository): Promise<string> {
  const profile = await verifyGoogleIdToken(idToken);
  return loginOrRegister("google", profile, playerRepository);
}

/**
 * Authorization Code Flow 방식 로그인 — `SocialAuthProvider` 구현체 하나로 구글/페이스북(향후
 * 다른 프로바이더 포함) 전부를 처리한다. 프로바이더별 분기가 없어 새 프로바이더 추가 시 이
 * 함수는 건드릴 필요가 없다.
 * @param provider 콜백을 받은 프로바이더(구글 authorization_code, 페이스북 등)
 * @param code 콜백 쿼리로 받은 authorization code
 * @param playerRepository Player 영속성 포트
 * @returns 발급된 세션 토큰
 * @author trisakion
 */
export async function loginWithSocialProvider(provider: SocialAuthProvider, code: string, playerRepository: PlayerRepository): Promise<string> {
  const profile = await provider.exchangeAuthCode(code);
  return loginOrRegister(provider.platformType, profile, playerRepository);
}
