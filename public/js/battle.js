import { apiPost } from "./api.js";

/**
 * 전투 탭 — 스테이지 번호 + 출전 스쿼드(최대 5장)를 골라 `POST /battle-stage/:id/clear`를
 * 호출하고, 결과(승패/라운드 로그/보상)를 텍스트로 그대로 보여준다(최소 UI 원칙, 애니메이션 없음).
 * @param {{player: {clearedStage: number, inventory: Array<Record<string, unknown>>}}} state 공유 앱 상태
 * @param {() => Promise<void>} refreshPlayer 도전 후 헤더/인벤토리/우편함까지 함께 갱신하는 공용 함수
 * @author trisakion
 */
export function renderBattle(state, refreshPlayer) {
  const panel = document.getElementById("battlePanel");
  const { clearedStage, inventory } = state.player;
  const nextStage = clearedStage + 1;

  const checkboxes = inventory
    .map(c => `<label><input type="checkbox" name="squad" value="${c.cardId}"> ${c.templateId}(Lv${c.level}, ${c.grade})</label>`)
    .join("<br>");

  panel.innerHTML = `
    <p>클리어한 최대 스테이지: ${clearedStage} (도전 가능: 1~${nextStage})</p>
    <label>스테이지 번호 <input type="number" id="stageInput" min="1" max="${nextStage}" value="${nextStage}"></label>
    <fieldset><legend>출전 스쿼드(최대 5장)</legend>${checkboxes || "보유 카드가 없습니다."}</fieldset>
    <button type="button" id="challengeButton">도전</button>
    <pre id="battleResult"></pre>
  `;

  document.getElementById("challengeButton").addEventListener("click", async () => {
    const stageId = Number(document.getElementById("stageInput").value);
    const squadCardIds = Array.from(panel.querySelectorAll('input[name="squad"]:checked')).map(el => el.value);
    try {
      const result = await apiPost(`/battle-stage/${stageId}/clear`, { squadCardIds });
      // refreshPlayer()가 이 패널을 통째로 다시 그리므로, 결과 텍스트는 재렌더 이후 새로 잡은
      // 엘리먼트에 채워야 한다 — 지금 시점의 #battleResult는 재렌더로 곧 DOM에서 떨어져나간다.
      await refreshPlayer();
      document.getElementById("battleResult").textContent = JSON.stringify(result, null, 2);
    } catch (err) {
      document.getElementById("battleResult").textContent = `오류: ${err.message}`;
    }
  });
}
