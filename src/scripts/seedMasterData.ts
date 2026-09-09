import type { Db } from "mongodb";
import { connectMongo, mongoClient } from "../infra/mongo.js";
import type { MasterDataContent } from "../shared-kernel/masterData/masterDataContent.js";
import { GRADE_CONFIGS, buildCardTemplates } from "../shared-kernel/masterData/seedData.js";
import { ENHANCEMENT_RULES } from "../contexts/enhancement/seedData.js";
import { SYNTHESIS_RULES } from "../contexts/synthesis/seedData.js";
import { buildCardDropRules, buildStageConfigs } from "../contexts/battleStage/seedData.js";

/**
 * GAME_DESIGN.md 기준 마스터 데이터를 각 컬렉션에 upsert하는 1회성 시드 스크립트.
 * 자연키로 upsert하므로 재실행해도 중복 삽입되지 않는다(멱등). 실제 시드 데이터 값은 각
 * 컨텍스트의 `seedData.ts`(master_card_templates/master_grade_configs는 `shared-kernel/masterData/seedData.ts`)가
 * 갖고 있고, 이 파일은 그것들을 모아 upsert만 수행하는 오케스트레이터다.
 *
 * ponytail: 최초 부트스트랩 전용 — 배치별 Promise.all이 중간 실패해도 트랜잭션/락 없이
 * 부분 반영된 채로 끝난다(재실행으로 복구, 위 멱등성 참고). 이미 서비스 중인 서버에 대고
 * 밸런스 패치 용도로 재사용할 때는 세션 트랜잭션 + 동시 실행 방지 락을 추가해야 한다.
 * @author trisakion
 */

/**
 * `master_data_meta`의 해당 컨텐츠 버전을 1 증가시킨다 — 마스터 데이터 캐시의 폴링
 * 폴백(CLAUDE.md "마스터 데이터 로딩/리로드 전략")이 이 버전으로 DB와 캐시의 어긋남을
 * 감지한다. 값이 바뀌지 않은 재실행이어도 그냥 증가시킨다 — 어차피 리로드는 멱등하고
 * 안전망이 여분으로 한 번 더 도는 것뿐이라, 실제 변경분과 구분하는 값 비교 로직을 따로
 * 두지 않는다.
 */
async function bumpMasterDataVersion(db: Db, content: MasterDataContent) {
  await db.collection("master_data_meta").updateOne({ content }, { $inc: { version: 1 } }, { upsert: true });
}

/** 각 마스터 데이터 컬렉션에 자연키 기준으로 upsert하고, 컨텐츠별 버전을 갱신한다. */
async function main() {
  const db = await connectMongo();

  await Promise.all(
    GRADE_CONFIGS.map(doc => db.collection("master_grade_configs").updateOne({ grade: doc.grade }, { $set: doc }, { upsert: true })),
  );
  await bumpMasterDataVersion(db, "master_grade_configs");

  await Promise.all(
    buildCardTemplates().map(doc =>
      db.collection("master_card_templates").updateOne({ templateId: doc.templateId }, { $set: doc }, { upsert: true }),
    ),
  );
  await bumpMasterDataVersion(db, "master_card_templates");

  await Promise.all(
    ENHANCEMENT_RULES.map(doc =>
      db
        .collection("master_enhancement_rules")
        .updateOne({ minTargetEnhancementLevel: doc.minTargetEnhancementLevel }, { $set: doc }, { upsert: true }),
    ),
  );
  await bumpMasterDataVersion(db, "master_enhancement_rules");

  await Promise.all(
    SYNTHESIS_RULES.map(doc => {
      const key = doc.type === "gradeUpgrade" ? { type: doc.type, sourceGrade: doc.sourceGrade } : { type: doc.type };
      return db.collection("master_synthesis_rules").updateOne(key, { $set: doc }, { upsert: true });
    }),
  );
  await bumpMasterDataVersion(db, "master_synthesis_rules");

  await Promise.all(
    buildStageConfigs().map(doc =>
      db
        .collection("master_stage_configs")
        // cardDropTable(구 필드)이 master_stage_card_drops 컬렉션으로 분리되며 남은 이전 문서를 정리한다.
        .updateOne({ stageId: doc.stageId }, { $set: doc, $unset: { cardDropTable: "" } }, { upsert: true }),
    ),
  );
  await bumpMasterDataVersion(db, "master_stage_configs");

  await Promise.all(
    buildCardDropRules().map(doc =>
      db
        .collection("master_stage_card_drops")
        .updateOne({ stageId: doc.stageId, templateId: doc.templateId }, { $set: doc }, { upsert: true }),
    ),
  );
  await bumpMasterDataVersion(db, "master_stage_card_drops");

  console.log("마스터 데이터 시드 완료");
  await mongoClient.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
