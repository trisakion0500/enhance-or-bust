declare global {
  namespace Express {
    interface Request {
      /** {@link import("../shared-kernel/sessionAuth.js").requireAuth}가 세션 인증 성공 시 세팅. */
      playerId: string;
    }
  }
}

export {};
