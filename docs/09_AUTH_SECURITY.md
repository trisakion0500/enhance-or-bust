# 09_AUTH_SECURITY.md

플레이어 인증(소셜 로그인 + 세션)과 서버 간(gm_platform) 인증 정책.

## 소셜 로그인만 지원

로그인/회원가입은 구글/페이스북 소셜 로그인만 지원한다 — 별도 회원가입 폼이나
비밀번호가 없다(비밀번호 해싱/저장 자체가 이 프로젝트에는 해당 없음).

### 구글 — 두 플로우 모두 지원(`GOOGLE_AUTH_FLOW`로 택일)

학습 목적으로 둘 다 구현해뒀다(운영상 필요해서 나뉜 게 아니다).

- **`id_token`**(기본값, Google Identity Services): 프론트가 구글 ID 토큰을 받아
  `POST /auth/google`로 전달.
- **`authorization_code`**: `GET /auth/google/login` → 구글 동의 화면 → `GET
  /auth/google/callback`(`code`+`state` CSRF 검증) → 서버가 `GOOGLE_CLIENT_SECRET`으로
  code를 토큰과 교환. Client Secret은 서버만 보관, 프론트에 노출하지 않는다.

두 플로우 모두 최종적으로 `google-auth-library`의 `verifyIdToken()`으로 서명/audience를
검증해 `sub`를 추출한다 — **클라이언트가 주장하는 값이 아니라 토큰 자체를 서버가
검증**한다(서버 권위 원칙).

### 페이스북 — Authorization Code Flow 하나만

페이스북엔 구글 GIS에 대응하는 서명된 ID 토큰 발급 수단이 없어(opaque access token만
줌) 이중 플로우가 성립하지 않는다. "검증"은 서명 확인이 아니라 access token으로 실제
Graph API(`/me`)를 호출해봐서 성공하는지로 대신한다. 공식 Node SDK가 없어 Node 22
전역 `fetch`로 REST 호출 2번(코드 교환, 프로필 조회)만 직접 구현했다.

### 확장 포인트 — `SocialAuthProvider` 인터페이스

리다이렉트 기반 프로바이더(구글 authorization_code, 페이스북, 향후 확장분)는
`socialAuthProvider.ts`의 `SocialAuthProvider` 인터페이스(`{platformType,
generateAuthUrl(state), exchangeAuthCode(code)}`)로 다형성을 둔다. 새 프로바이더 추가 시
손댈 범위는 (1) `config/env.ts`에 자격증명, (2) 새 infra 모듈 하나, (3)
`authRoutes.ts`의 레지스트리 배열에 한 줄 — 라우트/`authService.ts`는 더 건드리지 않는다.

## 내부 식별자 분리 — `playerId` ≠ 프로바이더 값

`Player.playerId`는 구글 `sub`/페이스북 `id`를 그대로 쓰지 않고 `randomUUID()`로
발급한다. `(platformType, platformUserId)` 복합 unique 인덱스로 로그인 조회를 한다
(`findByPlatform`). 로그인 수단이 늘거나 계정 연결 기능이 추가돼도 `playerId` 체계
자체는 영향받지 않는다. 현재는 같은 사람이 구글/페이스북 각각으로 로그인하면 서로 다른
Player가 생성된다(계정 연결 기능 없음).

## 가입 보류 흐름 (닉네임 입력 전까지 Player 미생성)

최초 로그인은 소셜 인증만으로 바로 Player를 만들지 않는다. 처음 보는
`(platformType, platformUserId)`면 소셜 프로필을 Redis에 **10분 TTL**로 보류하고
가입 보류 토큰만 반환한다 — 이 토큰은 URL이 아니라 **httpOnly 쿠키**
(`pendingRegistrationToken`)로만 오간다(리퍼러로 새는 것을 피함). 닉네임 제출
(`POST /auth/register/complete`) 전까지는 아무것도 DB에 저장되지 않아, 이탈해도 데이터
손실 없이 Redis TTL로 조용히 사라진다.

- 동시 가입 완료 레이스로 unique 인덱스 중복 에러(11000)가 나면 조용히 무시하고,
  호출부가 `findByPlatform`으로 실제 저장된 `playerId`를 다시 조회해 세션을 발급한다.

## 세션

랜덤 opaque 토큰을 발급해 Redis에 `session:<token> → playerId` 형태로 TTL(기본 7일,
`SESSION_TTL_SEC`)과 함께 저장한다. JWT처럼 자체 서명된 토큰이 아니라 Redis에서 지우면
즉시 무효화할 수 있다. **httpOnly 쿠키**(`sessionToken`)로 내려주며, 프론트와 API를
같은 오리진에서 서빙해 CORS 설정이 필요 없다.

`requireAuth` 미들웨어(`shared-kernel/sessionAuth.ts`)가 쿠키를 Redis 세션과 대조해
`req.playerId`를 세팅한다 — 전역 `app.use`가 아니라 보호가 필요한 라우터에 개별 적용.

로그아웃(`POST /auth/logout`)은 `requireAuth`를 붙이지 않고 세션이 없거나 만료됐어도
그냥 성공 처리한다(멱등).

## 서버 간(S2S) 인증 — gm_platform 연동

세션 쿠키가 아니라 `X-API-Key` 헤더(`GM_PLATFORM_API_KEY` env)로 인증한다. 비교는
`timingSafeEqual`로 수행(타이밍 공격 방지). 헤더가 없거나 값이 일치하지 않으면 이유를
구분하지 않고 전부 `GM.UNAUTHORIZED`(10001)로 응답한다.

`gmApiKeyAuth` 미들웨어는 `router.use()`로 전체에 걸지 않고 라우트별로 개별 적용한다 —
`gmRoutes`가 프리픽스 없이 `app.use()`로 마운트되는 구조상, 다른 컨텍스트 라우터의
`router.use(requireAuth)`가 경로 매칭과 무관하게 먼저 걸려버리는 문제가 있어서다. 그래서
`gmRoutes`를 다른 라우터보다 먼저 마운트한다. 상세는 `18_GM_PLATFORM_INTEGRATION.md`.

이 연동은 HMAC 서명 + Nonce/Timestamp 재전송 방지 같은 정교한 S2S 보안까지는 쓰지 않는다
— gm_platform과 enhanceOrBust는 서로 별개로 개발한(연동 관계가 없는) 개인 포트폴리오
프로젝트라, 정적 API Key 대조만으로 충분하다고 판단한 범위다. 결제/쿠폰류처럼 외부에
노출되는 S2S와는 위협 모델이 다르다.

## 웹 취약점 방어

- **XSS**: `innerHTML`로 동적 값을 꽂는 모든 지점(카드 등급/원형ID/속성, 우편
  제목/첨부/mailId 등)은 `public/js/api.js`의 `escapeHtml()`로 이스케이프한다.
- **인증 쿠키**: `sessionToken`/`pendingRegistrationToken` 모두 httpOnly.
- **CSRF**: OAuth 콜백(`state` 쿠키 검증)에는 자체 CSRF 방어가 있다. 상태를 바꾸는
  일반 API는 별도 CSRF 토큰 없이 `SameSite` 쿠키 속성에 의존한다.
