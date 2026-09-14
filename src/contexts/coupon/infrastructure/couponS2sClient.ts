import { createHmac, randomUUID } from "node:crypto";
import { config } from "../../../config/env.js";

/**
 * coupon_platform(별도 포트폴리오 프로젝트, https://github.com/trisakion0500/coupon_platform)이
 * 입점사(게임서버)용으로 그대로 제공하는 S2S 연동 SDK(`test_game_server/src/sdk/CouponS2sClient.ts`,
 * `docs/21_TEST_GAME_SERVER.md` 9장)를 가져와 이 프로젝트의 JSDoc 스타일에 맞게 정리한 것이다 —
 * reserve/confirm 서명·호출 로직은 원본과 동일하다. 원본에 있는 `getUnconfirmed()`(미확인 소모
 * 건 조회)는 이 프로젝트에서는 쓰지 않아 뺐다 — coupon_platform 재처리 배치는 그 API 대신 이
 * 레포 자체 `coupon_redemptions` 컬렉션(`couponRedemptionStore.ts`)을 소스 오브 트루스로 쓴다
 * (그 이유는 `couponService.ts`의 `redeemCoupon()` JSDoc 참고). **coupon_platform 리포 자체는
 * 절대 건드리지 않는다**(gm_platform 연동과 동일한 원칙, CLAUDE.md 참고) — 이 파일은 그쪽
 * 소스를 복사해온 것일 뿐, 이후 그 리포 소스를 수정하는 방식으로 동기화하지 않는다.
 *
 * 외부 의존성 0개(Node.js 22 내장 `crypto`+전역 `fetch`만 사용)이고, 서명 대상 문자열/헤더 4종은
 * `09_AUTH_SECURITY.md` 2.3의 규칙을 그대로 따른다.
 * @author trisakion
 */

export interface CouponS2sClientOptions {
  /** coupon_platform 서버 주소(끝에 슬래시 없이). */
  baseUrl: string;
  /** coupon_platform에 등록된 이 프로젝트의 api_key. */
  apiKey: string;
  /** 평문 api_secret — 프로젝트 생성/재발급 응답에 1회만 노출된 값을 그대로 사용한다. */
  apiSecret: string;
}

export interface CouponReserveResult {
  coupon_code_usage_id: number;
  coupon_campaign_id: number;
  code_value: string;
  game_user_id: string;
  reward_data: unknown;
  created_at: string;
}

export interface CouponConfirmResult {
  coupon_code_usage_id: number;
  confirmed_at: string;
}

/** `POST /v1/coupons/{code}/reserve`/`confirm`이 `{result!==0}`을 반환했을 때 던지는 에러. */
export class CouponApiError extends Error {
  constructor(
    public readonly resultCode: number,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "CouponApiError";
  }
}

/**
 * coupon_platform의 쿠폰 사용(reserve/confirm) API를 호출하는 S2S 클라이언트.
 * @author trisakion
 */
export class CouponS2sClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(options: CouponS2sClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
  }

  /**
   * `POST /v1/coupons/{code}/reserve` — 성공 시 즉시 최종 소모 확정이다(예약 중간 상태 없음).
   * `use_limit_per_user=1`인 캠페인은 동일 코드+동일 `gameUserId` 재시도 시 새로 소모하지 않고
   * 최초 성공 응답을 그대로 재반환한다(멱등) — 네트워크 타임아웃 후 재시도해도 안전하다.
   * @param codeValue 쿠폰 코드
   * @param gameUserId 플레이어 ID
   * @returns 소모 확정 결과(`reward_data` 포함)
   * @throws {CouponApiError} 코드 없음(31005)/이미 소모(33001)/캠페인 사용불가(33002)/한도초과(33003) 등
   * @author trisakion
   */
  async reserve(codeValue: string, gameUserId: string): Promise<CouponReserveResult> {
    return this.request<CouponReserveResult>(
      `/v1/coupons/${encodeURIComponent(codeValue)}/reserve`,
      { game_user_id: gameUserId },
    );
  }

  /**
   * `POST /v1/coupons/{code}/confirm` — 소모 확정은 reserve에서 이미 끝났고, 이건 지급 결과
   * 보고일 뿐이라 상태를 바꾸지 않는다. 여러 번 호출해도 무해(멱등)하다.
   * @param codeValue 쿠폰 코드
   * @param gameUserId 플레이어 ID
   * @author trisakion
   */
  async confirm(codeValue: string, gameUserId: string): Promise<CouponConfirmResult> {
    return this.request<CouponConfirmResult>(
      `/v1/coupons/${encodeURIComponent(codeValue)}/confirm`,
      { game_user_id: gameUserId },
    );
  }

  /**
   * 서명 생성 + HTTP 호출 + 응답 파싱을 담당하는 내부 헬퍼(09_AUTH_SECURITY.md 2.3의
   * `stringToSign` 규칙 그대로). 3개 엔드포인트 전부 POST+바디라 메서드는 항상 POST다.
   * @author trisakion
   */
  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const bodyString = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomUUID();
    const stringToSign = ["POST", path, "", timestamp, nonce, bodyString].join("\n");
    const signature = createHmac("sha256", this.apiSecret).update(stringToSign).digest("hex");

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
        "X-API-Timestamp": timestamp,
        "X-API-Nonce": nonce,
        "X-API-Signature": signature,
      },
      body: bodyString,
    });

    const json = (await response.json()) as { result: number; data?: T; message?: string };
    if (json.result !== 0)
      throw new CouponApiError(json.result, response.status, json.message ?? `coupon API error (result=${json.result})`);

    return json.data as T;
  }
}

/**
 * `.env`의 coupon_platform 접속 정보로 `CouponS2sClient`를 만든다. 라우트(`couponRoutes.ts`)와
 * 재처리 배치(`index.ts`) 양쪽이 같은 방식으로 클라이언트를 구성해야 해서 한 곳으로 모은다.
 * @author trisakion
 */
export function createCouponS2sClient(): CouponS2sClient {
  return new CouponS2sClient({
    baseUrl: config.couponPlatformBaseUrl ?? "",
    apiKey: config.couponPlatformApiKey ?? "",
    apiSecret: config.couponPlatformApiSecret ?? "",
  });
}
