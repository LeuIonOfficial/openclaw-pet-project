import "server-only";

import { promises as fs } from "node:fs";
import crypto from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const CONNECT_TIMEOUT_MS = 10_000;
const OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
];

type DeviceIdentity = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
};

type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: {
      code?: string;
      reason?: string;
    };
  };
};

type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
};

type ChatPayload = {
  runId?: string;
  state?: "delta" | "final" | "aborted" | "error";
  errorMessage?: string;
  stopReason?: string;
  usage?: unknown;
  message?: unknown;
};

export type ChatStreamEvent =
  | { type: "status"; stage: "connecting" | "connected" | "started"; runId?: string }
  | { type: "delta"; text: string }
  | { type: "final"; text: string; stopReason?: string; usage?: unknown }
  | { type: "error"; message: string };

type StreamChatParams = {
  message: string;
  sessionKey?: string;
  signal: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void | Promise<void>;
};

type GatewayConfig = {
  url: string;
  token: string;
  identityPath: string;
  clientId: "cli";
  clientMode: "cli";
  platform: string;
  deviceFamily: string;
};

function base64UrlEncode(value: Buffer): string {
  return value
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = crypto.createPublicKey(publicKeyPem).export({
    type: "spki",
    format: "der",
  });

  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }

  return spki;
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), key));
}

function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string;
  nonce: string;
  platform: string;
  deviceFamily: string;
}): string {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token,
    params.nonce,
    params.platform,
    params.deviceFamily,
  ].join("|");
}

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const value = message as {
    text?: unknown;
    content?: unknown;
  };

  if (typeof value.text === "string") {
    return value.text;
  }

  if (typeof value.content === "string") {
    return value.content;
  }

  if (!Array.isArray(value.content)) {
    return "";
  }

  return value.content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      const part = item as {
        text?: unknown;
        type?: unknown;
      };

      if (typeof part.text === "string") {
        return part.text;
      }

      if (part.type === "text_delta" || part.type === "output_text") {
        return typeof part.text === "string" ? part.text : "";
      }

      return "";
    })
    .join("");
}

