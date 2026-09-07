/**
 * 환경변수 기반 프로젝트 설정값. 프로세스 시작 시 한 번 평가되어 전역에서 참조된다.
 * `??` 기본값이 있는 필드는 로컬 개발 기본값이고, 없는 필드(계정/비밀번호류)는 `.env`에서만 채워진다.
 * @author trisakion
 */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  mongoUri: process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/?replicaSet=rs0",
  mongoAppDatabase: process.env.MONGO_APP_DATABASE ?? "enhance_or_bust",
  mongoAppUsername: process.env.MONGO_APP_USERNAME,
  mongoAppPassword: process.env.MONGO_APP_PASSWORD,
  mongoAppDatabaseLog: process.env.MONGO_APP_DATABASE_LOG ?? "enhance_or_bust_log",
  mongoAppUsernameLog: process.env.MONGO_APP_USERNAME_LOG,
  mongoAppPasswordLog: process.env.MONGO_APP_PASSWORD_LOG,
  redisUrl: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  redisPassword: process.env.REDIS_PASSWORD,
  /** 로컬 개발용 Redis 하나를 여러 프로젝트가 같이 쓸 때 키 충돌을 막는 프리픽스. 모든 Redis 키 앞에 붙인다. */
  redisKeyPrefix: process.env.REDIS_KEY_PREFIX ?? "eob:",
  masterDataPollIntervalMs: Number(process.env.MASTER_DATA_POLL_INTERVAL_MS ?? 5 * 60 * 1000),
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  /** `id_token`(Google Identity Services, 기본값) 또는 `authorization_code`. */
  googleAuthFlow: (process.env.GOOGLE_AUTH_FLOW ?? "id_token") as "id_token" | "authorization_code",
  /** authorization_code 플로우 전용 — code를 토큰으로 교환할 때 필요. */
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  /** authorization_code 플로우 전용 — 구글 콘솔에 등록한 redirect URI와 정확히 일치해야 함. */
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
  sessionTtlSec: Number(process.env.SESSION_TTL_SEC ?? 7 * 24 * 60 * 60),
};
