import { MongoClient } from "mongodb";
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
