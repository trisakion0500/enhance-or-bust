import { apiPost, escapeHtml } from "./api.js";

/**
 * 랜덤박스(가챠) 탭 — 활성 상태인 등급비율/커스텀 상자 목록을 버튼으로 보여주고, 클릭하면
 * 다이아를 소모해 즉시 뽑기를 시도한다(강화/합성과 동일한 즉시 처리 액션, 우편을 거치지
 * 않음). 상자 목록/이름/가격은 `state.player.randomBoxes`(`GET /player/me`가 함께 내려줌,
 * 활성 상태만)에서 읽는다.
 * @param {{player: {randomBoxes: {gradeRateDefs: Array<Record<string, unknown>>, customDefs: Array<Record<string, unknown>>}}}} state 공유 앱 상태
 * @param {() => Promise<void>} refreshPlayer 뽑기 후 헤더/인벤토리까지 함께 갱신하는 공용 함수
 * @author trisakion
 */
export function renderRandomBox(state, refreshPlayer) {
  const panel = document.getElementById("randomBoxPanel");
  const { gradeRateDefs, customDefs } = state.player.randomBoxes;

  const boxButton = (boxType, box) =>
    `<button type="button" class="randomBoxButton" data-box-type="${boxType}" data-box-id="${escapeHtml(box.boxId)}">
      ${escapeHtml(box.name)} (다이아 ${box.diamondCost})
    </button>`;

  panel.innerHTML = `
    <fieldset>
      <legend>등급비율 상자</legend>
      ${gradeRateDefs.length ? gradeRateDefs.map(box => boxButton("grade-rate", box)).join("") : "<p>현재 뽑을 수 있는 상자가 없습니다.</p>"}
    </fieldset>
    <fieldset>
      <legend>커스텀 상자</legend>
      ${customDefs.length ? customDefs.map(box => boxButton("custom", box)).join("") : "<p>현재 뽑을 수 있는 상자가 없습니다.</p>"}
    </fieldset>
    <p id="randomBoxMessage"></p>
  `;

  panel.querySelectorAll(".randomBoxButton").forEach(button => {
    button.addEventListener("click", async () => {
      const { boxType, boxId } = button.dataset;
      button.disabled = true;
      try {
        const result = await apiPost(`/random-box/${boxType}/${boxId}/draw`, undefined);
        // refreshPlayer()가 이 패널을 통째로 다시 그리므로, 메시지는 재렌더 이후 새로 잡은 엘리먼트에 채운다.
        await refreshPlayer();
        document.getElementById("randomBoxMessage").textContent = `뽑기 성공! 획득: ${result.resultTemplateId}`;
      } catch (err) {
        document.getElementById("randomBoxMessage").textContent = `오류: ${err.message}`;
        button.disabled = false;
      }
    });
  });
}
