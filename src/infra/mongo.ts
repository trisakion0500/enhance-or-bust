import { MongoClient } from "mongodb";
import { config } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * 메인 앱 DB(`enhance_or_bust`) 전용 MongoDB 클라이언트. 로그 DB용 클라이언트({@link ../infra/mongoLog.js})와는
 * 계정/DB가 달라 커넥션을 물리적으로 분리한다.
 * @author trisakion
 * @modified trisakion 생성 이후 수정 이력 있음(상세 날짜/내용은 소급 정리 대상 밖 — git log 참고)
 * @modified 2026-09-20 trisakion 드라이버 기본 serverSelectionTimeoutMS(30초)를 12초로
 *   단축하고, 하트비트 이벤트로 다운 상태(mongoHealthy)를 추적하도록 추가 — 아래
 *   isMongoHealthy() 참고
 */
export const mongoClient = new MongoClient(config.mongoUri, {
  auth: { username: config.mongoAppUsername, password: config.mongoAppPassword },
  authSource: config.mongoAppDatabase,
  // 드라이버 기본값(30초)은 DB가 죽어있을 때 요청 하나가 그만큼 걸려있게 둬 너무 길다.
  // 12초로 줄이되(redis.ts의 RECONNECT_GIVE_UP_MS와 동일 기준), 순간적인 네트워크 순단은
  // 드라이버가 내부적으로 재시도하며 버틸 수 있을 정도는 남겨둔다.
  serverSelectionTimeoutMS: 12000,
});

/**
 * 주기적 서버 헬스체크(하트비트, 기본 10초 간격)로 갱신되는 상태 — `dbHealthGate`
 * 미들웨어가 이 값을 보고 다운 중엔 요청을 라우트까지 보내지 않고 즉시 거부한다
 * (circuit breaker, redis.ts의 isRedisHealthy와 동일한 목적). 로그 DB(mongoLogClient)는
 * 대상이 아니다 — 로그 DB 장애가 메인 흐름을 막으면 안 된다는 원칙(CLAUDE.md 로깅 원칙)과
 * 상충하기 때문이다.
 */
let mongoHealthy = true;
mongoClient.on("serverHeartbeatFailed", event => {
  // 이미 다운으로 판단된 상태에서 반복되는 하트비트 실패까지 매번 찍으면 로그만 늘어나므로
  // 최초 전이(healthy → unhealthy) 시점에만 error 레벨로 남긴다.
  if (mongoHealthy) logger.error("MongoDB heartbeat failed — treating as down", event.failure);
  mongoHealthy = false;
});
mongoClient.on("serverHeartbeatSucceeded", () => {
  if (!mongoHealthy) logger.info("MongoDB heartbeat recovered");
  mongoHealthy = true;
});

/**
 * 지금 메인 앱 DB에 즉시 접근 가능한 상태인지.
 * @returns 최근 하트비트가 성공했으면 true
 * @author trisakion
 */
export function isMongoHealthy(): boolean {
  return mongoHealthy;
}

/**
 * 메인 앱 DB에 연결하고 DB 핸들을 반환한다.
 * @returns 연결된 `enhance_or_bust` DB 핸들
 * @author trisakion
 */
export async function connectMongo() {
  await mongoClient.connect();
  return mongoClient.db(config.mongoAppDatabase);
}
