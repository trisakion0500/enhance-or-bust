import { connectMongo, mongoClient } from "../infra/mongo.js";
import type { Grade } from "../domain/masterData/grade.js";
import type { GradeConfig } from "../domain/masterData/gradeConfig.js";
import type { CardTemplate } from "../domain/masterData/cardTemplate.js";
import type { EnhancementRule } from "../domain/masterData/enhancementRule.js";
import type { SynthesisRule } from "../domain/masterData/synthesisRule.js";
import type { StageConfig } from "../domain/masterData/stageConfig.js";

/**
 * GAME_DESIGN.md 기준 마스터 데이터를 각 컬렉션에 upsert하는 1회성 시드 스크립트.
 * 자연키로 upsert하므로 재실행해도 중복 삽입되지 않는다(멱등). card_templates 40개(등급당
 * 10개)와 stage_configs 보상 공식, enhanceMaterial의 goldCost는 GAME_DESIGN.md에 구체적
 * 수치가 없어 사용자 확인을 거친 임시값이다 — 기획 확정 시 이 파일 값을 교체한다.
 *
 * ponytail: 최초 부트스트랩 전용 — 배치별 Promise.all이 중간 실패해도 트랜잭션/락 없이
 * 부분 반영된 채로 끝난다(재실행으로 복구, 위 멱등성 참고). 이미 서비스 중인 서버에 대고
 * 밸런스 패치 용도로 재사용할 때는 세션 트랜잭션 + 동시 실행 방지 락을 추가해야 한다.
 * @author trisakion
 */

const GRADE_CONFIGS: GradeConfig[] = [
  { grade: "N", maxLevel: 20, maxEnhancementLevel: 5 },
  { grade: "R", maxLevel: 40, maxEnhancementLevel: 10 },
  { grade: "SR", maxLevel: 60, maxEnhancementLevel: 15 },
  { grade: "SSR", maxLevel: 60, maxEnhancementLevel: 15 },
];

/** 등급별 기본 공격력 범위(GAME_DESIGN.md 1절) — 샘플 템플릿 생성에 쓰인다. */
const ATTACK_RANGE: Record<Grade, [min: number, max: number]> = {
  N: [10, 20],
  R: [25, 40],
  SR: [50, 80],
  SSR: [100, 150],
};

/** @returns 등급별 10개씩, 등급 공격력 범위에 균등분포한 샘플 카드 원형 40개 */
function buildCardTemplates(): CardTemplate[] {
  const templates: CardTemplate[] = [];
  for (const grade of Object.keys(ATTACK_RANGE) as Grade[]) {
    const [min, max] = ATTACK_RANGE[grade];
    for (let i = 0; i < 10; i++) {
      const baseAttack = Math.round(min + ((max - min) * i) / 9);
      templates.push({ templateId: `${grade}_${String(i + 1).padStart(2, "0")}`, grade, baseAttack });
    }
  }
  return templates;
}

const ENHANCEMENT_RULES: EnhancementRule[] = [
  { minTargetEnhancementLevel: 1, maxTargetEnhancementLevel: 5, successRate: 1.0, destroyOnFailChance: 0, goldMultiplier: 100, stoneCost: 1 },
  { minTargetEnhancementLevel: 6, maxTargetEnhancementLevel: 10, successRate: 0.7, destroyOnFailChance: 0, goldMultiplier: 300, stoneCost: 2 },
  { minTargetEnhancementLevel: 11, maxTargetEnhancementLevel: 15, successRate: 0.4, destroyOnFailChance: 0.1, goldMultiplier: 800, stoneCost: 3 },
];

const GRADE_UPGRADE_PATH: Grade[] = ["N", "R", "SR", "SSR"];
const SYNTHESIS_RULES: SynthesisRule[] = [
  ...GRADE_UPGRADE_PATH.slice(0, -1).map(
    (sourceGrade, i): SynthesisRule => ({
      type: "gradeUpgrade",
      sourceGrade,
      resultGrade: GRADE_UPGRADE_PATH[i + 1],
      materialCount: 3,
      successRate: 0.8,
    }),
  ),
  { type: "enhanceMaterial", materialCount: 2, goldCost: 500 },
];

/** 스테이지 필요 전투력 공식(GAME_DESIGN.md 6절)의 "기본값" — 구체 수치 미확정이라 쓰는 가이드 임시값. */
const STAGE_BASE_POWER = 100;

/** @returns 100개 스테이지의 필요 전투력(지수 증가)과 보상(선형, 임시값) */
function buildStageConfigs(): StageConfig[] {
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

/** 각 마스터 데이터 컬렉션에 자연키 기준으로 upsert한다. */
async function main() {
  const db = await connectMongo();

  await Promise.all(
    GRADE_CONFIGS.map(doc => db.collection("grade_configs").updateOne({ grade: doc.grade }, { $set: doc }, { upsert: true })),
  );
  await Promise.all(
    buildCardTemplates().map(doc =>
      db.collection("card_templates").updateOne({ templateId: doc.templateId }, { $set: doc }, { upsert: true }),
    ),
  );
  await Promise.all(
    ENHANCEMENT_RULES.map(doc =>
      db
        .collection("enhancement_rules")
        .updateOne({ minTargetEnhancementLevel: doc.minTargetEnhancementLevel }, { $set: doc }, { upsert: true }),
    ),
  );
  await Promise.all(
    SYNTHESIS_RULES.map(doc => {
      const key = doc.type === "gradeUpgrade" ? { type: doc.type, sourceGrade: doc.sourceGrade } : { type: doc.type };
      return db.collection("synthesis_rules").updateOne(key, { $set: doc }, { upsert: true });
    }),
  );
  await Promise.all(
    buildStageConfigs().map(doc => db.collection("stage_configs").updateOne({ stageId: doc.stageId }, { $set: doc }, { upsert: true })),
  );

  console.log("마스터 데이터 시드 완료");
  await mongoClient.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
