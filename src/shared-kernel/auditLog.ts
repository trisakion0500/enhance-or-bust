import { mongoLogClient } from "../infra/mongoLog.js";
import { config } from "../config/env.js";
import { logger } from "../infra/logger.js";

/** 배치/크론처럼 사람이 아닌 시스템이 직접 남기는 감사 로그의 actorId sentinel. */
export const SYSTEM_ACTOR = "SYSTEM";

/** 감사 로그 한 건 — 언제(occurredAt)/누가(actorId)/무엇을(action)/어떤 내용이 바뀌었는지(changes). */
interface AuditLogEntry {
  /** 행위자 playerId, 또는 배치/크론이면 {@link SYSTEM_ACTOR} */
  actorId: string;
  /** 컬렉션 안에서의 세부 동작 이름(예: "attempt", "login") */
  action: string;
  /** 추가/수정/삭제된 내용 — 액션마다 형식이 달라 자유 형식으로 둔다 */
  changes: Record<string, unknown>;
}

/**
 * 감사 로그를 물리적으로 분리된 로그 DB(`enhance_or_bust_log`)의 컨텐츠(도메인)별 컬렉션에
 * 남긴다(CLAUDE.md "감사 로그 / DAU 정책" 절 — 컬렉션은 auth_logs/enhancement_logs/
 * synthesis_logs/battle_stage_logs/mailbox_logs로 분리, 마스터데이터 로딩 전략의 "컨텐츠별
 * 별도 컬렉션" 원칙과 동일). 메인 쓰기가 성공한 뒤에만 호출해야 하며, 이 함수 자체의 실패는
 * 메인 흐름에 영향을 주지 않도록 여기서 끝까지 삼킨다(개발 컨벤션 7장 — 로그 DB는 메인
 * 트랜잭션과 절대 묶이지 않고, 로그 실패가 핵심 기능을 막으면 안 됨).
 * @param collection 남길 도메인별 로그 컬렉션 이름
 * @param entry 남길 감사 로그 내용
 * @author trisakion
 */
export async function writeAuditLog(collection: string, entry: AuditLogEntry): Promise<void> {
  try {
    await mongoLogClient
      .db(config.mongoAppDatabaseLog)
      .collection(collection)
      .insertOne({ ...entry, occurredAt: new Date() });
  } catch (err) {
    logger.error(`감사 로그 기록 실패: ${collection}.${entry.action}`, err);
  }
}
