import { promises as fs } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const identityPath =
  process.env.OPENCLAW_IDENTITY_PATH ?? "/app/openclaw/identity/device.json";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function isValidIdentity(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.deviceId === "string" &&
    typeof value.publicKeyPem === "string" &&
    typeof value.privateKeyPem === "string"
  );
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

function computeDeviceId(publicKeyPem) {
  return crypto
    .createHash("sha256")
    .update(derivePublicKeyRaw(publicKeyPem))
    .digest("hex");
}

function assertKeyPairMatches(identity) {
  const payload = Buffer.from("openclaw-device-identity-check", "utf8");
  const signature = crypto.sign(
    null,
    payload,
    crypto.createPrivateKey(identity.privateKeyPem),
  );
  const isValid = crypto.verify(
    null,
    payload,
    crypto.createPublicKey(identity.publicKeyPem),
    signature,
  );

  if (!isValid) {
    throw new Error("Identity key pair is invalid (public/private mismatch).");
  }
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
    deviceId: computeDeviceId(keyPair.publicKey),
    publicKeyPem: keyPair.publicKey,
    privateKeyPem: keyPair.privateKey,
    createdAtMs: Date.now(),
  };
}

async function writeIdentity(payload, mode = "update") {
  await fs.mkdir(path.dirname(identityPath), { recursive: true });

  await fs.writeFile(identityPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    flag: mode === "create" ? "wx" : "w",
  });
}

async function ensureIdentity() {
  try {
    const raw = await fs.readFile(identityPath, "utf8");
    const parsed = JSON.parse(raw);

    if (!isValidIdentity(parsed)) {
      throw new Error(`Identity file exists but is invalid: ${identityPath}`);
    }

    assertKeyPairMatches(parsed);

    const expectedDeviceId = computeDeviceId(parsed.publicKeyPem);

    if (parsed.deviceId !== expectedDeviceId) {
      const normalized = {
        ...parsed,
        deviceId: expectedDeviceId,
      };
      await writeIdentity(normalized, "update");
      console.info(
        `[identity-bootstrap] identity normalized (deviceId fingerprint): ${identityPath}`,
      );
    }

    return;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      const payload = buildIdentity();
      await writeIdentity(payload, "create");

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
