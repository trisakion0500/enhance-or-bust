import fs from "node:fs";
import path from "node:path";
import log4js from "log4js";
import type { Configuration } from "log4js";

/**
 * `config/log4js.json`은 프로젝트 루트(`process.cwd()`) 기준 절대경로로 계산한다 — dev(tsx, src 실행)와
 * prod(node, dist 실행) 어느 쪽으로 띄워도 항상 같은 파일을 가리키게 하기 위함이다.
 */
const configPath = path.resolve(process.cwd(), "config/log4js.json");

/**
 * 인스턴스별로 로그 파일을 분리하기 위한 식별자(개발 컨벤션 7.4절). 로깅 설정은 다른 모듈보다
 * 먼저 로드되는 부트스트랩 극초반이라 설정 서비스(`config/env.ts`)가 아직 준비되지 않았을 수
 * 있어 `process.env`를 직접 읽는다 — 이 프로젝트의 다른 설정값과 달리 유일하게 허용된 예외다.
 * PM2 클러스터 모드는 `NODE_APP_INSTANCE`를 자동으로 심어주고, Docker/k8s 등은 오케스트레이터
 * 설정(`docker-compose.yml`의 `environment`, k8s downward API 등)으로 `INSTANCE_ID`를 명시적으로
 * 주입한다고 가정한다. 순수 OS `HOSTNAME`은 로컬 단일 인스턴스 개발 머신에도 항상 값이 있어
 * 이 판단 기준으로 쓰지 않는다(잘못 쓰면 단일 인스턴스에서도 불필요하게 파일명이 바뀐다).
 * 둘 다 없으면(로컬 단일 인스턴스) suffix를 붙이지 않아 기존 파일명 그대로 쓴다.
 */
const instanceId = process.env.NODE_APP_INSTANCE || process.env.INSTANCE_ID;

/**
 * 파일 계열 appender(`file`/`dateFile`)의 `filename`에 인스턴스 식별자 suffix를 붙인다 —
 * 여러 인스턴스가 같은 로그 파일에 동시에 쓰면 줄이 섞이거나 파일이 깨질 수 있어서다(개발
 * 컨벤션 7.4절). `dateFile`의 날짜 회전 suffix는 이 filename 뒤에 추가로 붙으므로 순서가
 * 바뀌지 않는다.
 * @param rawConfig 파일에서 읽은 원본 log4js 설정
 * @returns instanceId가 없으면 원본 그대로, 있으면 파일 계열 appender의 filename만 바꾼 설정
 */
function withInstanceSuffix(rawConfig: Configuration): Configuration {
  if (!instanceId) return rawConfig;
  const appenders = Object.fromEntries(
    Object.entries(rawConfig.appenders).map(([name, appender]) => {
      if (appender.type !== "file" && appender.type !== "dateFile") return [name, appender];
      const withFilename = appender as { filename: string };
      return [name, { ...withFilename, filename: `${withFilename.filename}.${instanceId}` }];
    }),
  );
  return { ...rawConfig, appenders };
}

/**
 * log4js 설정 파일을 읽어 적용한다. 초기 기동 시 한 번, 이후 SIGHUP을 받을 때마다 재호출된다.
 * 파일이 없거나 JSON 파싱에 실패해도 로거 자체가 죽지 않도록 콘솔 전용 설정으로 폴백하고 에러를 남긴다.
 */
function loadConfig() {
  try {
    const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Configuration;
    log4js.configure(withInstanceSuffix(rawConfig));
  } catch (err) {
    log4js.configure({
      appenders: { out: { type: "stdout" } },
      categories: { default: { appenders: ["out"], level: "info" } },
    });
    log4js.getLogger().error(`failed to load log4js config from ${configPath}, falling back to console`, err);
  }
}

loadConfig();

// 파일 watcher는 두지 않음 — 설정 변경은 재시작이 기본, 무중단 반영이 필요하면 SIGHUP으로 명시적 트리거
process.on("SIGHUP", loadConfig);

/**
 * 프로젝트 전역에서 쓰는 log4js 기본 카테고리 로거.
 * @author trisakion
 */
export const logger = log4js.getLogger();
