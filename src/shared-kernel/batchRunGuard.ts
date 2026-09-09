import type { Db, MongoServerError } from "mongodb";

/** `system_batch_runs` 컬렉션 문서 — `{jobName}:{period}`를 `_id`로 삼아 유니크 삽입으로 실행권을 선점한다. */
interface BatchRunDocument {
  _id: string;
  claimedAt: Date;
}

/**
 * 배치 잡의 인스턴스(레플리카) 간 중복 실행을 막는 멱등 마커. `system_batch_runs` 컬렉션에
 * `{jobName}:{period}`를 `_id`로 삽입 시도해, 이미 그 주기에 다른 인스턴스가 선점했으면
 * false를 반환한다. Redis 분산락을 새로 들이는 대신 MongoDB `_id` 유니크 제약만으로
 * 처리 — `sendMail()`의 (sourceType, sourceId) 멱등 발송과 같은 원리(단일 프라이머리의
 * 유니크 제약이 동시 삽입 순서를 항상 일관되게 판정)라 향후 다른 배치도 재사용 가능하다.
 * @param db 메인 앱 DB 핸들
 * @param jobName 배치 잡 식별자(예: "mailbox_cleanup")
 * @param period 이번 실행 주기 식별자(예: 월별 배치는 "2026-09" 같은 YYYY-MM)
 * @returns 이번 호출이 실행권을 선점했으면 true, 이미 다른 인스턴스가 같은 주기를 실행했으면 false
 * @author trisakion
 */
export async function tryClaimBatchRun(db: Db, jobName: string, period: string): Promise<boolean> {
  try {
    await db.collection<BatchRunDocument>("system_batch_runs").insertOne({ _id: `${jobName}:${period}`, claimedAt: new Date() });
    return true;
  } catch (err) {
    if ((err as MongoServerError).code === 11000) return false;
    throw err;
  }
}
