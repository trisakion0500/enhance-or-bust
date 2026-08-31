import path from "node:path";
import log4js from "log4js";

/**
 * `config/log4js.json`은 프로젝트 루트(`process.cwd()`) 기준 절대경로로 계산한다 — dev(tsx, src 실행)와
 * prod(node, dist 실행) 어느 쪽으로 띄워도 항상 같은 파일을 가리키게 하기 위함이다.
 */
const configPath = path.resolve(process.cwd(), "config/log4js.json");

/**
 * log4js 설정 파일을 읽어 적용한다. 초기 기동 시 한 번, 이후 SIGHUP을 받을 때마다 재호출된다.
 * 파일이 없거나 JSON 파싱에 실패해도 로거 자체가 죽지 않도록 콘솔 전용 설정으로 폴백하고 에러를 남긴다.
 */
function loadConfig() {
  try {
    log4js.configure(configPath);
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
