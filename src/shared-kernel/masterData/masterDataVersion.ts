import type { Db } from "mongodb";
import { COLLECTIONS } from "../collectionNames.js";
import type { MasterDataContent } from "./masterDataContent.js";

/**
 * `master_data_meta`의 해당 컨텐츠 버전을 1 증가시킨다 — 마스터 데이터 캐시의 폴링
 * 폴백(CLAUDE.md "마스터 데이터 로딩/리로드 전략")이 이 버전으로 DB와 캐시의 어긋남을
 * 감지한다. 값이 바뀌지 않은 호출이어도 그냥 증가시킨다 — 리로드는 멱등하고 안전망이
 * 여분으로 한 번 더 도는 것뿐이라 실제 변경분과 구분하는 값 비교 로직을 두지 않는다.
 * 시드 스크립트(`seedMasterData.ts`)와 gm_platform 실시간 쓰기(`attendanceStore.ts`)가
 * 공통으로 쓴다.
 * @author trisakion
 */
export async function bumpMasterDataVersion(db: Db, content: MasterDataContent): Promise<void> {
  await db.collection(COLLECTIONS.MASTER_DATA_META).updateOne({ content }, { $inc: { version: 1 } }, { upsert: true });
}
