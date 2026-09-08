import type { StageConfig } from "./domain/stageConfig.js";

/** 스테이지 필요 전투력 공식(GAME_DESIGN.md 6절)의 "기본값" — 구체 수치 미확정이라 쓰는 가이드 임시값. */
const STAGE_BASE_POWER = 100;

/** @returns 100개 스테이지의 필요 전투력(지수 증가)과 보상(선형, 임시값) */
export function buildStageConfigs(): StageConfig[] {
  const stages: StageConfig[] = [];
  for (let stageId = 1; stageId <= 100; stageId++) {
    stages.push({
      stageId,
      requiredPower: Math.round(STAGE_BASE_POWER * 1.15 ** stageId),
      rewardGold: stageId * 10,
      rewardExp: stageId * 5,
    });
  }
  return stages;
}
