import { NextRequest } from "next/server";

import { streamChat, type ChatStreamEvent } from "@/lib/openclaw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function encodeEvent(event: ChatStreamEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json()) as {
    message?: unknown;
    sessionKey?: unknown;
  };

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const sessionKey =
    typeof body.sessionKey === "string" && body.sessionKey.trim()
      ? body.sessionKey.trim()
      : undefined;

  if (!message) {
    return Response.json({ error: "Message is required." }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encodeEvent(event));
      };

      void streamChat({
        message,
        sessionKey,
        signal: request.signal,
        onEvent: send,
      })
        .catch((error) => {
          const messageText =
            error instanceof Error ? error.message : "Chat stream failed.";

          controller.enqueue(
            encodeEvent({
              type: "error",
              message: messageText,
            }),
          );
        })
        .finally(() => {
          controller.close();
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
