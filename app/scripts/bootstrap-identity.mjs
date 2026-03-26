import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const identityPath =
  process.env.OPENCLAW_IDENTITY_PATH ?? "/app/openclaw/identity/device.json";

function isValidIdentity(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.deviceId === "string" &&
    typeof value.publicKeyPem === "string" &&
    typeof value.privateKeyPem === "string"
  );
}

function buildIdentity() {
  const keyPair = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  return {
    version: 1,
    deviceId: crypto.randomBytes(32).toString("hex"),
    publicKeyPem: keyPair.publicKey,
    privateKeyPem: keyPair.privateKey,
    createdAtMs: Date.now(),
  };
}

async function ensureIdentity() {
  try {
    const raw = await fs.readFile(identityPath, "utf8");
    const parsed = JSON.parse(raw);

    if (!isValidIdentity(parsed)) {
      throw new Error(`Identity file exists but is invalid: ${identityPath}`);
    }

    return;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      await fs.mkdir(path.dirname(identityPath), { recursive: true });
      const payload = buildIdentity();

      await fs.writeFile(identityPath, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });

      console.info(`[identity-bootstrap] identity created: ${identityPath}`);
      return;
    }

    throw error;
  }
}

ensureIdentity().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[identity-bootstrap] failed: ${message}`);
  process.exit(1);
});
