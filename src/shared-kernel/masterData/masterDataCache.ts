import type { Db } from "mongodb";
import type { CardTemplate } from "./cardTemplate.js";
import type { EnhancementRule } from "../../contexts/enhancement/domain/enhancementRule.js";
import type { Grade } from "./grade.js";
import type { GradeConfig } from "./gradeConfig.js";
import { MASTER_DATA_CONTENTS } from "./masterDataContent.js";
import type { MasterDataContent } from "./masterDataContent.js";
import type { StageConfig } from "../../contexts/battleStage/domain/stageConfig.js";
import type { CardDropEntry, CardDropRuleDoc } from "../../contexts/battleStage/domain/cardDrop.js";
import type { SynthesisRule } from "../../contexts/synthesis/domain/synthesisRule.js";

/**
 * `master_data_meta` 컬렉션 문서 형태 — 컨텐츠(컬렉션)당 1개, 폴링 폴백이 이 DB 버전과
 * 캐시가 적재해둔 버전을 비교해 어긋나면 강제 리로드한다.
 * @author trisakion
 */
export interface MasterDataMetaDocument {
  /** 대상 마스터 데이터 컨텐츠(컬렉션 이름) */
  content: MasterDataContent;
  /** 쓰기 시 `$inc`로 증가하는 버전 — 캐시의 메모리 버전과 비교해 어긋남을 감지하는 용도 */
  version: number;
}

/**
 * 마스터 데이터 인메모리 캐시. 서버 기동 시 5개 마스터 데이터 컬렉션 전체를 적재해두고,
 * Change Stream/폴링이 변경분만 골라 {@link MasterDataCache.reload}로 갱신한다. 애플리케이션
 * 서비스 계층은 매 요청마다 DB를 조회하지 않고 이 싱글톤의 getter만 호출한다.
 * @author trisakion
 */
class MasterDataCache {
  private cardTemplates = new Map<string, CardTemplate>();
  private gradeConfigs = new Map<Grade, GradeConfig>();
  private enhancementRules: EnhancementRule[] = [];
  private synthesisRules: SynthesisRule[] = [];
  private stageConfigs = new Map<number, StageConfig>();
  private cardDropRules = new Map<number, CardDropEntry[]>();
  private versions = new Map<MasterDataContent, number>();

  /**
   * 6개 마스터 데이터 컬렉션 + 버전 메타를 전부 읽어 캐시를 채운다. 서버 부트스트랩에서
   * 한 번 호출한다.
   * @param db 메인 앱 DB 핸들
   */
  async loadAll(db: Db): Promise<void> {
    await Promise.all(MASTER_DATA_CONTENTS.map(content => this.reload(db, content)));
  }

  /**
   * 컨텐츠(컬렉션) 하나만 다시 읽어 해당 부분만 교체한다. Change Stream 이벤트 핸들러와
   * 폴링 폴백이 공통으로 이 메서드를 재사용해, 캐시 갱신 로직이 두 곳에 중복되지 않게 한다.
   * @param db 메인 앱 DB 핸들
   * @param content 갱신할 컨텐츠 종류
   */
  async reload(db: Db, content: MasterDataContent): Promise<void> {
    switch (content) {
      case "master_card_templates": {
        const docs = await db.collection<CardTemplate>("master_card_templates").find().toArray();
        this.cardTemplates = new Map(docs.map(doc => [doc.templateId, doc]));
        break;
      }
      case "master_grade_configs": {
        const docs = await db.collection<GradeConfig>("master_grade_configs").find().toArray();
        this.gradeConfigs = new Map(docs.map(doc => [doc.grade, doc]));
        break;
      }
      case "master_enhancement_rules": {
        this.enhancementRules = await db.collection<EnhancementRule>("master_enhancement_rules").find().toArray();
        break;
      }
      case "master_synthesis_rules": {
        this.synthesisRules = await db.collection<SynthesisRule>("master_synthesis_rules").find().toArray();
        break;
      }
      case "master_stage_configs": {
        const docs = await db.collection<StageConfig>("master_stage_configs").find().toArray();
        this.stageConfigs = new Map(docs.map(doc => [doc.stageId, doc]));
        break;
      }
      case "master_stage_card_drops": {
        const docs = await db.collection<CardDropRuleDoc>("master_stage_card_drops").find().toArray();
        const grouped = new Map<number, CardDropEntry[]>();
        for (const doc of docs) {
          const table = grouped.get(doc.stageId) ?? [];
          table.push({ templateId: doc.templateId, weight: doc.weight });
          grouped.set(doc.stageId, table);
        }
        this.cardDropRules = grouped;
        break;
      }
      default: {
        // MasterDataContent에 새 컨텐츠가 추가됐는데 case를 안 늘리면 여기서 컴파일 에러가 난다.
        const exhaustiveCheck: never = content;
        throw new Error(`처리하지 않은 마스터 데이터 컨텐츠: ${exhaustiveCheck as string}`);
      }
    }

    const meta = await db.collection<MasterDataMetaDocument>("master_data_meta").findOne({ content });
    this.versions.set(content, meta?.version ?? 0);
  }

