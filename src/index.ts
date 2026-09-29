/**
 * 프로세스 엔트리포인트 — DB/Redis 연결 → Express 서버 기동 → 종료 시그널 핸들러 등록 순으로
 * 부트스트랩한다. top-level await를 쓰므로 ESM(`"type": "module"`) + ES2022 타깃이 전제.
 * @author trisakion
 */
import cron from "node-cron";
import { config } from "./config/env.js";
import { connectMongo, mongoClient } from "./infra/mongo.js";
import { connectMongoLog, ensureLogIndexes, mongoLogClient } from "./infra/mongoLog.js";
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
import { createCouponS2sClient } from "./contexts/coupon/infrastructure/couponS2sClient.js";
import { ensureCouponRedemptionIndexes } from "./contexts/coupon/infrastructure/couponRedemptionStore.js";
import { ensureAttendanceIndexes } from "./contexts/attendance/infrastructure/attendanceStore.js";
import { reconcileUnconfirmedCoupons } from "./contexts/coupon/application/couponService.js";
import { connectRedis, redisClient } from "./infra/redis.js";
import { createServer } from "./server.js";

/**
 * 부팅 단계 연결 실패를 즉시 종료로 처리한다 — 운영 중 다운(재연결 전략/circuit breaker,
 * CLAUDE.md "MongoDB/Redis 다운 상황에 대한 회복력 보강" 절)과 달리, 부팅 시점은 관리자가
 * 화면을 보고 있어 자동 복구를 기다리기보다 바로 실패를 알리고 멈추는 쪽이 낫다. 이 구분이
 * 가능한 이유는 `connectMongo()`/`connectMongoLog()`/`connectRedis()`가 프로세스 생애주기
 * 동안 여기서 딱 한 번만 호출되기 때문 — 이후의 재연결은 전부 드라이버/클라이언트 내부
 * 로직(하트비트, reconnectStrategy)이 맡아 이 함수를 다시 부르지 않는다.
 * @param promise 부팅 단계에서 기다릴 연결 Promise
 * @param label 실패 로그에 남길 대상 이름
 * @author trisakion
 */
async function connectOrExit<T>(promise: Promise<T>, label: string): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    logger.error(`${label} 연결 실패 — 서버를 구동할 수 없어 즉시 종료합니다`, err);
    process.exit(1);
  }
}

const db = await connectOrExit(connectMongo(), "MongoDB");
const logDb = await connectOrExit(connectMongoLog(), "MongoDB(로그)");
await ensureLogIndexes(logDb);
await connectOrExit(connectRedis(), "Redis");
logger.info(`connected to mongo db "${db.databaseName}", log db "${logDb.databaseName}", and redis`);

await masterDataCache.loadAll(db);
await startMasterDataWatch(db);
startMasterDataPolling(db);
logger.info("마스터 데이터 캐시 적재 완료, change stream/폴링 워처 시작");

const playerRepository = new MongoPlayerRepository(db);
await playerRepository.ensureIndexes();
const mailboxRepository = new MongoMailboxRepository(db);
await mailboxRepository.ensureIndexes();
await ensureCouponRedemptionIndexes(db);
await ensureAttendanceIndexes(db);
const app = createServer(playerRepository, mailboxRepository, db);
const httpServer = app.listen(config.port, () => {
  logger.info(`listening on port ${config.port}`);
});

const mailboxCleanupTask = cron.schedule(config.mailboxCleanupCron, () => {
  runMailboxCleanupJob(db, mailboxRepository, config.mailboxCleanupRetentionMonths).catch(err =>
    logger.error("만료 우편 정리 배치 실패", err),
  );
});

const couponClient = createCouponS2sClient();
const couponReconcileTask = cron.schedule(config.couponReconcileCron, () => {
  reconcileUnconfirmedCoupons(couponClient, mailboxRepository, db).catch(err =>
    logger.error("쿠폰 confirm 재처리 배치 실패", err),
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
  couponReconcileTask.stop();
  stopMasterDataPolling();
  await stopMasterDataWatch();
  await Promise.all([mongoClient.close(), mongoLogClient.close(), redisClient.quit()]);
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
