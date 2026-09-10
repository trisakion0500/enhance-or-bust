import { apiPost, escapeHtml } from "./api.js";

/**
 * 강화 탭 — 보유 카드마다 강화 버튼을 붙여 `POST /enhancement/:cardId`를 호출하고, 결과(성공/
 * 파괴 여부, 강화 단계, 남은 재화)를 텍스트로 그대로 보여준다(최소 UI 원칙). 성공/실패 여부와
 * 무관하게 재화는 소모되므로 매 시도 후 `refreshPlayer()`로 헤더(재화)까지 함께 갱신한다.
 * @param {{player: {inventory: Array<Record<string, unknown>>}}} state 공유 앱 상태
 * @param {() => Promise<void>} refreshPlayer 시도 후 헤더/인벤토리/전투/우편함까지 함께 갱신하는 공용 함수
 * @author trisakion
 */
export function renderEnhancement(state, refreshPlayer) {
  const panel = document.getElementById("enhancementPanel");
  const cards = state.player.inventory;

  if (cards.length === 0) {
    panel.textContent = "보유한 카드가 없습니다.";
    return;
  }

  panel.innerHTML = cards
    .map(
      c => `
    <div class="enhancementRow">
      <span>${escapeHtml(c.templateId)}(${escapeHtml(c.grade)}) +${c.enhancementLevel}</span>
      <button type="button" class="enhanceButton" data-card-id="${escapeHtml(c.cardId)}">강화</button>
      <span class="enhanceMessage"></span>
    </div>
  `,
    )
    .join("");

  panel.querySelectorAll(".enhanceButton").forEach(button => {
    button.addEventListener("click", async () => {
      const cardId = button.dataset.cardId;
      try {
        const result = await apiPost(`/enhancement/${cardId}`, undefined);
        const message = result.destroyed
          ? "카드가 파괴되었습니다."
          : result.success
            ? `성공! 현재 +${result.enhancementLevel}`
            : `실패. 현재 +${result.enhancementLevel}`;
        await refreshPlayer();
        // refreshPlayer()가 이 패널을 통째로 다시 그리므로, 메시지는 재렌더 이후 새로 잡은
        // 엘리먼트에 채워야 한다(파괴된 카드는 행 자체가 사라진다).
        if (result.destroyed) return;
        document.querySelector(`.enhanceButton[data-card-id="${CSS.escape(cardId)}"]`)
          .closest(".enhancementRow").querySelector(".enhanceMessage").textContent = message;
      } catch (err) {
        button.closest(".enhancementRow").querySelector(".enhanceMessage").textContent = `오류: ${err.message}`;
      }
    });
  });
}
