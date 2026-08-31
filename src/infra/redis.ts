import { createClient } from "redis";
import { config } from "../config/env.js";

export const redisClient = createClient({ url: config.redisUrl, password: config.redisPassword });

export async function connectRedis() {
  await redisClient.connect();
  return redisClient;
}
