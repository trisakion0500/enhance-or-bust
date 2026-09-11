import type { MongoServerError } from "mongodb";
import { mongoLogClient } from "../infra/mongoLog.js";
import { config } from "../config/env.js";
import { logger } from "../infra/logger.js";

/**
 * @returns 서버 로컬 타임존 기준 오늘 날짜(YYYY-MM-DD). `toISOString()`은 UTC라 로컬
 * 타임존과 날짜가 어긋날 수 있어 쓰지 않는다(만료 우편 정리 배치의 cutoff 계산과 동일하게
 * `getFullYear`/`getMonth`/`getDate` 로컬 컴포넌트로 조립한다).
 */
function todayDateString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${date}`;
}

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
      .collection("stats_daily_active_players")
      .insertOne({ playerId, date: todayDateString() });
  } catch (err) {
    if ((err as MongoServerError).code !== 11000) logger.error("일일 활동 기록 실패", err);
  }
}
