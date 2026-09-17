/**
 * 서버 로컬 타임존 기준 오늘 날짜(YYYY-MM-DD)를 반환한다. `toISOString()`은 UTC라 로컬
 * 타임존과 날짜가 어긋날 수 있어 쓰지 않고, `getFullYear`/`getMonth`/`getDate` 로컬
 * 컴포넌트로 조립한다(만료 우편 정리 배치의 cutoff 계산, DAU 집계와 동일 패턴).
 * @param now 기준 시각(테스트 용도로만 주입, 기본값은 현재 시각)
 * @author trisakion
 */
export function todayDateString(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${date}`;
}

/**
 * YYYY-MM-DD 문자열에 일수를 더한다(출석부 인스턴스의 `endDate` 계산용 — `startDate` +
 * `durationDays`). 두 문자열 모두 같은 방식(로컬 컴포넌트)으로 만들어진다는 전제 하에
 * UTC 자정으로 파싱해 날짜 연산만 하고 다시 YYYY-MM-DD로 조립한다 — 로컬 타임존으로
 * 파싱하면 DST 경계에서 날짜가 밀릴 수 있어 피한다.
 * @param dateStr 기준 날짜(YYYY-MM-DD)
 * @param days 더할 일수
 * @author trisakion
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * 두 YYYY-MM-DD 문자열 사이의 일수 차이(`to` - `from`)를 계산한다 — 출석부 인스턴스의
 * `startDate` 대비 오늘이 몇 일차인지 계산하는 데 쓴다({@link addDaysToDateString}과 동일하게
 * UTC 자정 기준으로 파싱).
 * @param from 기준 날짜(YYYY-MM-DD)
 * @param to 비교 날짜(YYYY-MM-DD)
 * @author trisakion
 */
export function daysBetweenDateStrings(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}
