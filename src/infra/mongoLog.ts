import { MongoClient } from "mongodb";
import type { Db } from "mongodb";
import { config } from "../config/env.js";

/**
 * 게임 이벤트/감사 로그 전용 DB(`enhance_or_bust_log`) 클라이언트. 메인 앱 DB와 물리적으로 분리된 별도
 * 계정/커넥션을 쓴다 — 로그 기록 실패가 메인 트랜잭션에 영향을 주지 않게 하기 위함.
 * @author trisakion
 */
export const mongoLogClient = new MongoClient(config.mongoUri, {
  auth: { username: config.mongoAppUsernameLog, password: config.mongoAppPasswordLog },
  authSource: config.mongoAppDatabaseLog,
});

/**
 * 로그 DB에 연결하고 DB 핸들을 반환한다.
 * @returns 연결된 `enhance_or_bust_log` DB 핸들
 */
export async function connectMongoLog() {
  await mongoLogClient.connect();
  return mongoLogClient.db(config.mongoAppDatabaseLog);
}

/**
 * 로그 DB 컬렉션의 인덱스를 보장한다(`playerRepository.ensureIndexes()`와 동일 패턴, 서버
 * 기동 시 1회 호출). 감사 로그 컬렉션이 하나씩 추가될 때마다 여기에도 함께 추가한다 —
 * 지금은 `auth_logs`만 구현됨(CLAUDE.md "감사 로그 / DAU 정책" 절 참고).
 * @param logDb 연결된 로그 DB 핸들
 * @author trisakion
 */
export async function ensureLogIndexes(logDb: Db): Promise<void> {
  await logDb.collection("auth_logs").createIndex({ actorId: 1, occurredAt: -1 });
  await logDb.collection("enhancement_logs").createIndex({ actorId: 1, occurredAt: -1 });
  await logDb.collection("synthesis_logs").createIndex({ actorId: 1, occurredAt: -1 });
  await logDb.collection("battle_stage_logs").createIndex({ actorId: 1, occurredAt: -1 });
  // 스테이지 승률/카드 조합 통계용(감사 로그 아님) — 승패 무관 매 시도 기록.
  await logDb.collection("battle_stage_attempts").createIndex({ actorId: 1, occurredAt: -1 });
  // DAU 집계용 — 플레이어당 하루 1건만 남도록 강제(dailyActive.ts의 멱등 삽입이 기대는 제약).
  await logDb.collection("daily_active_players").createIndex({ playerId: 1, date: 1 }, { unique: true });
}
