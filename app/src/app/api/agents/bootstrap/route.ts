import crypto from "node:crypto";

import { NextRequest } from "next/server";

import { logError, logInfo, logWarn } from "@/modules/app/logger";
import { bootstrapAgentWorkspace } from "@openclaw/module";
import { parseAgentBootstrapDraft } from "@/modules/app/schemas/agent-bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let body: unknown;

  logInfo("agent.bootstrap.api", "agent.bootstrap.request.received", {
    requestId,
  });

  try {
    body = await request.json();
  } catch (error) {
    logWarn("agent.bootstrap.api", "agent.bootstrap.request.invalid_json", {
      requestId,
      durationMs: Date.now() - startedAt,
      message:
        error instanceof Error
          ? error.message
          : "Failed to parse bootstrap request body.",
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseAgentBootstrapDraft(body);

  if (parsed.error || !parsed.draft) {
    logWarn("agent.bootstrap.api", "agent.bootstrap.request.invalid_payload", {
      requestId,
      durationMs: Date.now() - startedAt,
      message: parsed.error ?? "Invalid bootstrap payload.",
    });

    return Response.json(
      { error: parsed.error ?? "Invalid payload." },
      { status: 400 },
    );
  }

  try {
    const result = await bootstrapAgentWorkspace(parsed.draft);

    logInfo("agent.bootstrap.api", "agent.bootstrap.request.completed", {
      requestId,
      durationMs: Date.now() - startedAt,
      agentId: parsed.draft.agentId,
      workspaceFolder: result.workspaceFolder,
      managedFiles: result.managedFiles,
    });

    return Response.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to bootstrap agent workspace.";

    logError("agent.bootstrap.api", "agent.bootstrap.request.failed", {
      requestId,
      durationMs: Date.now() - startedAt,
      agentId: parsed.draft.agentId,
      message,
    });

    return Response.json({ error: message }, { status: 500 });
  }
}
