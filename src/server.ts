import express from "express";
import { errorHandler } from "./shared-kernel/errorHandler.js";
import { requestId, requestLogger } from "./shared-kernel/requestLogger.js";
import type { PlayerRepository } from "./contexts/player/domain/playerRepository.js";
import type { MailboxRepository } from "./contexts/mailbox/domain/mailboxRepository.js";
import { createAuthRoutes } from "./contexts/auth/routes/authRoutes.js";
import { createBattleStageRoutes } from "./contexts/battleStage/routes/battleStageRoutes.js";
import { createEnhancementRoutes } from "./contexts/enhancement/routes/enhancementRoutes.js";
import { createGmRoutes } from "./contexts/gm/routes/gmRoutes.js";
import { createMailboxRoutes } from "./contexts/mailbox/routes/mailboxRoutes.js";
import { createPlayerRoutes } from "./contexts/player/routes/playerRoutes.js";
import { createSynthesisRoutes } from "./contexts/synthesis/routes/synthesisRoutes.js";

/**
 * Express `app`을 조립해 반환한다. DB/Redis 연결이나 `listen()` 같은 프로세스 부트스트랩은 다루지 않고
 * 미들웨어/라우트 등록만 책임진다 — 이 분리 덕분에 실제 포트를 열거나 인프라에 붙지 않고도 라우트 단위 테스트가 가능하다.
 * @param playerRepository Player 영속성 포트(DI) — 인증 라우터가 로그인/신규가입 시 사용
 * @param mailboxRepository Mailbox 영속성 포트(DI)
 * @returns 설정이 끝난 Express `app` 인스턴스
 * @author trisakion
 */
export function createServer(playerRepository: PlayerRepository, mailboxRepository: MailboxRepository) {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use(requestLogger);
  app.use(express.static("public"));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(createAuthRoutes(playerRepository));
  // enhancement/synthesis/battleStage/mailbox/player 라우터는 전부 router.use(requireAuth)를
  // 경로 제한 없이 걸어둔다 — 프리픽스 없이 app.use()로 마운트되는 구조상, 이 라우터들보다
  // 뒤에 마운트되면 그 requireAuth가 경로 매칭 전에 먼저 걸려 /gm/*까지 세션 인증을 요구하게
  // 된다(gmRoutes 자체는 라우트별로 gmApiKeyAuth를 붙여 안전하지만, 그 앞의 다른 라우터가
  // 가로채는 문제라 gmRoutes 쪽 수정만으론 해결이 안 됨) — 그래서 이 라우터들보다 먼저 마운트한다.
  app.use(createGmRoutes(playerRepository));
  app.use(createEnhancementRoutes(playerRepository));
  app.use(createSynthesisRoutes(playerRepository));
  app.use(createBattleStageRoutes(playerRepository, mailboxRepository));
  app.use(createMailboxRoutes(mailboxRepository));
  app.use(createPlayerRoutes(playerRepository));

  app.use(errorHandler);

  return app;
}
