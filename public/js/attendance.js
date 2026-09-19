import { apiGet, apiPost, escapeHtml } from "./api.js";

const STATE_LABEL = {
  ATTENDED: "수령",
  CATCHUP_AVAILABLE: "놓침",
  CATCHUP_UNAVAILABLE: "구매불가",
  TODAY: "오늘",
  FUTURE: "예정",
};

/** 재렌더(refreshPlayer)돼도 선택한 안쪽 탭이 유지되도록 모듈 변수로 둔다. */
let activeSub = "general";

/**
 * 보상 한 줄을 표시 문자열로 만든다.
 * @param {{itemType: string, amount: number, cardTemplateId: string|null}} reward 서버가 내려준 보상
 * @returns {string} 이스케이프 전 표시 문자열
 */
function rewardText(reward) {
  return reward.itemType === "card" ? `카드 ${reward.cardTemplateId} x${reward.amount}` : `${reward.itemType} ${reward.amount}`;
}

/**
 * 출석부 하나(달력 + 캐치업 안내)를 HTML로 만든다. 날짜 상태/캐치업 가능 여부는 전부 서버 계산
 * 결과를 그대로 쓴다(프론트 직접 계산 금지 — 23_GAME_DESIGN_ATTENDANCE.md).
 * @param {any} book `GET /attendance`의 AttendanceBookView
 * @returns {string} HTML
 */
function renderBook(book) {
  const { catchup } = book;
  const info =
    catchup.nextPrice === null
      ? "캐치업 구매 횟수를 모두 사용했습니다"
      : `캐치업 ${catchup.nextPrice}골드 (남은 ${catchup.remainingPurchases}회)${catchup.canAfford ? "" : " — 골드 부족"}`;
  const cells = book.days
    .map(
      day => `
    <div class="attendanceDay ${escapeHtml(day.state)}">
      <b>${day.day}일차</b> <small>${STATE_LABEL[day.state]}</small>
      <div>${day.rewards.map(r => escapeHtml(rewardText(r))).join(", ")}</div>
      ${
        day.state === "CATCHUP_AVAILABLE"
          ? `<button type="button" class="catchupButton" data-def-id="${escapeHtml(book.defId)}" data-day="${day.day}" ${catchup.canAfford ? "" : "disabled"}>구매</button>`
          : ""
      }
    </div>`,
    )
    .join("");
  return `
    <h3>${escapeHtml(book.name)} (${escapeHtml(book.startDate)} ~ ${escapeHtml(book.endDate)})</h3>
    <p>${escapeHtml(info)}</p>
    <div class="attendanceGrid">${cells}</div>`;
}

/**
 * 출석 탭 — `GET /attendance`로 일반/이벤트 출석부를 달력으로 그리고, 놓친 날짜에 캐치업 구매
 * 버튼을 붙인다. 구매 성공/실패 결과 메시지는 재렌더 이후 새로 잡은 엘리먼트에 채운다(coupon.js와
 * 동일 패턴 — refresh 전에 채우면 재렌더로 지워진다).
 * @param {unknown} _state 다른 탭 렌더 함수와 시그니처를 맞추기 위한 자리(출석 상태는 자체 fetch)
 * @param {() => Promise<void>} refreshPlayer 구매 후 헤더/우편함까지 함께 갱신하는 공용 함수
 * @author trisakion
 */
export async function renderAttendance(_state, refreshPlayer) {
  const panel = document.getElementById("attendancePanel");
  const { general, events } = await apiGet("/attendance");

  panel.innerHTML = `
    <button type="button" class="subTab" data-sub="general">일반</button>
    <button type="button" class="subTab" data-sub="event">이벤트</button>
    <div id="attendanceGeneral" ${activeSub === "general" ? "" : "hidden"}>${general ? renderBook(general) : "출석부가 없습니다."}</div>
    <div id="attendanceEvent" ${activeSub === "event" ? "" : "hidden"}>${events.length ? events.map(renderBook).join("") : "진행 중인 이벤트 출석부가 없습니다."}</div>
    <p id="attendanceMessage"></p>
  `;

  panel.querySelectorAll(".subTab").forEach(button => {
    button.addEventListener("click", () => {
      activeSub = button.dataset.sub;
      document.getElementById("attendanceGeneral").hidden = activeSub !== "general";
      document.getElementById("attendanceEvent").hidden = activeSub !== "event";
    });
  });

  panel.querySelectorAll(".catchupButton").forEach(button => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const { price } = await apiPost(`/attendance/${encodeURIComponent(button.dataset.defId)}/catchup`, { day: Number(button.dataset.day) });
        await refreshPlayer();
        document.getElementById("attendanceMessage").textContent = `${button.dataset.day}일차 캐치업 구매 완료 (${price}골드). 우편함에서 보상을 받아주세요.`;
      } catch (err) {
        document.getElementById("attendanceMessage").textContent = `오류: ${err.message}`;
        button.disabled = false;
      }
    });
  });
}
