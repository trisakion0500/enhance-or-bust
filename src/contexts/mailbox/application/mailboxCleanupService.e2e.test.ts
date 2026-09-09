import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Mail } from "../domain/mail.js";
import { connectMongo, mongoClient } from "../../../infra/mongo.js";
import { MongoMailboxRepository } from "../infrastructure/mongoMailboxRepository.js";
import { tryClaimBatchRun } from "../../../shared-kernel/batchRunGuard.js";
import { runMailboxCleanupJob } from "./mailboxCleanupService.js";

/**
 * 만료 우편 정리 배치 E2E 테스트. 실제 Mongo에 붙어 `runMailboxCleanupJob()`을 직접 호출한다
 * (HTTP API가 없는 배치라 `mailboxRoutes.e2e.test.ts`처럼 서버를 띄우지 않는다).
 * @author trisakion
 */

let db: import("mongodb").Db;
let mailboxRepository: MongoMailboxRepository;

before(async () => {
  db = await connectMongo();
  mailboxRepository = new MongoMailboxRepository(db);
});

after(async () => {
  await mongoClient.close();
});

/** 테스트가 만든 우편/실행 마커를 지운다. */
async function cleanup(playerId: string, period: string) {
  await db.collection("mailbox").deleteMany({ playerId });
  await db.collection<{ _id: string }>("batch_runs").deleteMany({ _id: { $eq: `mailbox_cleanup:${period}` } });
}

test("retentionMonths보다 오래 전에 만료된 우편은 수령 여부와 무관하게 삭제된다", async () => {
  const playerId = randomUUID();
  const period = `test-${randomUUID()}`; // 실제 YYYY-MM 주기와 겹치지 않는 고유 마커
  const now = Date.now();
  const oldExpired = new Mail(randomUUID(), playerId, "오래된 만료 우편", { gold: 1 }, "test", randomUUID(), new Date(now - 200 * 86400000), new Date(now - 100 * 86400000), new Date());
  const recentExpired = new Mail(randomUUID(), playerId, "최근 만료 우편", { gold: 1 }, "test", randomUUID(), new Date(now - 10 * 86400000), new Date(now - 5 * 86400000), null);
  const notExpired = new Mail(randomUUID(), playerId, "미만료 우편", { gold: 1 }, "test", randomUUID(), new Date(now), new Date(now + 86400000), null);
  try {
    await mailboxRepository.insertMail(oldExpired);
    await mailboxRepository.insertMail(recentExpired);
    await mailboxRepository.insertMail(notExpired);

    const cutoff = new Date(now - 90 * 86400000); // retentionMonths=3에 해당하는 대략적 컷오프
    const deletedCount = await mailboxRepository.deleteExpiredBefore(cutoff);
    assert.equal(deletedCount, 1);

    assert.equal(await mailboxRepository.findById(oldExpired.mailId), null);
    assert.notEqual(await mailboxRepository.findById(recentExpired.mailId), null);
    assert.notEqual(await mailboxRepository.findById(notExpired.mailId), null);
  } finally {
    await cleanup(playerId, period);
  }
});

test("같은 실행 주기는 두 번째 인스턴스가 실행권을 선점하지 못한다(중복 실행 방지)", async () => {
  const period = `test-${randomUUID()}`;
  try {
    assert.equal(await tryClaimBatchRun(db, "mailbox_cleanup", period), true);
    assert.equal(await tryClaimBatchRun(db, "mailbox_cleanup", period), false);
  } finally {
    await db.collection<{ _id: string }>("batch_runs").deleteMany({ _id: { $eq: `mailbox_cleanup:${period}` } });
  }
});

test("runMailboxCleanupJob은 오래된 만료 우편을 실행권 선점 후 정리한다", async () => {
  // 이 함수는 내부에서 실제 이번 달(YYYY-MM)을 주기로 삼으므로, 중복 실행 방지 자체는
  // 격리된 가짜 주기로 tryClaimBatchRun을 직접 검증하는 위 테스트가 맡는다 — 여기서는
  // 실제 배치 마커를 남겼다가 finally에서 곧바로 지워 프로덕션 마커 오염 시간을 최소화한다.
  const playerId = randomUUID();
  const now = new Date();
  const period = now.toISOString().slice(0, 7);
  // cutoff는 "이번 달 1일 00:00" 기준 retentionMonths(3) 전이라 날짜만큼의 오차가 있다 —
  // 4개월 전 15일로 잡아 어느 달 길이에서든 확실히 cutoff보다 앞서게 한다.
  const wellBeforeCutoff = new Date(now.getFullYear(), now.getMonth() - 4, 15);
  const oldExpired = new Mail(randomUUID(), playerId, "정리 대상", { gold: 1 }, "test", randomUUID(), wellBeforeCutoff, wellBeforeCutoff, null);
  try {
    await mailboxRepository.insertMail(oldExpired);
    await runMailboxCleanupJob(db, mailboxRepository, 3);
    assert.equal(await mailboxRepository.findById(oldExpired.mailId), null);
  } finally {
    await cleanup(playerId, period);
  }
});

test("cutoff 경계 — 이번 달 1일 00:00 기준 retentionMonths 전 시각을 정확히 걸쳐 이전/이후로 나뉜다", async () => {
  const playerId = randomUUID();
  const now = new Date();
  const period = now.toISOString().slice(0, 7);
  const retentionMonths = 3;
  // 프로덕션(runMailboxCleanupJob)과 동일한 공식으로 cutoff를 직접 계산해 경계값을 만든다.
  const cutoff = new Date(now.getFullYear(), now.getMonth() - retentionMonths, 1, 0, 0, 0, 0);
  const justBeforeCutoff = new Date(cutoff.getTime() - 1);
  const exactlyAtCutoff = new Date(cutoff.getTime());
  const beforeMail = new Mail(randomUUID(), playerId, "cutoff 직전 만료", { gold: 1 }, "test", randomUUID(), justBeforeCutoff, justBeforeCutoff, null);
  const atCutoffMail = new Mail(randomUUID(), playerId, "cutoff 정각 만료", { gold: 1 }, "test", randomUUID(), exactlyAtCutoff, exactlyAtCutoff, null);
  try {
    await mailboxRepository.insertMail(beforeMail);
    await mailboxRepository.insertMail(atCutoffMail);
    await runMailboxCleanupJob(db, mailboxRepository, retentionMonths);

    assert.equal(await mailboxRepository.findById(beforeMail.mailId), null); // cutoff 직전 → 삭제
    assert.notEqual(await mailboxRepository.findById(atCutoffMail.mailId), null); // cutoff 정각($lt이므로 미포함) → 유지
  } finally {
    await cleanup(playerId, period);
  }
});
