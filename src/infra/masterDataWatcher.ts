import type { ChangeStream, Db, MongoServerError } from "mongodb";
import { config } from "../config/env.js";
import type { MasterDataContent } from "../domain/masterData/masterDataContent.js";
import { MASTER_DATA_CONTENTS } from "../domain/masterData/masterDataContent.js";
import { logger } from "./logger.js";
import type { MasterDataMetaDocument } from "./masterDataCache.js";
import { masterDataCache } from "./masterDataCache.js";

/** `change_stream_state` 컬렉션 문서 — 마스터 데이터 워처의 resume token을 단일 문서로 보관한다. */
interface ChangeStreamStateDocument {
  _id: "masterData";
  resumeToken: unknown;
}

let changeStream: ChangeStream | undefined;
let pollTimer: NodeJS.Timeout | undefined;
let retryTimer: NodeJS.Timeout | undefined;
let retryDelayMs = 0;

/**
 * DB 레벨 Change Stream 워처 1개로 5개 마스터 데이터 컬렉션을 전부 감시한다. 컬렉션마다
 * 워처를 따로 두지 않고 `event.ns.coll`로 컨텐츠를 구분해 해당 컨텐츠만 리로드한다
 * (CLAUDE.md "마스터 데이터 로딩/리로드 전략" 참고).
 *
 * 스케일아웃 시에도 인스턴스별 락 없이 각자 독립 실행한다 — Change Stream은 oplog를 각
 * 커넥션이 독립적으로 tailing하는 방식이라(경쟁 소비자 큐 아님) 인스턴스 N개가 같은
 * 이벤트를 전부 각자 받는다. `change_stream_state`의 resumeToken을 여러 인스턴스가 동시에
 * 덮어써 경합이 나도, `reload()`가 매번 컬렉션 전체를 재조회하므로 무해하다.
 * @param db 메인 앱 DB 핸들
 * @author trisakion
 */
export async function startMasterDataWatch(db: Db): Promise<void> {
  const stateCollection = db.collection<ChangeStreamStateDocument>("change_stream_state");
  const state = await stateCollection.findOne({ _id: "masterData" });
  const pipeline = [{ $match: { "ns.coll": { $in: [...MASTER_DATA_CONTENTS] } } }];

  changeStream = db.watch(pipeline, state?.resumeToken ? { resumeAfter: state.resumeToken } : {});

  changeStream.on("change", async event => {
    retryDelayMs = 0; // 이벤트를 정상 수신했다는 건 연결이 살아있다는 증거 — 백오프 리셋
    try {
      // invalidate/dropDatabase 이벤트는 ns.coll이 없다 — 이 프로젝트에서 마스터 데이터
      // 컬렉션을 그렇게 다룰 일이 없으므로 무시하고 넘어간다.
      if (!("ns" in event) || !("coll" in event.ns)) return;
      const content = event.ns.coll as MasterDataContent;
      await masterDataCache.reload(db, content);
      await stateCollection.updateOne({ _id: "masterData" }, { $set: { resumeToken: event._id } }, { upsert: true });
    } catch (err) {
      // 이벤트 하나의 처리 실패가 스트림 전체를 죽이면 안 됨 — 다음 이벤트는 계속 받는다.
      // 이 이벤트로 놓친 변경분은 폴링 폴백이 나중에 따라잡는다.
      logger.error("마스터 데이터 change stream 이벤트 처리 실패", err);
    }
  });

  changeStream.on("error", async err => {
    logger.error("마스터 데이터 change stream 오류, 재연결 시도", err);
    // resume token이 oplog 보존 범위를 벗어나 재개 불가능해진 경우 — 토큰을 버리고
    // 캐시를 전체 재적재한 뒤 처음부터 다시 구독한다.
    if ((err as MongoServerError).codeName === "ChangeStreamHistoryLost") {
      await stateCollection.deleteOne({ _id: "masterData" });
      await masterDataCache.loadAll(db);
    }
    retryDelayMs = retryDelayMs === 0 ? 1000 : Math.min(retryDelayMs * 2, 60_000);
    logger.error(`마스터 데이터 change stream ${retryDelayMs}ms 후 재연결 시도`);
    retryTimer = setTimeout(() => void startMasterDataWatch(db), retryDelayMs);
  });
}

/** 마스터 데이터 워처를 정지한다. 서버 종료 시퀀스에서 호출한다. */
export async function stopMasterDataWatch(): Promise<void> {
  clearTimeout(retryTimer);
  await changeStream?.close();
}

/**
 * 폴링 폴백 — 각 컨텐츠의 DB 버전(`master_data_meta`)과 캐시가 적재해둔 버전을 주기적으로
 * 비교해 어긋나면 강제 리로드한다. Change Stream이 주 채널이고, 이건 이벤트를 놓쳤을 때
 * 뒤늦게라도 따라잡는 안전망이다.
 * @param db 메인 앱 DB 핸들
 */
export function startMasterDataPolling(db: Db): void {
  pollTimer = setInterval(() => void pollOnce(db), config.masterDataPollIntervalMs);
}

/** 마스터 데이터 폴링을 정지한다. 서버 종료 시퀀스에서 호출한다. */
export function stopMasterDataPolling(): void {
  clearInterval(pollTimer);
}

/**
 * DB의 컨텐츠별 최신 버전과 캐시가 들고 있는 버전을 한 번 비교해, 어긋난 컨텐츠만 리로드한다.
 * `startMasterDataPolling`이 주기적으로 호출하는 실제 폴링 로직 본체.
 * @param db 메인 앱 DB 핸들
 */
async function pollOnce(db: Db): Promise<void> {
  try {
    const metaDocs = await db.collection<MasterDataMetaDocument>("master_data_meta").find().toArray();
    const cachedVersions = masterDataCache.getVersions();
    for (const meta of metaDocs) {
      if (cachedVersions.get(meta.content) !== meta.version)
        await masterDataCache.reload(db, meta.content);
    }
  } catch (err) {
    logger.error("마스터 데이터 폴링 폴백 실패", err);
  }
}
