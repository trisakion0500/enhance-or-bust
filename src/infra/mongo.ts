import { MongoClient } from "mongodb";
import { config } from "../config/env.js";

export const mongoClient = new MongoClient(config.mongoUri, {
  auth: { username: config.mongoAppUsername, password: config.mongoAppPassword },
  authSource: config.mongoAppDatabase,
});

export async function connectMongo() {
  await mongoClient.connect();
  return mongoClient.db(config.mongoAppDatabase);
}
