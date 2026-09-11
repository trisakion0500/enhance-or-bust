import { apiPost, escapeHtml } from "./api.js";

/**
 * 도전 후 `refreshPlayer()`가 패널을 통째로 다시 그리므로, 체크 상태를 DOM이 아니라 이 모듈
 * 스코프에 별도로 들고 있어야 재렌더 후에도 유지된다.
 */
const selectedCardIds = new Set();

/**
 * 마지막으로 도전한 스테이지 번호 — 재렌더 후 입력값을 여기서 복원한다. null이면 아직 도전
 * 이력이 없어 기본값(다음 스테이지)을 쓴다.
 */
let lastStageId = null;

/**
 * 전투 탭 — 스테이지 번호 + 출전 스쿼드(최대 `squadMaxSize`장)를 골라
 * `POST /battle-stage/:id/clear`를 호출하고, 결과(승패/라운드 로그/보상)를 텍스트로 그대로
 * 보여준다(최소 UI 원칙, 애니메이션 없음).
 * @param {{player: {clearedStage: number, inventory: Array<Record<string, unknown>>, squadMaxSize: number}}} state 공유 앱 상태
 * @param {() => Promise<void>} refreshPlayer 도전 후 헤더/인벤토리/우편함까지 함께 갱신하는 공용 함수
 * @author trisakion
 */
export function renderBattle(state, refreshPlayer) {
  const panel = document.getElementById("battlePanel");
  const { clearedStage, inventory, squadMaxSize } = state.player;
  const nextStage = clearedStage + 1;
  const stageValue = lastStageId ?? nextStage;

  // 다른 탭(합성 등)에서 소모/파괴돼 인벤토리에서 사라진 카드는 선택 상태에서도 지운다 —
  // 안 지우면 유령 항목이 squadMaxSize 카운트를 계속 차지해 새 카드를 못 고르게 된다.
  const currentCardIds = new Set(inventory.map(c => c.cardId));
  for (const cardId of selectedCardIds) if (!currentCardIds.has(cardId)) selectedCardIds.delete(cardId);

  const checkboxes = inventory
    .map(c => `<label><input type="checkbox" name="squad" value="${escapeHtml(c.cardId)}" ${selectedCardIds.has(c.cardId) ? "checked" : ""}> ${escapeHtml(c.templateId)}(Lv${c.level}, ${escapeHtml(c.grade)})</label>`)
    .join("<br>");

  panel.innerHTML = `
    <p>클리어한 최대 스테이지: ${clearedStage} (도전 가능: 1~${nextStage})</p>
    <label>스테이지 번호 <input type="number" id="stageInput" min="1" max="${nextStage}" value="${stageValue}"></label>
    <fieldset><legend>출전 스쿼드(최대 ${squadMaxSize}장)</legend>${checkboxes || "보유 카드가 없습니다."}</fieldset>
    <button type="button" id="challengeButton">도전</button>
    <pre id="battleResult"></pre>
  `;

  panel.querySelectorAll('input[name="squad"]').forEach(checkbox => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked && selectedCardIds.size >= squadMaxSize) {
        checkbox.checked = false; // 최대 장수 초과 시도 — 체크를 되돌려 막는다
        return;
      }
      if (checkbox.checked) selectedCardIds.add(checkbox.value);
      else selectedCardIds.delete(checkbox.value);
    });
  });

  document.getElementById("challengeButton").addEventListener("click", async () => {
    const stageId = Number(document.getElementById("stageInput").value);
    const wasLastChallengeable = stageId === nextStage;
    const squadCardIds = Array.from(panel.querySelectorAll('input[name="squad"]:checked')).map(el => el.value);
    try {
      const result = await apiPost(`/battle-stage/${stageId}/clear`, { squadCardIds });
      // 도전한 스테이지가 그 시점의 마지막 도전 가능 스테이지였고 승리했다면 다음 스테이지로,
      // 아니면(파밍 재도전이었거나 패배했으면) 같은 스테이지에 머문다 — 반복 도전 UX.
      lastStageId = wasLastChallengeable && result.won ? stageId + 1 : stageId;
      // refreshPlayer()가 이 패널을 통째로 다시 그리므로, 결과 텍스트는 재렌더 이후 새로 잡은
      // 엘리먼트에 채워야 한다 — 지금 시점의 #battleResult는 재렌더로 곧 DOM에서 떨어져나간다.
      await refreshPlayer();
      document.getElementById("battleResult").textContent = JSON.stringify(result, null, 2);
    } catch (err) {
      lastStageId = stageId; // 실패해도 같은 스테이지에 머문다
      document.getElementById("battleResult").textContent = `오류: ${err.message}`;
    }
  });
}
