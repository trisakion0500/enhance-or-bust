import type { Element } from "../../shared-kernel/masterData/element.js";
import type { StageConfig } from "./domain/stageConfig.js";

/** 몬스터 스탯 성장 공식(GAME_DESIGN.md 6절)의 기본값 — 구체 수치 미확정이라 쓰는 가이드 임시값. */
const BASE_MONSTER_HP = 50;
const BASE_MONSTER_ATTACK = 5;
const BASE_MONSTER_DEFENSE = 2;
const MONSTER_GROWTH_RATE = 1.15;

/** 스테이지마다 순환 배정할 몬스터 원소. */
const ELEMENTS: Element[] = ["fire", "water", "grass"];

/** @returns 100개 스테이지의 몬스터 스탯(지수 증가)과 보상(선형/확률, 임시값) */
export function buildStageConfigs(): StageConfig[] {
  const stages: StageConfig[] = [];
  for (let stageId = 1; stageId <= 100; stageId++) {
    const scale = MONSTER_GROWTH_RATE ** stageId;
    stages.push({
      stageId,
      monsterHp: Math.round(BASE_MONSTER_HP * scale),
      monsterAttack: Math.round(BASE_MONSTER_ATTACK * scale),
      monsterDefense: Math.round(BASE_MONSTER_DEFENSE * scale),
      monsterElement: ELEMENTS[stageId % ELEMENTS.length],
      rewardGold: stageId * 10,
      rewardExp: stageId * 5,
      enhancementStoneDropRate: 0.5,
      enhancementStoneMin: Math.max(1, Math.round(stageId * 0.5)),
      enhancementStoneMax: Math.max(2, stageId),
      farmRewardRate: 0.5,
    });
  }
  return stages;
}
