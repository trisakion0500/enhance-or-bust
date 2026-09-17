import type { Db } from "mongodb";
import { BusinessException } from "../../../shared-kernel/businessException.js";
import { config } from "../../../config/env.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { masterDataCache } from "../../../shared-kernel/masterData/masterDataCache.js";
import { processLoginAttendance } from "../../attendance/application/attendanceService.js";
import type { AttendanceLoginResult } from "../../attendance/application/attendanceService.js";
import type { MailboxRepository } from "../../mailbox/domain/mailboxRepository.js";
import type { SynthesisRule } from "../../synthesis/domain/synthesisRule.js";
import type { PlayerRepository } from "../domain/playerRepository.js";

/**
 * 인벤토리 카드 한 장을 카드 원형(마스터 데이터)과 조인한 요약. 프론트가 별도로 마스터
 * 데이터를 조회하지 않아도 되도록 서버가 미리 조인해 내려준다.
 * @author trisakion
 */
export interface CardSummary {
  /** 카드 인스턴스 고유 ID */
  cardId: string;
  /** 원형(CardTemplate) 참조 ID */
  templateId: string;
  /** 카드 등급(마스터 데이터에서 조인) */
  grade: string;
  /** 기본 공격력(마스터 데이터에서 조인, 레벨/강화 성장 미반영) */
  baseAttack: number;
  /** 기본 체력(마스터 데이터에서 조인, 레벨/강화 성장 미반영) */
  baseHp: number;
  /** 원소 속성(마스터 데이터에서 조인) */
  element: string;
  /** 현재 레벨 */
  level: number;
  /** 현재 레벨에서 누적된 EXP */
  exp: number;
  /** 강화 단계(+0~15) */
  enhancementLevel: number;
}

/**
 * 플레이어 자기 자신의 상태 요약 — `GET /player/me` 응답 셰이프.
 * @author trisakion
 */
export interface PlayerSummary {
  /** 닉네임 */
  name: string;
  /** 프로필 사진 URL — 구글 프로필에 없으면 undefined */
  picture: string | undefined;
  /** 보유 재화 */
  economy: { gold: number; enhancementStone: number; diamond: number };
  /** 클리어한 최대 스테이지 */
  clearedStage: number;
  /** 보유 카드 목록(마스터 데이터 조인 포함) */
  inventory: CardSummary[];
  /** 전투 출전 스쿼드 최대 장수 — 프론트가 별도 설정 조회 없이 이 값으로 UI를 제한한다 */
  squadMaxSize: number;
  /** 합성 규칙 전체(마스터 데이터) — 프론트가 합성 화면의 소재 장수/확률/비용 안내에 그대로 쓴다 */
  synthesisRules: readonly SynthesisRule[];
  /** 이번 조회에서 처리된 출석보상 결과 — 프론트가 이 필드로 토스트/신규출석부 안내를 띄운다 */
  attendanceNotice: AttendanceLoginResult;
}

/**
 * 로그인한 플레이어 자신의 상태(재화/clearedStage/보유 카드)를 조회한다. 인벤토리 각 카드는
 * `masterDataCache`의 카드 원형과 조인해 등급/공격력/체력/속성까지 포함시킨다 — 프론트가
 * 별도 마스터 데이터 엔드포인트 없이 이 응답 하나로 인벤토리 화면을 그릴 수 있게 하기 위함.
 * 조회에 앞서 `processLoginAttendance()`를 먼저 호출한다 — 이 엔드포인트가 곧 "로그인/새로고침
 * 시 진입점"이라 출석 처리와 상태 조회를 별도 API로 나누지 않고 여기서 함께 처리한다
 * (23_GAME_DESIGN_ATTENDANCE.md "로그인 시 처리 흐름" 절).
 * @param playerId 조회할 플레이어(세션에서 이미 검증된 값)
 * @param playerRepository Player 영속성 포트
 * @param db 메인 앱 DB 핸들(출석 인스턴스 조회/갱신용)
 * @param mailboxRepository Mailbox 영속성 포트(출석 보상 발송용)
 * @returns 플레이어 상태 요약
 * @throws {BusinessException} 세션은 유효한데 플레이어 문서가 없는 이례적 상황이면 COMMON.NOT_FOUND
 * @author trisakion
 * @modified 2026-09-17 trisakion 출석보상 로그인 처리(processLoginAttendance) 연동, db/mailboxRepository 파라미터와 attendanceNotice 응답 필드 추가
 */
export async function getPlayerSummary(
  playerId: string,
  playerRepository: PlayerRepository,
  db: Db,
  mailboxRepository: MailboxRepository,
): Promise<PlayerSummary> {
  const attendanceNotice = await processLoginAttendance(playerId, db, mailboxRepository);

  const player = await playerRepository.findById(playerId);
  if (!player) throw new BusinessException(ERROR_MAP.COMMON.NOT_FOUND, { playerId });

  const inventory = player.inventory.getCards().map(card => {
    const template = masterDataCache.getCardTemplate(card.templateId);
    if (!template) throw new BusinessException(ERROR_MAP.COMMON.INTERNAL_ERROR, { templateId: card.templateId });
    return {
      cardId: card.cardId,
      templateId: card.templateId,
      grade: template.grade,
      baseAttack: template.baseAttack,
      baseHp: template.baseHp,
      element: template.element,
      level: card.level,
      exp: card.exp,
      enhancementLevel: card.enhancementLevel,
    };
  });

  return {
    name: player.name,
    picture: player.picture,
    economy: { gold: player.economy.gold, enhancementStone: player.economy.enhancementStone, diamond: player.economy.diamond },
    clearedStage: player.clearedStage,
    inventory,
    squadMaxSize: config.squadMaxSize,
    synthesisRules: masterDataCache.getSynthesisRules(),
    attendanceNotice,
  };
}
