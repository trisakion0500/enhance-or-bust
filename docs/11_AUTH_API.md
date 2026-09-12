# 11_AUTH_API.md

에러 코드/응답 포맷 공통 규약은 `10_API_COMMON.md`, 인증 정책 배경은
`09_AUTH_SECURITY.md` 참고.

### `GET /health`

헬스체크. 인증 불필요.

**응답**
```json
{ "status": "ok" }
```

### `GET /auth/config`

프론트가 로그인 UI를 초기화할 때 쓰는 공개 설정 조회. 인증 불필요.

**응답**
```json
{ "googleClientId": "xxxxx.apps.googleusercontent.com", "authFlow": "id_token" }
```

### `POST /auth/google`

`GOOGLE_AUTH_FLOW=id_token`(기본값)일 때만 등록된다. Google Identity Services가 발급한
ID 토큰으로 로그인하거나(기존 사용자) 신규가입 절차를 시작한다(처음 보는 사용자). 인증
불필요.

**요청 body**
```json
{ "credential": "<구글이 발급한 ID 토큰(JWT)>" }
```

**응답(기존 사용자, 로그인)**: `{ "result": 0 }` + `Set-Cookie: sessionToken=...` (httpOnly, 7일)

**응답(신규 사용자, 가입 보류)**: 이 시점엔 Player가 아직 생성되지 않는다 —
`{ "result": 0, "pendingRegistration": true, "defaultName": "플랫폼이 제공한 기본 닉네임" }`
+ `Set-Cookie: pendingRegistrationToken=...` (httpOnly, 10분). 프론트는 이 응답을 받으면
닉네임 입력 화면으로 전환하고 `POST /auth/register/complete`를 호출해 가입을 완료해야
한다.

**에러**: 9000(credential 누락), 9001(토큰 검증 실패)

### `GET /auth/google/login`

`GOOGLE_AUTH_FLOW=authorization_code`일 때만 등록된다. CSRF 방지용 `state`를 쿠키에
저장한 뒤 구글 동의 화면으로 302 리다이렉트한다. 인증 불필요.

### `GET /auth/google/callback`

위와 동일 조건에서만 등록. 구글이 `code`/`state`와 함께 리다이렉트해오면 `state`를
검증하고, `code`를 토큰과 교환해 로그인/가입 절차를 진행한다. 인증 불필요(이 요청 자체가
로그인 완료 시점).

- **기존 사용자**: 세션 쿠키를 발급하고 `/`로 302 리다이렉트한다.
- **신규 사용자**: `POST /auth/google`과 동일하게 이 시점엔 Player를 만들지 않고, 가입
  보류 쿠키(`pendingRegistrationToken`)를 발급한 뒤 `/?register=1`로 302 리다이렉트한다
  — 프론트는 이 쿼리 파라미터를 보고 닉네임 입력 화면을 띄운다.
- **실패 시**: JSON 에러 대신 `/?loginError=1`로 302 리다이렉트한다(`state` 불일치,
  토큰 교환/검증 실패 등 사유 무관 — 실패 원인은 서버 로그에만 남긴다). 프론트는 이
  쿼리 파라미터를 보고 로그인 화면에 실패 메시지를 표시한다.

### `GET /auth/facebook/login`

토글 없이 항상 등록된다(페이스북엔 구글의 `id_token`/GIS에 대응하는 수단이 없어
Authorization Code Flow 하나만 지원). CSRF 방지용 `state`를 구글과 같은 쿠키에 저장한
뒤 페이스북 동의 화면으로 302 리다이렉트한다. 인증 불필요.

### `GET /auth/facebook/callback`

페이스북이 `code`/`state`와 함께 리다이렉트해오면 `state`를 검증하고, `code`를 access
token/프로필과 교환해 로그인/가입 절차를 진행한다. 인증 불필요(이 요청 자체가 로그인
완료 시점).

- **기존 사용자**: 세션 쿠키를 발급하고 `/`로 302 리다이렉트한다.
- **신규 사용자**: 구글 authorization_code와 동일하게 가입 보류 쿠키를 발급하고
  `/?register=1`로 302 리다이렉트한다.
- **실패 시**: 구글 콜백과 동일하게 `/?loginError=1`로 302 리다이렉트한다.

### `GET /auth/register/pending`

가입 보류 중인 사용자가 닉네임 입력 화면에 기본값을 채우기 위해 호출한다.
`pendingRegistrationToken` 쿠키(URL이 아니라 쿠키로만 오간다 — 리퍼러로 새는 것을 피하기
위함)로 Redis(TTL 10분)에서 보류된 소셜 프로필을 조회한다. 인증 불필요(세션이 아니라
가입 보류 쿠키로 식별).

**응답**
```json
{ "result": 0, "defaultName": "플랫폼이 제공한 기본 닉네임" }
```

**에러**: 9004(쿠키 없음/Redis TTL 만료)

### `POST /auth/register/complete`

닉네임을 받아 그제서야 Player를 실제로 생성한다(최저 등급 원형 중 랜덤 1장 시작 카드 +
초기 골드 1000) — 이 호출 전까지는 아무 것도 저장되지 않는다. 인증 불필요(가입 보류
쿠키로 식별).

**요청 body**
```json
{ "name": "닉네임" }
```

**응답**: `{ "result": 0 }` + `Set-Cookie: sessionToken=...` (httpOnly, 7일), 가입 보류
쿠키는 삭제된다.

**에러**: 9000(name이 문자열이 아님), 9004(쿠키 없음/Redis TTL 만료)

### `POST /auth/logout`

세션 쿠키를 지우고 로그아웃한다. 인증 불필요 — 세션 쿠키가 없거나 이미 만료돼도 그냥
성공 처리한다(멱등: 이미 로그아웃된 상태로 두 번 호출해도 에러가 아니다).

**응답**: `{ "result": 0 }` + 세션 쿠키 삭제