  /** @returns 현재 캐시가 적재해둔, 폴링 비교용 컨텐츠별 버전 스냅샷 */
  getVersions(): ReadonlyMap<MasterDataContent, number> {
    return this.versions;
  }

  /**
   * @param templateId 조회할 카드 원형 ID
   * @returns 해당 카드 템플릿, 없으면 undefined
   */
  getCardTemplate(templateId: string): CardTemplate | undefined {
    return this.cardTemplates.get(templateId);
  }

  /**
   * @param grade 조회할 카드 등급
   * @returns 해당 등급의 성장 상한 설정, 없으면 undefined
   */
  getGradeConfig(grade: Grade): GradeConfig | undefined {
    return this.gradeConfigs.get(grade);
  }

  /**
   * 목표 강화 단계가 속한 구간 규칙을 찾는다.
   * @param targetLevel 시도 대상 목표 강화 단계({@link Card.enhancementLevel}+1)
   * @returns 해당 구간의 강화 규칙, 없으면 undefined
   */
  getEnhancementRuleFor(targetLevel: number): EnhancementRule | undefined {
    return this.enhancementRules.find(
      rule => targetLevel >= rule.minTargetEnhancementLevel && targetLevel <= rule.maxTargetEnhancementLevel,
    );
  }

  /** @returns 전체 합성 규칙 목록 */
  getSynthesisRules(): readonly SynthesisRule[] {
    return this.synthesisRules;
  }

  /**
   * @param grade 조회할 카드 등급
   * @returns 해당 등급에 속한 카드 원형 전체(등급 승급 합성 성공 시 결과 원형을 이 중에서 무작위로 고른다)
   */
  getCardTemplatesByGrade(grade: Grade): CardTemplate[] {
    return [...this.cardTemplates.values()].filter(template => template.grade === grade);
  }

  /**
   * @param stageId 조회할 스테이지 번호
   * @returns 해당 스테이지 설정, 없으면 undefined
   */
  getStageConfig(stageId: number): StageConfig | undefined {
    return this.stageConfigs.get(stageId);
  }

  /**
   * @param stageId 조회할 스테이지 번호
   * @returns 해당 스테이지의 카드 드랍 테이블(없으면 빈 배열)
   */
  getCardDropTable(stageId: number): CardDropEntry[] {
    return this.cardDropRules.get(stageId) ?? [];
  }

  /** @returns 전체 카드 원형 목록(GM 마스터데이터 조회용) */
  getAllCardTemplates(): CardTemplate[] {
    return [...this.cardTemplates.values()];
  }

  /** @returns 전체 등급 설정 목록(GM 마스터데이터 조회용) */
  getAllGradeConfigs(): GradeConfig[] {
    return [...this.gradeConfigs.values()];
  }

  /** @returns 전체 강화 규칙 목록(GM 마스터데이터 조회용) */
  getAllEnhancementRules(): EnhancementRule[] {
    return this.enhancementRules;
  }

  /** @returns 전체 스테이지 설정 목록(GM 마스터데이터 조회용) */
  getAllStageConfigs(): StageConfig[] {
    return [...this.stageConfigs.values()];
  }

  /**
   * `Map<stageId, CardDropEntry[]>`로 그룹핑된 캐시를 DB 원본 문서 형태((stageId, templateId,
   * weight) 행 단위)로 다시 평탄화한다 — GM 조회는 캐시의 조회 최적화 구조가 아니라 원본
   * 컬렉션 행 그대로를 보여줘야 하기 때문.
   * @returns 전체 스테이지 카드 드랍 규칙 목록(GM 마스터데이터 조회용)
   */
  getAllCardDropRules(): CardDropRuleDoc[] {
    return [...this.cardDropRules.entries()].flatMap(([stageId, entries]) =>
      entries.map(entry => ({ stageId, ...entry })),
    );
  }
}

/** 프로젝트 전역에서 공유하는 마스터 데이터 캐시 싱글톤. */
export const masterDataCache = new MasterDataCache();
