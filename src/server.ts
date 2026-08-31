import express from "express";
import log4js from "log4js";
import { errorHandler } from "./common/errorHandler.js";

/**
 * Express `app`을 조립해 반환한다. DB/Redis 연결이나 `listen()` 같은 프로세스 부트스트랩은 다루지 않고
 * 미들웨어/라우트 등록만 책임진다 — 이 분리 덕분에 실제 포트를 열거나 인프라에 붙지 않고도 라우트 단위 테스트가 가능하다.
 * @returns 설정이 끝난 Express `app` 인스턴스
 * @author trisakion
 */
export function createServer() {
  const app = express();
  app.use(log4js.connectLogger(log4js.getLogger(), { level: "info" }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(errorHandler);

  return app;
}
