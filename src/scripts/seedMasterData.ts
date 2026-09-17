import { connectMongo, mongoClient } from "../infra/mongo.js";
import { COLLECTIONS } from "../shared-kernel/collectionNames.js";
import { bumpMasterDataVersion } from "../shared-kernel/masterData/masterDataVersion.js";
import { GRADE_CONFIGS, buildCardTemplates } from "../shared-kernel/masterData/seedData.js";
import { ENHANCEMENT_RULES } from "../contexts/enhancement/seedData.js";
import { SYNTHESIS_RULES } from "../contexts/synthesis/seedData.js";
import { buildCardDropRules, buildStageConfigs } from "../contexts/battleStage/seedData.js";
import { ATTENDANCE_BOOK_SEEDS, buildAttendanceCatchupPriceRows, buildAttendanceRewardRows } from "../contexts/attendance/seedData.js";
import { replaceCatchupPriceRows, replaceRewardRows, upsertBookDef } from "../contexts/attendance/infrastructure/attendanceStore.js";

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

/** 각 마스터 데이터 컬렉션에 자연키 기준으로 upsert하고, 컨텐츠별 버전을 갱신한다. */
async function main() {
  const db = await connectMongo();

  await Promise.all(
    GRADE_CONFIGS.map(doc => db.collection(COLLECTIONS.MASTER_GRADE_CONFIGS).updateOne({ grade: doc.grade }, { $set: doc }, { upsert: true })),
  );
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_GRADE_CONFIGS);

  await Promise.all(
    buildCardTemplates().map(doc =>
      db.collection(COLLECTIONS.MASTER_CARD_TEMPLATES).updateOne({ templateId: doc.templateId }, { $set: doc }, { upsert: true }),
    ),
  );
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_CARD_TEMPLATES);

  await Promise.all(
    ENHANCEMENT_RULES.map(doc =>
      db
        .collection(COLLECTIONS.MASTER_ENHANCEMENT_RULES)
        .updateOne({ minTargetEnhancementLevel: doc.minTargetEnhancementLevel }, { $set: doc }, { upsert: true }),
    ),
  );
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_ENHANCEMENT_RULES);

  await Promise.all(
    SYNTHESIS_RULES.map(doc => {
      const key = doc.type === "gradeUpgrade" ? { type: doc.type, sourceGrade: doc.sourceGrade } : { type: doc.type };
      return db.collection(COLLECTIONS.MASTER_SYNTHESIS_RULES).updateOne(key, { $set: doc }, { upsert: true });
    }),
  );
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_SYNTHESIS_RULES);

  await Promise.all(
    buildStageConfigs().map(doc =>
      db
        .collection(COLLECTIONS.MASTER_STAGE_CONFIGS)
        // cardDropTable(구 필드)이 master_stage_card_drops 컬렉션으로 분리되며 남은 이전 문서를 정리한다.
        .updateOne({ stageId: doc.stageId }, { $set: doc, $unset: { cardDropTable: "" } }, { upsert: true }),
    ),
  );
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_STAGE_CONFIGS);

  await Promise.all(
    buildCardDropRules().map(doc =>
      db
        .collection(COLLECTIONS.MASTER_STAGE_CARD_DROPS)
        .updateOne({ stageId: doc.stageId, templateId: doc.templateId }, { $set: doc }, { upsert: true }),
    ),
  );
  await bumpMasterDataVersion(db, COLLECTIONS.MASTER_STAGE_CARD_DROPS);

  // 출석부 정의/보상/캐치업가격은 gm_platform이 운영 중 실시간으로 쓰는 컬렉션이라(
  // attendanceStore.ts 참고) 위 컬렉션들처럼 자연키로 직접 upsert하지 않고, 그 실시간
  // 쓰기 경로와 동일한 store 함수(버전 bump 포함)를 재사용한다.
  for (const spec of ATTENDANCE_BOOK_SEEDS) {
    await upsertBookDef(db, spec);
    await replaceRewardRows(db, spec.defId, buildAttendanceRewardRows(spec.durationDays));
    await replaceCatchupPriceRows(db, spec.defId, buildAttendanceCatchupPriceRows(spec.catchupMaxCount));
  }

  console.log("마스터 데이터 시드 완료");
  await mongoClient.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
