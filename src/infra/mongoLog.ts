import { MongoClient } from "mongodb";
import { config } from "../config/env.js";

export const mongoLogClient = new MongoClient(config.mongoUri, {
  auth: { username: config.mongoAppUsernameLog, password: config.mongoAppPasswordLog },
  authSource: config.mongoAppDatabaseLog,
});

export async function connectMongoLog() {
  await mongoLogClient.connect();
  return mongoLogClient.db(config.mongoAppDatabaseLog);
}