async function loadIdentity(identityPath: string): Promise<DeviceIdentity> {
  const raw = await fs.readFile(identityPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<DeviceIdentity>;

  if (
    typeof parsed.deviceId !== "string" ||
    typeof parsed.publicKeyPem !== "string" ||
    typeof parsed.privateKeyPem !== "string"
  ) {
    throw new Error(`Invalid OpenClaw identity file at ${identityPath}`);
  }

  return {
    deviceId: parsed.deviceId,
    publicKeyPem: parsed.publicKeyPem,
    privateKeyPem: parsed.privateKeyPem,
  };
}

function readGatewayConfig(): GatewayConfig {
  const url = process.env.OPENCLAW_GATEWAY_URL ?? "ws://openclaw:18789";
  const token = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
  const identityPath =
    process.env.OPENCLAW_IDENTITY_PATH ?? "/app/openclaw/identity/device.json";

  if (!token) {
    throw new Error("OPENCLAW_GATEWAY_TOKEN is missing");
  }

  return {
    url,
    token,
    identityPath,
    clientId: "cli",
    clientMode: "cli",
    platform: process.env.OPENCLAW_CLIENT_PLATFORM ?? "linux",
    deviceFamily: process.env.OPENCLAW_CLIENT_DEVICE_FAMILY ?? "docker",
  };
}

async function connectAndStreamChat(
  params: StreamChatParams,
  attempt = 0,
): Promise<void> {
  const config = readGatewayConfig();
  const identity = await loadIdentity(config.identityPath);

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(config.url);
    const connectId = crypto.randomUUID();
    const sendId = crypto.randomUUID();
    let resolvedSessionKey = params.sessionKey;
    let runId = "";
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeoutId);

      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      if (error) {
        reject(error);
        return;
      }

      resolve();
    };

    const fail = (message: string) => finish(new Error(message));

    const timeoutId = setTimeout(() => {
      fail("Timed out while connecting to OpenClaw.");
    }, CONNECT_TIMEOUT_MS);

    params.signal.addEventListener(
      "abort",
      () => finish(),
      { once: true },
    );

    ws.onerror = () => {
      fail("OpenClaw websocket connection failed.");
    };

    ws.onclose = (event) => {
      if (!settled) {
        fail(`OpenClaw websocket closed (${event.code}).`);
      }
    };

    ws.onopen = () => {
      void params.onEvent({ type: "status", stage: "connecting" });
    };

    ws.onmessage = (event) => {
      const frame = JSON.parse(String(event.data)) as
        | GatewayResponseFrame
        | GatewayEventFrame;

      if (frame.type === "event" && frame.event === "connect.challenge") {
        const nonce =
          frame.payload &&
          typeof frame.payload === "object" &&
          "nonce" in frame.payload &&
          typeof frame.payload.nonce === "string"
            ? frame.payload.nonce
            : "";

        if (!nonce) {
          fail("OpenClaw challenge nonce was missing.");
          return;
        }

        const signedAtMs = Date.now();
        const payload = buildDeviceAuthPayload({
          deviceId: identity.deviceId,
          clientId: config.clientId,
          clientMode: config.clientMode,
          role: "operator",
          scopes: OPERATOR_SCOPES,
          signedAtMs,
          token: config.token,
          nonce,
          platform: config.platform,
          deviceFamily: config.deviceFamily,
        });

        const request = {
          type: "req",
          id: connectId,
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: config.clientId,
              version: "0.1.0",
              platform: config.platform,
              deviceFamily: config.deviceFamily,
              mode: config.clientMode,
            },
            auth: {
              token: config.token,
            },
            role: "operator",
            scopes: OPERATOR_SCOPES,
            device: {
              id: identity.deviceId,
              publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
              signature: signDevicePayload(identity.privateKeyPem, payload),
              signedAt: signedAtMs,
              nonce,
            },
          },
        };

        ws.send(JSON.stringify(request));
        return;
      }

      if (frame.type === "res" && frame.id === connectId) {
        if (!frame.ok) {
          const detailCode = frame.error?.details?.code;
          const message = frame.error?.message ?? "OpenClaw connect failed.";

          if (
            detailCode === "PAIRING_REQUIRED" &&
            attempt === 0
          ) {
            finish(new Error("__PAIRING_RETRY__"));
            return;
          }

          fail(message);
          return;
        }

        const hello =
          frame.payload && typeof frame.payload === "object" ? frame.payload : {};

        if (!resolvedSessionKey) {
          resolvedSessionKey =
            "snapshot" in hello &&
            hello.snapshot &&
            typeof hello.snapshot === "object" &&
            "sessionDefaults" in hello.snapshot &&
            hello.snapshot.sessionDefaults &&
            typeof hello.snapshot.sessionDefaults === "object" &&
            "mainSessionKey" in hello.snapshot.sessionDefaults &&
            typeof hello.snapshot.sessionDefaults.mainSessionKey === "string"
              ? hello.snapshot.sessionDefaults.mainSessionKey
              : "agent:main:main";
        }

        void params.onEvent({ type: "status", stage: "connected" });

        ws.send(
          JSON.stringify({
            type: "req",
            id: sendId,
            method: "chat.send",
            params: {
              sessionKey: resolvedSessionKey,
              message: params.message,
              idempotencyKey: crypto.randomUUID(),
            },
          }),
        );
        return;
      }

      if (frame.type === "res" && frame.id === sendId) {
        if (!frame.ok) {
          fail(frame.error?.message ?? "chat.send failed.");
          return;
        }

        const payload =
          frame.payload && typeof frame.payload === "object" ? frame.payload : {};

        runId =
          "runId" in payload && typeof payload.runId === "string"
            ? payload.runId
            : "";

        void params.onEvent({ type: "status", stage: "started", runId });
        return;
      }

      if (frame.type !== "event" || frame.event !== "chat") {
        return;
      }

      const payload = frame.payload as ChatPayload;

      if (!payload || payload.runId !== runId) {
        return;
      }

      if (payload.state === "delta") {
        const text = extractText(payload.message);

        if (text) {
          void params.onEvent({ type: "delta", text });
        }

        return;
      }

      if (payload.state === "final") {
        void params.onEvent({
          type: "final",
          text: extractText(payload.message),
          stopReason: payload.stopReason,
          usage: payload.usage,
        });
        finish();
        return;
      }

      if (payload.state === "aborted") {
        fail("Chat request was aborted.");
        return;
      }

      if (payload.state === "error") {
        fail(payload.errorMessage ?? "Chat request failed.");
      }
    };
  }).catch(async (error) => {
    if (error instanceof Error && error.message === "__PAIRING_RETRY__") {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      return connectAndStreamChat(params, attempt + 1);
    }

    throw error;
  });
}

export async function streamChat(params: StreamChatParams): Promise<void> {
  return connectAndStreamChat(params);
}

export async function healthcheck(): Promise<{
  gatewayUrl: string;
  hasToken: boolean;
  hasIdentity: boolean;
}> {
  const config = readGatewayConfig();
  let hasIdentity = false;

  try {
    await fs.access(config.identityPath);
    hasIdentity = true;
  } catch {
    hasIdentity = false;
  }

  return {
    gatewayUrl: config.url,
    hasToken: Boolean(config.token),
    hasIdentity,
  };
}
