import type { Element } from "../../shared-kernel/masterData/element.js";
import type { Grade } from "../../shared-kernel/masterData/grade.js";
import { buildCardTemplates } from "../../shared-kernel/masterData/seedData.js";
import type { CardDropRuleDoc } from "./domain/cardDrop.js";
import type { StageConfig } from "./domain/stageConfig.js";

/**
 * 몬스터 스탯 성장 공식(GAME_DESIGN.md 6절)의 기본값 — 구체 수치 미확정이라 쓰는 가이드 임시값.
 * 원래 50/5/2였으나, 신규 가입 시 지급되는 시작 카드가 딱 1장뿐인 현실에서 원래 값 기준으로는
 * 최약체 시작 카드(N등급 최저 공격력+불리 속성 조합)가 스테이지1부터 결정론적으로 패배하고
 * (전투에 라운드 내 확률 요소가 없어 재시도해도 결과가 똑같다), 평균적인 시작 카드도
 * 스테이지2에서 막히는 게 확인돼 절반으로 하향했다 — 1.15배 성장 공식 자체(GAME_DESIGN.md
 * 확정)는 그대로 두고 기준값만 낮춰, 시작 카드 1장으로도 초반 몇 스테이지는 확실히 뚫고
 * 카드 드랍/레벨업으로 이어갈 여지를 준다.
 */
const BASE_MONSTER_HP = 25;
const BASE_MONSTER_ATTACK = 2.5;
const BASE_MONSTER_DEFENSE = 1;
const MONSTER_GROWTH_RATE = 1.15;

/** 스테이지마다 순환 배정할 몬스터 원소. */
const ELEMENTS: Element[] = ["fire", "water", "grass"];

/** 카드 등급 확률(GAME_DESIGN.md 1절 N60/R30/SR8/SSR2)을 드랍 테이블 기본값으로 재사용. */
const GRADE_DROP_WEIGHT: Record<Grade, number> = { N: 60, R: 30, SR: 8, SSR: 2 };

/**
 * `master_stage_card_drops`(스테이지별 카드 드랍 가중치) 시드 행 100 × 40개를 만든다. 모든
 * 스테이지가 동일한 기본 테이블을 공유한다 — 등급 확률을 그대로 쓰되 같은 등급 안에서는
 * 템플릿 10개에 균등 분배한다(임시값, 실제 밸런싱은 추후). 스테이지별 커스텀은 이후
 * 운영툴/DB에서 개별 (stageId, templateId) 행만 덮어쓰면 된다.
 * @returns 카드 드랍 규칙 문서 목록
 * @author trisakion
 */
export function buildCardDropRules(): CardDropRuleDoc[] {
  const templates = buildCardTemplates();
  const countByGrade = templates.reduce<Record<string, number>>((acc, t) => {
    acc[t.grade] = (acc[t.grade] ?? 0) + 1;
    return acc;
  }, {});
  const rules: CardDropRuleDoc[] = [];
  for (let stageId = 1; stageId <= 100; stageId++) {
    for (const t of templates)
      rules.push({ stageId, templateId: t.templateId, weight: GRADE_DROP_WEIGHT[t.grade] / countByGrade[t.grade] });
  }
  return rules;
}

/**
 * @returns 100개 스테이지의 몬스터 스탯(지수 증가)과 보상(선형/확률, 임시값)
 * @author trisakion
 */
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
      cardDropRateFirstClear: 0.3,
      cardDropRateFarm: 0.15,
    });
  }
  return stages;
}
