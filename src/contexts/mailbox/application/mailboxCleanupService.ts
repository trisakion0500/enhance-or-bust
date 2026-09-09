import type { Db } from "mongodb";
import { logger } from "../../../infra/logger.js";
import { tryClaimBatchRun } from "../../../shared-kernel/batchRunGuard.js";
import type { MailboxRepository } from "../domain/mailboxRepository.js";

/** `batch_runs` 마커에 쓰이는 이 배치의 고유 식별자. */
const JOB_NAME = "mailbox_cleanup";

/**
 * 만료된 지 오래된 우편을 정리한다(수령 여부 무관, 오직 만료 시각만 기준 — CLAUDE.md의 "수령한
 * 우편도 데이터 가치가 있어 TTL 인덱스로 자동 삭제하지 않는다"는 즉시/암묵적 삭제 금지 원칙이지,
 * 3개월 이상 지난 만료건을 명시적 배치로 정리하는 것까지 막는 취지는 아니다). 서버 인스턴스가
 * 여러 대여도 이번 실행 주기(YYYY-MM)에 한 인스턴스만 실제로 삭제하도록 `batch_runs` 마커로
 * 중복 실행을 막는다.
 * @param db 메인 앱 DB 핸들(배치 실행권 마커 삽입용)
 * @param mailboxRepository Mailbox 영속성 포트
 * @param retentionMonths 만료 후 이 개월 수보다 오래된 우편만 삭제 대상
 * @author trisakion
 */
export async function runMailboxCleanupJob(db: Db, mailboxRepository: MailboxRepository, retentionMonths: number): Promise<void> {
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  if (!(await tryClaimBatchRun(db, JOB_NAME, period))) {
    logger.info(`[${JOB_NAME}] ${period} 주기는 다른 인스턴스가 이미 실행함, 건너뜀`);
    return;
  }

  // 실행 시각(now)을 그대로 빼면 크론이 지연 발동했을 때 cutoff가 그만큼 밀린다 —
  // 이번 달 1일 00:00:00.000을 기준점으로 고정한 뒤 개월 수만 빼서 실행 시각과 무관하게 만든다.
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - retentionMonths, 1, 0, 0, 0, 0);
  const deletedCount = await mailboxRepository.deleteExpiredBefore(cutoff);
  logger.info(`[${JOB_NAME}] ${cutoff.toISOString()} 이전 만료 우편 ${deletedCount}건 삭제 완료`);
}
