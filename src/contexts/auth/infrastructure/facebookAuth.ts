import { BusinessException } from "../../../shared-kernel/businessException.js";
import { ERROR_MAP } from "../../../shared-kernel/errorMap.js";
import { config } from "../../../config/env.js";
import type { SocialAuthProvider, SocialProfile } from "./socialAuthProvider.js";

/** 사용하는 Graph API 버전 — 페이스북이 구버전을 순차 폐기하므로 필요해지면 여기만 올린다. */
const GRAPH_API_VERSION = "v21.0";

/**
 * Authorization Code Flow 첫 단계 — 사용자를 페이스북 로그인 동의 화면으로 보낼 URL을 만든다.
 * 구글과 달리 페이스북엔 서명된 ID 토큰을 주는 JS SDK 로그인 방식이 없어(Authorization Code
 * Flow 하나만 지원), 구글의 GIS/Authorization Code 이중 지원을 그대로 따라가지 않는다.
 * @param state CSRF 방지용 임의값 — 콜백에서 그대로 돌려받아 원 요청과 같은 브라우저인지 대조한다
 * @returns 페이스북 로그인 동의 화면 URL
 * @author trisakion
 */
export function generateFacebookAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: config.facebookAppId ?? "",
    redirect_uri: config.facebookRedirectUri ?? "",
    state,
    scope: "public_profile,email",
  });
  return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
}

/**
 * Authorization Code Flow 콜백 단계 — code를 access token으로 교환한 뒤 Graph API `/me`로
 * 프로필을 조회한다. 페이스북은 구글처럼 로컬에서 서명을 검증할 ID 토큰을 주지 않고 opaque
 * access token만 주므로, "검증"은 그 토큰으로 실제 Graph API 호출이 성공하는지로 대신한다 —
 * 만료/폐기된 토큰이면 이 호출 자체가 실패한다.
 * @param code 페이스북 콜백 쿼리로 받은 authorization code
 * @returns 검증된 페이스북 프로필
 * @throws {BusinessException} 교환/조회 실패 시 AUTH.INVALID_FACEBOOK_TOKEN
 * @author trisakion
 */
export async function exchangeFacebookAuthCode(code: string): Promise<SocialProfile> {
  try {
    const tokenParams = new URLSearchParams({
      client_id: config.facebookAppId ?? "",
      client_secret: config.facebookAppSecret ?? "",
      redirect_uri: config.facebookRedirectUri ?? "",
      code,
    });
    const tokenRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token?${tokenParams.toString()}`);
    const tokenBody = await tokenRes.json();
    if (!tokenRes.ok || typeof tokenBody.access_token !== "string") throw new Error(`token exchange failed: ${JSON.stringify(tokenBody)}`);

    const profileParams = new URLSearchParams({ fields: "id,name,email,picture", access_token: tokenBody.access_token });
    const profileRes = await fetch(`https://graph.facebook.com/me?${profileParams.toString()}`);
    const profile = await profileRes.json();
    if (!profileRes.ok || typeof profile.id !== "string") throw new Error(`profile fetch failed: ${JSON.stringify(profile)}`);

    return { sub: profile.id, name: profile.name, email: profile.email, picture: profile.picture?.data?.url };
  } catch (err) {
    throw new BusinessException(ERROR_MAP.AUTH.INVALID_FACEBOOK_TOKEN, err);
  }
}

/**
 * 페이스북 Authorization Code Flow를 `SocialAuthProvider` 인터페이스로 감싼 레지스트리 등록용
 * 객체 — `authRoutes.ts`가 토글 없이 항상 레지스트리에 등록한다.
 * @author trisakion
 */
export const facebookAuthProvider: SocialAuthProvider = {
  platformType: "facebook",
  generateAuthUrl: generateFacebookAuthUrl,
  exchangeAuthCode: exchangeFacebookAuthCode,
};
