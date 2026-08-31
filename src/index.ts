import { config } from "./config/env.js";
import { connectMongo, mongoClient } from "./infra/mongo.js";
import { connectMongoLog, mongoLogClient } from "./infra/mongoLog.js";
import { logger } from "./infra/logger.js";
import { connectRedis, redisClient } from "./infra/redis.js";
import { createServer } from "./server.js";

const db = await connectMongo();
const logDb = await connectMongoLog();
await connectRedis();
logger.info(`connected to mongo db "${db.databaseName}", log db "${logDb.databaseName}", and redis`);

const app = createServer();
const httpServer = app.listen(config.port, () => {
  logger.info(`listening on port ${config.port}`);
});

async function shutdown() {
  await Promise.all([mongoClient.close(), mongoLogClient.close(), redisClient.quit()]);
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
