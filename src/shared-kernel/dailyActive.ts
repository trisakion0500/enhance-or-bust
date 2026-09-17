import type { MongoServerError } from "mongodb";
import { mongoLogClient } from "../infra/mongoLog.js";
import { config } from "../config/env.js";
import { logger } from "../infra/logger.js";
import { COLLECTIONS } from "./collectionNames.js";
import { todayDateString } from "./dateUtil.js";

/**
 * DAU 집계를 위해 플레이어의 오늘 활동을 1건만 남긴다. `(playerId, date)` 유니크 인덱스
 * 덕분에 그날 첫 요청에서만 실제 insert가 일어나고, 이후 같은 날의 요청은 중복 키 에러
 * (11000)로 조용히 무시된다(SendMail과 동일한 멱등 삽입 패턴). 인증된 모든 요청의 공용
 * 진입점인 `requireAuth`에서 호출되므로, 실패해도 요청 자체를 막지 않도록 여기서 삼킨다.
 * @param playerId 활동을 남길 플레이어
 * @author trisakion
 */
export async function markDailyActive(playerId: string): Promise<void> {
  try {
    await mongoLogClient
      .db(config.mongoAppDatabaseLog)
      .collection(COLLECTIONS.STATS_DAILY_ACTIVE_PLAYERS)
      .insertOne({ playerId, date: todayDateString() });
  } catch (err) {
    if ((err as MongoServerError).code !== 11000) logger.error("일일 활동 기록 실패", err);
  }
}
