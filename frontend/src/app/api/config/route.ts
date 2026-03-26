import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { logError, logInfo, logWarn } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_CONFIG_PATH = "/app/openclaw/openclaw.json";
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:18789",
  "http://127.0.0.1:18789",
];

type ConfigDraft = {
  modelPrimary: string;
  gatewayMode: string;
  gatewayBind: string;
  tokenEnvId: string;
};

type ConfigPayload = {
  modelPrimary: string;
  gatewayMode: string;
  gatewayBind: string;
  tokenEnvId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveConfigPath(): string {
  return process.env.OPENCLAW_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readAllowedOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeDraft(body: unknown): { draft?: ConfigDraft; error?: string } {
  if (!isRecord(body)) {
    return { error: "Invalid JSON payload." };
  }

  const modelPrimary = asString(body.modelPrimary)?.trim() ?? "";
  const gatewayMode = asString(body.gatewayMode)?.trim() ?? "";
  const gatewayBind = asString(body.gatewayBind)?.trim() ?? "";
  const tokenEnvId = asString(body.tokenEnvId)?.trim() ?? "";

  if (!modelPrimary || !gatewayMode || !gatewayBind || !tokenEnvId) {
    return { error: "modelPrimary, gatewayMode, gatewayBind, tokenEnvId are required." };
  }

  return {
    draft: {
      modelPrimary,
      gatewayMode,
      gatewayBind,
      tokenEnvId,
    },
  };
}

function toConfigPayload(config: Record<string, unknown>): ConfigPayload {
  const agents = isRecord(config.agents) ? config.agents : {};
  const defaults = isRecord(agents.defaults) ? agents.defaults : {};
  const model = isRecord(defaults.model) ? defaults.model : {};
  const gateway = isRecord(config.gateway) ? config.gateway : {};
  const auth = isRecord(gateway.auth) ? gateway.auth : {};
  const token = isRecord(auth.token) ? auth.token : {};

  return {
    modelPrimary:
      (asString(model.primary)?.trim() || "anthropic/claude-sonnet-4-5"),
    gatewayMode: asString(gateway.mode)?.trim() || "remote",
    gatewayBind: asString(gateway.bind)?.trim() || "lan",
    tokenEnvId: asString(token.id)?.trim() || "OPENCLAW_GATEWAY_TOKEN",
  };
}

function buildNextConfig(
  current: Record<string, unknown>,
  draft: ConfigDraft,
): Record<string, unknown> {
  const nowIso = new Date().toISOString();
  const currentMeta = isRecord(current.meta) ? current.meta : {};
  const currentAgents = isRecord(current.agents) ? current.agents : {};
  const currentDefaults = isRecord(currentAgents.defaults)
    ? currentAgents.defaults
    : {};
  const currentModels = isRecord(currentDefaults.models)
    ? currentDefaults.models
    : {};
  const currentGateway = isRecord(current.gateway) ? current.gateway : {};
  const currentControlUi = isRecord(currentGateway.controlUi)
    ? currentGateway.controlUi
    : {};
  const allowedOrigins = readAllowedOrigins(currentControlUi.allowedOrigins);
  const commandConfig = isRecord(current.commands) ? current.commands : {};

  return {
    ...current,
    meta: {
      ...currentMeta,
      lastTouchedVersion:
        asString(currentMeta.lastTouchedVersion) ?? "2026.3.24",
      lastTouchedAt: nowIso,
    },
    agents: {
      ...currentAgents,
      defaults: {
        ...currentDefaults,
        model: {
          ...(isRecord(currentDefaults.model) ? currentDefaults.model : {}),
          primary: draft.modelPrimary,
        },
        models: {
          ...currentModels,
          [draft.modelPrimary]: isRecord(currentModels[draft.modelPrimary])
            ? currentModels[draft.modelPrimary]
            : {},
        },
      },
    },
    commands: {
      native: asString(commandConfig.native) ?? "auto",
      nativeSkills: asString(commandConfig.nativeSkills) ?? "auto",
      restart:
        typeof commandConfig.restart === "boolean"
          ? commandConfig.restart
          : true,
      ownerDisplay: asString(commandConfig.ownerDisplay) ?? "raw",
    },
    gateway: {
      ...currentGateway,
      mode: draft.gatewayMode,
      bind: draft.gatewayBind,
      controlUi: {
        ...currentControlUi,
        allowedOrigins:
          allowedOrigins.length > 0 ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS,
      },
      auth: {
        ...(isRecord(currentGateway.auth) ? currentGateway.auth : {}),
        mode: "token",
        token: {
          source: "env",
          provider: "default",
          id: draft.tokenEnvId,
        },
      },
    },
  };
}

async function readConfigFile(
  configPath: string,
): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!isRecord(parsed)) {
      throw new Error("OpenClaw config root must be an object.");
    }

    return parsed;
  } catch (error) {
    if (
      isRecord(error) &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }

    throw error;
  }
}

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const configPath = resolveConfigPath();

  logInfo("config.api", "config.request.received", {
    requestId,
    method: "GET",
    configPath,
  });

  try {
    const config = await readConfigFile(configPath);
    const payload = toConfigPayload(config);

    logInfo("config.api", "config.request.completed", {
      requestId,
      method: "GET",
      durationMs: Date.now() - startedAt,
      modelPrimary: payload.modelPrimary,
    });

    return Response.json({ config: payload });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read OpenClaw config.";

    logError("config.api", "config.request.failed", {
      requestId,
      method: "GET",
      durationMs: Date.now() - startedAt,
      configPath,
      message,
    });

    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const configPath = resolveConfigPath();
  let body: unknown;

  logInfo("config.api", "config.request.received", {
    requestId,
    method: "POST",
    configPath,
  });

  try {
    body = await request.json();
  } catch (error) {
    logWarn("config.api", "config.request.invalid_json", {
      requestId,
      method: "POST",
      durationMs: Date.now() - startedAt,
      message:
        error instanceof Error ? error.message : "Failed to parse config payload.",
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const normalized = normalizeDraft(body);

  if (normalized.error || !normalized.draft) {
    logWarn("config.api", "config.request.invalid_payload", {
      requestId,
      method: "POST",
      durationMs: Date.now() - startedAt,
      message: normalized.error ?? "Invalid config payload.",
    });

    return Response.json(
      { error: normalized.error ?? "Invalid payload." },
      { status: 400 },
    );
  }

  try {
    const current = await readConfigFile(configPath);
    const next = buildNextConfig(current, normalized.draft);
    const serialized = `${JSON.stringify(next, null, 2)}\n`;
    const savedAt = new Date().toISOString();

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, serialized, "utf8");

    const payload = toConfigPayload(next);

    logInfo("config.api", "config.request.completed", {
      requestId,
      method: "POST",
      durationMs: Date.now() - startedAt,
      modelPrimary: payload.modelPrimary,
      gatewayMode: payload.gatewayMode,
      gatewayBind: payload.gatewayBind,
    });

    return Response.json({
      config: payload,
      savedAt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to write OpenClaw config.";

    logError("config.api", "config.request.failed", {
      requestId,
      method: "POST",
      durationMs: Date.now() - startedAt,
      configPath,
      message,
    });

    return Response.json({ error: message }, { status: 500 });
  }
}
