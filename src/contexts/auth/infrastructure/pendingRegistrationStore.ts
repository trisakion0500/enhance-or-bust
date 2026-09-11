import { randomUUID } from "node:crypto";
import { redisClient } from "../../../infra/redis.js";
import { redisPendingRegistrationKey } from "../../../shared-kernel/redisKeys.js";

/** 가입 보류 상태가 유지되는 시간(초) — CSRF state 쿠키(5분)보다 넉넉하게, 닉네임 입력에 걸리는 시간을 감안해 10분. */
const PENDING_REGISTRATION_TTL_SEC = 10 * 60;

/** 닉네임 입력 전까지 Redis에 보류해두는 신규 가입 정보 — Player 생성에 필요한 필드만 담는다. */
export interface PendingRegistration {
  platformType: string;
  platformUserId: string;
  /** 플랫폼이 제공한 기본 닉네임(프론트가 입력 폼 기본값으로 보여준다) */
  name: string;
  email: string;
  picture: string | undefined;
}

/**
 * 신규 가입자의 소셜 프로필을 닉네임 입력 전까지 Redis에 임시 보관한다 — 닉네임을 받기 전엔
 * Player를 만들지 않으므로(CLAUDE.md "인증 전략"), 이 토큰이 가입 흐름의 임시 식별자가 된다.
 * @param profile Player 생성에 필요한 소셜 프로필
 * @returns 발급된 가입 보류 토큰
 * @author trisakion
 */
export async function createPendingRegistration(profile: PendingRegistration): Promise<string> {
  const token = randomUUID();
  await redisClient.set(redisPendingRegistrationKey(token), JSON.stringify(profile), { EX: PENDING_REGISTRATION_TTL_SEC });
  return token;
}

/**
 * 가입 보류 토큰으로 저장된 소셜 프로필을 조회한다.
 * @param token 가입 보류 토큰
 * @returns 저장된 프로필, 없거나 만료됐으면 undefined
 * @author trisakion
 */
export async function resolvePendingRegistration(token: string): Promise<PendingRegistration | undefined> {
  const raw = await redisClient.get(redisPendingRegistrationKey(token));
  return raw ? (JSON.parse(raw) as PendingRegistration) : undefined;
}

/**
 * 가입 보류 토큰을 지운다(가입 완료 또는 포기). 존재하지 않아도 무해하게 넘어간다(멱등).
 * @param token 가입 보류 토큰
 * @author trisakion
 */
export async function deletePendingRegistration(token: string): Promise<void> {
  await redisClient.del(redisPendingRegistrationKey(token));
}
