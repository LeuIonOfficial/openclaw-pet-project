import crypto from "node:crypto";
import { NextRequest } from "next/server";

import { logError, logInfo, logWarn } from "@/lib/logger";
import { streamChat, type ChatStreamEvent } from "@/lib/openclaw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let body: {
    message?: unknown;
    sessionKey?: unknown;
  };

  try {
    body = (await request.json()) as {
      message?: unknown;
      sessionKey?: unknown;
    };
  } catch (error) {
    logWarn("chat.api", "chat.request.invalid_json", {
      requestId,
      durationMs: Date.now() - startedAt,
      message:
        error instanceof Error ? error.message : "Failed to parse request body.",
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const sessionKey =
    typeof body.sessionKey === "string" && body.sessionKey.trim()
      ? body.sessionKey.trim()
      : undefined;

  if (!message) {
    logWarn("chat.api", "chat.request.missing_message", {
      requestId,
      hasSessionKey: Boolean(sessionKey),
      durationMs: Date.now() - startedAt,
    });

    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  logInfo("chat.api", "chat.request.received", {
    requestId,
    hasSessionKey: Boolean(sessionKey),
    messageChars: message.length,
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let runId = "";
      let deltaChunks = 0;
      let deltaCharacters = 0;
      let finalCharacters = 0;
      let outcome: "completed" | "failed" | "aborted" = "completed";

      const abortHandler = () => {
        outcome = "aborted";
        logWarn("chat.api", "chat.stream.aborted", {
          requestId,
          runId: runId || undefined,
          durationMs: Date.now() - startedAt,
        });
      };

      request.signal.addEventListener("abort", abortHandler, { once: true });

      const send = (event: ChatStreamEvent) => {
        if (event.type === "status") {
          if (event.stage === "started" && event.runId) {
            runId = event.runId;
          }

          logInfo("chat.api", "chat.stream.status", {
            requestId,
            runId: runId || undefined,
            stage: event.stage,
          });
        }

        if (event.type === "delta") {
          deltaChunks += 1;
          deltaCharacters += event.text.length;
        }

        if (event.type === "final") {
          finalCharacters = event.text.length;
        }

        if (event.type === "error") {
          outcome = "failed";
          logError("chat.api", "chat.stream.error_event", {
            requestId,
            runId: runId || undefined,
            message: event.message,
          });
        }

        controller.enqueue(encodeEvent(event));
      };

      void streamChat({
        message,
        sessionKey,
        requestId,
        signal: request.signal,
        onEvent: send,
      })
        .catch((error) => {
          outcome = request.signal.aborted ? "aborted" : "failed";
          const messageText =
            error instanceof Error ? error.message : "Chat stream failed.";

          logError("chat.api", "chat.stream.failure", {
            requestId,
            runId: runId || undefined,
            durationMs: Date.now() - startedAt,
            message: messageText,
          });

          try {
            controller.enqueue(
              encodeEvent({
                type: "error",
                message: messageText,
              }),
            );
          } catch {
            // Stream may already be closed after client disconnect.
          }
        })
        .finally(() => {
          request.signal.removeEventListener("abort", abortHandler);

          try {
            controller.close();
          } catch {
            // Stream may already be closed.
          }

          logInfo("chat.api", "chat.request.completed", {
            requestId,
            runId: runId || undefined,
            outcome,
            deltaChunks,
            deltaCharacters,
            finalCharacters,
            durationMs: Date.now() - startedAt,
          });
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
