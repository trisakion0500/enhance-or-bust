import { MongoClient } from "mongodb";
import { config } from "../config/env.js";

/**
 * 메인 앱 DB(`enhance_or_bust`) 전용 MongoDB 클라이언트. 로그 DB용 클라이언트({@link ../infra/mongoLog.js})와는
 * 계정/DB가 달라 커넥션을 물리적으로 분리한다.
 * @author trisakion
 */
export const mongoClient = new MongoClient(config.mongoUri, {
  auth: { username: config.mongoAppUsername, password: config.mongoAppPassword },
  authSource: config.mongoAppDatabase,
});

/**
 * 메인 앱 DB에 연결하고 DB 핸들을 반환한다.
 * @returns 연결된 `enhance_or_bust` DB 핸들
 */
export async function connectMongo() {
  await mongoClient.connect();
  return mongoClient.db(config.mongoAppDatabase);
}
