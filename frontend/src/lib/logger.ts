import "server-only";

type LogLevel = "info" | "warn" | "error";
type LogData = Record<string, unknown>;

function writeLog(
  level: LogLevel,
  scope: string,
  event: string,
  data: LogData = {},
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    event,
    ...data,
  });

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.info(line);
}

export function logInfo(scope: string, event: string, data: LogData = {}): void {
  writeLog("info", scope, event, data);
}

export function logWarn(scope: string, event: string, data: LogData = {}): void {
  writeLog("warn", scope, event, data);
}

export function logError(scope: string, event: string, data: LogData = {}): void {
  writeLog("error", scope, event, data);
}
