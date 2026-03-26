import crypto from "node:crypto";

import { logError, logInfo } from "@/modules/app/logger";
import { healthcheck } from "@openclaw/module";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();

  logInfo("health.api", "health.request.received", {
    requestId,
  });

  try {
    const payload = await healthcheck();

    logInfo("health.api", "health.request.completed", {
      requestId,
      hasToken: payload.hasToken,
      hasIdentity: payload.hasIdentity,
      durationMs: Date.now() - startedAt,
    });

    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Health check failed.";

    logError("health.api", "health.request.failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      message,
    });

    return Response.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
