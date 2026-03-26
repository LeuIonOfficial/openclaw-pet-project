import crypto from "node:crypto";
import { NextRequest } from "next/server";

import { logError, logInfo, logWarn } from "@/lib/logger";
import { streamChat, type ChatStreamEvent } from "@/lib/openclaw";
import { parseChatRequest } from "@/lib/schemas/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

function buildAgentMessage(params: {
  message: string;
  agentName?: string;
  agentPrompt?: string;
}): string {
  if (!params.agentPrompt) {
    return params.message;
  }

  const label = params.agentName ?? "Custom Agent";

  return [
    `System instructions for ${label}:`,
    params.agentPrompt,
    "",
    "User message:",
    params.message,
  ].join("\n");
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let body: unknown;

  try {
    body = await request.json();
  } catch (error) {
    logWarn("chat.api", "chat.request.invalid_json", {
      requestId,
      durationMs: Date.now() - startedAt,
      message:
        error instanceof Error ? error.message : "Failed to parse request body.",
    });

    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsedRequest = parseChatRequest(body);

  if (parsedRequest.error || !parsedRequest.data) {
    logWarn("chat.api", "chat.request.invalid_payload", {
      requestId,
      durationMs: Date.now() - startedAt,
      message: parsedRequest.error ?? "Invalid chat payload.",
    });

    return Response.json(
      { error: parsedRequest.error ?? "Invalid payload." },
      { status: 400 },
    );
  }

  const { message, sessionKey, agentName, agentPrompt, attachments } =
    parsedRequest.data;
  const hasAttachments = attachments.length > 0;
  const messageForGateway = message || "Please analyze the attached image(s).";
  const outboundMessage = buildAgentMessage({
    message: messageForGateway,
    agentName,
    agentPrompt,
  });

  if (!message && !hasAttachments) {
    logWarn("chat.api", "chat.request.empty_input", {
      requestId,
      hasSessionKey: Boolean(sessionKey),
      durationMs: Date.now() - startedAt,
    });

    return Response.json(
      { error: "Message or attachment is required." },
      { status: 400 },
    );
  }

  logInfo("chat.api", "chat.request.received", {
    requestId,
    hasSessionKey: Boolean(sessionKey),
    hasAgentPrompt: Boolean(agentPrompt),
    agentName,
    messageChars: message.length,
    attachmentCount: attachments.length,
    outboundMessageChars: outboundMessage.length,
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let runId = "";
      let deltaChunks = 0;
      let deltaCharacters = 0;
      let finalCharacters = 0;
      let toolEvents = 0;
      let toolCompletions = 0;
      let toolErrors = 0;
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

        if (event.type === "tool") {
          toolEvents += 1;

          if (event.status === "completed") {
            toolCompletions += 1;
          }

          if (event.status === "error") {
            toolErrors += 1;
          }
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
        message: outboundMessage,
        attachments,
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
            toolEvents,
            toolCompletions,
            toolErrors,
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
