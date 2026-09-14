import { apiPost } from "./api.js";

/**
 * 쿠폰 탭 — 쿠폰 코드를 입력해 `POST /coupon/redeem`을 호출한다. 보상은 스테이지 클리어
 * 보상과 동일하게 우편함으로 발송되고 즉시 인벤토리/재화에 반영되지 않으므로(CLAUDE.md
 * "coupon_platform 연동" 절), 이 탭은 사용 결과 메시지만 보여주고 실제 수령은 우편함 탭에서
 * 한다 — `refreshPlayer()`로 우편함 패널까지 함께 갱신해 방금 온 우편이 바로 보이게 한다.
 * @param {unknown} _state 다른 탭 렌더 함수와 시그니처를 맞추기 위한 자리(자체 상태 없음)
 * @param {() => Promise<void>} refreshPlayer 사용 후 헤더/우편함까지 함께 갱신하는 공용 함수
 * @author trisakion
 */
export function renderCoupon(_state, refreshPlayer) {
  const panel = document.getElementById("couponPanel");
  panel.innerHTML = `
    <form id="couponForm">
      <input type="text" id="couponCode" placeholder="쿠폰 코드" required />
      <button type="submit">사용</button>
    </form>
    <p id="couponMessage"></p>
  `;

  document.getElementById("couponForm").addEventListener("submit", async event => {
    event.preventDefault();
    const input = document.getElementById("couponCode");
    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const { attachments } = await apiPost("/coupon/redeem", { code: input.value });
      // refreshPlayer()가 renderCoupon()을 다시 불러 이 패널을 통째로 새로 그리므로(입력값도
      // 초기화됨), 결과 메시지는 재렌더 이후 새로 잡은 엘리먼트에 채워야 한다(enhancement.js와
      // 동일 패턴 — refresh 전에 채우면 재렌더로 곧바로 지워진다).
      await refreshPlayer();
      document.getElementById("couponMessage").textContent =
        `사용 완료! 우편함에서 보상을 받아주세요: ${JSON.stringify(attachments)}`;
    } catch (err) {
      document.getElementById("couponMessage").textContent = `오류: ${err.message}`;
      button.disabled = false;
    }
  });
}
