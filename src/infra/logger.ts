import path from "node:path";
import log4js from "log4js";

const configPath = path.resolve(process.cwd(), "config/log4js.json");

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

export const logger = log4js.getLogger();
