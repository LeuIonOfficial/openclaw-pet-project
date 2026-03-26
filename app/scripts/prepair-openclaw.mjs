import { promises as fs } from "node:fs";
import crypto from "node:crypto";

const enabled = (process.env.OPENCLAW_PREPAIR_ON_START ?? "true") === "true";
const strict = (process.env.OPENCLAW_PREPAIR_STRICT ?? "true") === "true";

const identityPath =
  process.env.OPENCLAW_IDENTITY_PATH ?? "/app/openclaw/identity/device.json";
const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL ?? "ws://openclaw:18789";
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";

const maxWaitMs = Number.parseInt(process.env.OPENCLAW_PREPAIR_MAX_WAIT_MS ?? "60000", 10);
const retryDelayMs = Number.parseInt(
  process.env.OPENCLAW_PREPAIR_RETRY_DELAY_MS ?? "3000",
  10,
);
const connectTimeoutMs = Number.parseInt(
  process.env.OPENCLAW_PREPAIR_CONNECT_TIMEOUT_MS ?? "8000",
  10,
);

const OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
];

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PAIRING_REQUIRED = "PAIRING_REQUIRED";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function derivePublicKeyRaw(publicKeyPem) {
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

function b64url(value) {
  return value
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function signPayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return b64url(crypto.sign(null, Buffer.from(payload, "utf8"), key));
}

function buildAuthPayload(params) {
  return [
    "v3",
    params.deviceId,
    "cli",
    "cli",
    "operator",
    OPERATOR_SCOPES.join(","),
    String(params.signedAtMs),
    gatewayToken,
    params.nonce,
    "linux",
    "docker",
  ].join("|");
}

async function loadIdentity() {
  const raw = await fs.readFile(identityPath, "utf8");
  const parsed = JSON.parse(raw);

  if (
    typeof parsed.deviceId !== "string" ||
    typeof parsed.publicKeyPem !== "string" ||
    typeof parsed.privateKeyPem !== "string"
  ) {
    throw new Error(`Invalid identity file at ${identityPath}`);
  }

  return parsed;
}

async function connectOnce(identity, attempt) {
  const WS = globalThis.WebSocket;
  if (typeof WS !== "function") {
    throw new Error("WebSocket API unavailable in runtime.");
  }

  return new Promise((resolve, reject) => {
    const ws = new WS(gatewayUrl);
    const connectId = crypto.randomUUID();
    let settled = false;

    const timer = setTimeout(() => {
      finish(new Error("connect timeout"));
    }, connectTimeoutMs);

    function finish(error) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (ws.readyState === WS.OPEN || ws.readyState === WS.CONNECTING) {
        ws.close();
      }

      if (error) {
        reject(error);
        return;
      }

      resolve();
    }

    ws.onerror = () => {
      finish(new Error("socket error"));
    };

    ws.onclose = (event) => {
      if (!settled) {
        finish(new Error(`socket closed (${event.code})`));
      }
    };

    ws.onopen = () => {
      console.info(`[prepair] gateway socket open (attempt ${attempt})`);
    };

    ws.onmessage = (event) => {
      let frame;

      try {
        frame = JSON.parse(String(event.data));
      } catch {
        finish(new Error("invalid JSON frame"));
        return;
      }

      if (frame?.type === "event" && frame?.event === "connect.challenge") {
        const nonce =
          frame.payload &&
          typeof frame.payload === "object" &&
          typeof frame.payload.nonce === "string"
            ? frame.payload.nonce
            : "";

        if (!nonce) {
          finish(new Error("missing challenge nonce"));
          return;
        }

        const signedAtMs = Date.now();
        const payload = buildAuthPayload({
          deviceId: identity.deviceId,
          signedAtMs,
          nonce,
        });

        ws.send(
          JSON.stringify({
            type: "req",
            id: connectId,
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: "cli",
                version: "0.1.0",
                platform: "linux",
                deviceFamily: "docker",
                mode: "cli",
              },
              auth: { token: gatewayToken },
              role: "operator",
              scopes: OPERATOR_SCOPES,
              device: {
                id: identity.deviceId,
                publicKey: b64url(derivePublicKeyRaw(identity.publicKeyPem)),
                signature: signPayload(identity.privateKeyPem, payload),
                signedAt: signedAtMs,
                nonce,
              },
            },
          }),
        );
        return;
      }

      if (frame?.type !== "res" || frame?.id !== connectId) {
        return;
      }

      if (frame.ok) {
        finish();
        return;
      }

      const detailCode =
        frame.error &&
        typeof frame.error === "object" &&
        frame.error.details &&
        typeof frame.error.details === "object" &&
        typeof frame.error.details.code === "string"
          ? frame.error.details.code
          : "";

      const message =
        frame.error && typeof frame.error.message === "string"
          ? frame.error.message
          : "connect failed";

      if (detailCode === PAIRING_REQUIRED) {
        finish(new Error(PAIRING_REQUIRED));
        return;
      }

      finish(new Error(message));
    };
  });
}

async function prepair() {
  if (!enabled) {
    console.info("[prepair] disabled");
    return;
  }

  if (!gatewayToken) {
    throw new Error("OPENCLAW_GATEWAY_TOKEN is missing.");
  }

  const identity = await loadIdentity();
  const startedAt = Date.now();
  const deadline = startedAt + maxWaitMs;
  let attempt = 0;
  let lastError = "";

  while (Date.now() < deadline) {
    attempt += 1;

    try {
      await connectOnce(identity, attempt);
      console.info(
        `[prepair] paired and ready in ${Date.now() - startedAt}ms (attempt ${attempt})`,
      );
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }

      if (lastError === PAIRING_REQUIRED) {
        console.info(
          `[prepair] waiting for device approval (attempt ${attempt}, remaining ${remaining}ms)`,
        );
      } else {
        console.warn(`[prepair] retry ${attempt}: ${lastError}`);
      }

      await delay(Math.min(retryDelayMs, remaining));
    }
  }

  throw new Error(
    `Pre-pair timed out after ${maxWaitMs}ms. Last error: ${lastError || "unknown"}`,
  );
}

prepair().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);

  if (strict) {
    console.error(`[prepair] failed: ${message}`);
    process.exit(1);
    return;
  }

  console.warn(`[prepair] continue without ready pairing: ${message}`);
});
