import type { Element } from "../../../shared-kernel/masterData/element.js";
import { elementMultiplier } from "../../../shared-kernel/masterData/element.js";

/** 라운드 상한 — 도달하면 미해결로 간주해 패배 처리한다(무한루프 방지, 임시값). */
const MAX_ROUNDS = 30;

/** 출전 카드 한 장의 전투 참여 스탯. */
export interface SquadMember {
  /** 원본 카드 ID(전투 결과를 응답에서 카드별로 구분하는 용도) */
  cardId: string;
  /** 성장 보너스가 적용된 공격력 */
  attack: number;
  /** 성장 보너스가 적용된 체력(스쿼드 공유 체력 풀에 합산됨) */
  hp: number;
  /** 원소 속성(몬스터와의 상성 판정에 쓰임) */
  element: Element;
}

/** 몬스터 스탯(`StageConfig`에서 그대로 옮겨온 값). */
export interface Monster {
  /** 몬스터 체력 */
  hp: number;
  /** 몬스터 공격력(스쿼드 공유 체력 풀에 매 라운드 고정 데미지로 들어감) */
  attack: number;
  /** 몬스터 방어력(스쿼드의 공격력에서 차감됨) */
  defense: number;
  /** 원소 속성(스쿼드와의 상성 판정에 쓰임) */
  element: Element;
}

/** 라운드 하나의 진행 로그 — 클라이언트가 턴 진행을 보여줄 수 있게 응답에 그대로 실어보낸다. */
export interface RoundLog {
  /** 라운드 번호(1부터 시작) */
  round: number;
  /** 이 라운드에 스쿼드가 몬스터에게 준 데미지 합 */
  damageDealtToMonster: number;
  /** 이 라운드가 끝난 시점의 몬스터 잔여 체력(0 이하는 0으로 표시) */
  monsterHpAfter: number;
  /** 이 라운드에 몬스터가 스쿼드에게 준 데미지(몬스터가 이미 죽었으면 0) */
  damageTakenBySquad: number;
  /** 이 라운드가 끝난 시점의 스쿼드 잔여 체력(0 이하는 0으로 표시) */
  squadHpAfter: number;
}

/** 전투 시뮬레이션 최종 결과. */
export interface BattleResult {
  /** 스쿼드 승리 여부(라운드 상한 도달 시에도 false) */
  won: boolean;
  /** 라운드별 진행 로그(1라운드부터 종료 라운드까지) */
  rounds: RoundLog[];
}

/**
 * 출전 스쿼드(공유 체력 풀) vs 몬스터의 턴제 전투를 시뮬레이션한다(GAME_DESIGN.md 6절 개정안).
 * 매 라운드 스쿼드가 먼저 몬스터에게 데미지를 주고(원소 상성 적용), 몬스터가 죽지 않았으면
 * 몬스터가 스쿼드 공유 체력 풀에 고정 데미지를 준다. 카드 단위 개별 생사는 다루지 않는다 —
 * 얻는 재미 대비 상태 관리 비용이 커서 지금은 스쿼드 총 체력 하나로 단순화한다.
 * @param squad 출전 카드 목록(1장 이상)
 * @param monster 대상 스테이지의 몬스터 스탯
 * @author trisakion
 */
export function simulateBattle(squad: SquadMember[], monster: Monster): BattleResult {
  let monsterHp = monster.hp;
  let squadHp = squad.reduce((sum, member) => sum + member.hp, 0);
  const rounds: RoundLog[] = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const damageDealtToMonster = squad.reduce((sum, member) => {
      const raw = Math.max(1, member.attack - monster.defense);
      return sum + Math.round(raw * elementMultiplier(member.element, monster.element));
    }, 0);
    monsterHp -= damageDealtToMonster;

    if (monsterHp <= 0) {
      rounds.push({ round, damageDealtToMonster, monsterHpAfter: 0, damageTakenBySquad: 0, squadHpAfter: squadHp });
      return { won: true, rounds };
    }

    const damageTakenBySquad = monster.attack;
    squadHp -= damageTakenBySquad;
    rounds.push({ round, damageDealtToMonster, monsterHpAfter: monsterHp, damageTakenBySquad, squadHpAfter: Math.max(0, squadHp) });

    if (squadHp <= 0) return { won: false, rounds };
  }

  return { won: false, rounds };
}
