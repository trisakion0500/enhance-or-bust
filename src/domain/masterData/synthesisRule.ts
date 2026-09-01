import type { Grade } from "./grade.js";

/** 등급 승급 합성 — 동일 등급 카드 N장 소모 → 상위 등급 카드 1장(확률적). */
export interface GradeUpgradeSynthesisRule {
  /** 규칙 종류 판별 태그 */
  type: "gradeUpgrade";
  /** 소재로 소모할 카드 등급 */
  sourceGrade: Grade;
  /** 성공 시 얻는 카드 등급 */
  resultGrade: Grade;
  /** 소모할 소재 카드 장수 */
  materialCount: number;
  /** 승급 성공 확률(0~1) */
  successRate: number;
}

/**
 * 강화 재료 합성 — 대상 카드와는 별개로, 동일 원형 재료 카드 N장을 골드와 함께 소모해
 * 대상 카드의 강화 단계를 +1 시킨다(100% 성공, 파괴 없음). 대상 카드 자체는 소모되지
 * 않으며 이 규칙 데이터에도 포함되지 않는다 — 어떤 카드를 대상으로 할지는 합성 요청 시점의
 * 런타임 파라미터다.
 */
export interface EnhanceMaterialSynthesisRule {
  /** 규칙 종류 판별 태그 */
  type: "enhanceMaterial";
  /** 대상 카드 외에 추가로 소모할 동일 원형 재료 카드 장수(대상 카드는 포함하지 않음) */
  materialCount: number;
  /** 함께 소모할 골드 */
  goldCost: number;
}

/**
 * 합성 규칙 마스터 데이터(`synthesis_rules` 컬렉션). 레시피 종류(등급 승급/강화 재료)가
 * 서로 다른 필드를 가져 판별 유니온으로 표현한다.
 * @author trisakion
 */
export type SynthesisRule = GradeUpgradeSynthesisRule | EnhanceMaterialSynthesisRule;
