/**
 * 프로세스 엔트리포인트 — DB/Redis 연결 → Express 서버 기동 → 종료 시그널 핸들러 등록 순으로
 * 부트스트랩한다. top-level await를 쓰므로 ESM(`"type": "module"`) + ES2022 타깃이 전제.
 * @author trisakion
 */
import cron from "node-cron";
import { config } from "./config/env.js";
import { connectMongo, mongoClient } from "./infra/mongo.js";
import { connectMongoLog, mongoLogClient } from "./infra/mongoLog.js";
import { logger } from "./infra/logger.js";
import { masterDataCache } from "./shared-kernel/masterData/masterDataCache.js";
import {
  startMasterDataPolling,
  startMasterDataWatch,
  stopMasterDataPolling,
  stopMasterDataWatch,
} from "./shared-kernel/masterData/masterDataWatcher.js";
import { MongoPlayerRepository } from "./contexts/player/infrastructure/mongoPlayerRepository.js";
import { MongoMailboxRepository } from "./contexts/mailbox/infrastructure/mongoMailboxRepository.js";
import { runMailboxCleanupJob } from "./contexts/mailbox/application/mailboxCleanupService.js";
import { connectRedis, redisClient } from "./infra/redis.js";
import { createServer } from "./server.js";

const db = await connectMongo();
const logDb = await connectMongoLog();
await connectRedis();
logger.info(`connected to mongo db "${db.databaseName}", log db "${logDb.databaseName}", and redis`);

await masterDataCache.loadAll(db);
await startMasterDataWatch(db);
startMasterDataPolling(db);
logger.info("마스터 데이터 캐시 적재 완료, change stream/폴링 워처 시작");

const playerRepository = new MongoPlayerRepository(db);
await playerRepository.ensureIndexes();
const mailboxRepository = new MongoMailboxRepository(db);
await mailboxRepository.ensureIndexes();
const app = createServer(playerRepository, mailboxRepository);
const httpServer = app.listen(config.port, () => {
  logger.info(`listening on port ${config.port}`);
});

const mailboxCleanupTask = cron.schedule(config.mailboxCleanupCron, () => {
  runMailboxCleanupJob(db, mailboxRepository, config.mailboxCleanupRetentionMonths).catch(err =>
    logger.error("만료 우편 정리 배치 실패", err),
  );
});

/**
 * SIGINT/SIGTERM 수신 시 커넥션을 정상 종료한 뒤 프로세스를 끝낸다.
 * 시그널 핸들러를 등록하면 Node의 기본 종료 동작이 무력화되므로, 여기서 명시적으로 `process.exit()`까지
 * 호출해야 프로세스가 실제로 내려간다. 크론은 DB보다 먼저 멈춘다 — DB 커넥션이 먼저 닫히면 아직 살아있는
 * 스케줄이 그 사이 발동해 "연결 닫힘" 에러가 날 수 있다.
 */
async function shutdown() {
  mailboxCleanupTask.stop();
  stopMasterDataPolling();
  await stopMasterDataWatch();
  await Promise.all([mongoClient.close(), mongoLogClient.close(), redisClient.quit()]);
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
