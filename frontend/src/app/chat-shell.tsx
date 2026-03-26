"use client";

import { startTransition, useEffect, useRef, useState } from "react";

type ConnectionState = {
  label: string;
  tone: "neutral" | "good" | "bad";
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "done" | "streaming" | "error";
};

const initialConnectionState: ConnectionState = {
  label: "Checking gateway",
  tone: "neutral",
};

export function ChatShell() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    initialConnectionState,
  );
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetch("/api/health")
      .then(async (response) => {
        const payload = (await response.json()) as {
          hasToken?: boolean;
          hasIdentity?: boolean;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Gateway health check failed.");
        }

        if (payload.hasToken && payload.hasIdentity) {
          setConnectionState({
            label: "Gateway ready",
            tone: "good",
          });
          return;
        }

        setConnectionState({
          label: "Gateway needs setup",
          tone: "bad",
        });
      })
      .catch(() => {
        setConnectionState({
          label: "Gateway unreachable",
          tone: "bad",
        });
      });
  }, []);

  useEffect(() => {
    const list = listRef.current;

    if (!list) {
      return;
    }

    list.scrollTo({
      top: list.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = input.trim();

    if (!message || isSubmitting) {
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      status: "done",
    };

    const assistantMessageId = crypto.randomUUID();

    setInput("");
    setIsSubmitting(true);
    setConnectionState({
      label: "Streaming response",
      tone: "neutral",
    });
    setMessages((current) => [
      ...current,
      userMessage,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        status: "streaming",
      },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Chat request failed before streaming started.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          const line = rawEvent
            .split("\n")
            .find((entry) => entry.startsWith("data: "));

          if (!line) {
            continue;
          }

          const payload = JSON.parse(line.slice(6)) as
            | { type: "status"; stage: string }
            | { type: "delta"; text: string }
            | { type: "final"; text: string }
            | { type: "error"; message: string };

          if (payload.type === "status") {
            startTransition(() => {
              setConnectionState({
                label:
                  payload.stage === "started"
                    ? "Assistant is responding"
                    : "Gateway connected",
                tone: "good",
              });
            });
            continue;
          }

          if (payload.type === "delta") {
            startTransition(() => {
              setMessages((current) =>
                current.map((entry) =>
                  entry.id === assistantMessageId
                    ? {
                        ...entry,
                        content: `${entry.content}${payload.text}`,
                      }
                    : entry,
                ),
              );
            });
            continue;
          }

          if (payload.type === "final") {
            startTransition(() => {
              setMessages((current) =>
                current.map((entry) =>
                  entry.id === assistantMessageId
                    ? {
                        ...entry,
                        content: payload.text || entry.content,
                        status: "done",
                      }
                    : entry,
                ),
              );
              setConnectionState({
                label: "Gateway ready",
                tone: "good",
              });
            });
            continue;
          }

          startTransition(() => {
            setMessages((current) =>
              current.map((entry) =>
                entry.id === assistantMessageId
                  ? {
                      ...entry,
                      content: payload.message,
                      status: "error",
                    }
                  : entry,
              ),
            );
            setConnectionState({
              label: "Gateway error",
              tone: "bad",
            });
          });
        }
      }
    } catch (error) {
      startTransition(() => {
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantMessageId
              ? {
                  ...entry,
                  content:
                    error instanceof Error
                      ? error.message
                      : "Unexpected request failure.",
                  status: "error",
                }
              : entry,
          ),
        );
        setConnectionState({
          label: "Gateway error",
          tone: "bad",
        });
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(252,211,77,0.28),_transparent_28%),linear-gradient(180deg,_#0f172a_0%,_#111827_52%,_#020617_100%)] px-4 py-6 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col gap-6 rounded-[32px] border border-white/10 bg-slate-950/70 p-4 shadow-[0_24px_80px_rgba(2,6,23,0.6)] backdrop-blur sm:p-6">
        <section className="grid gap-4 rounded-[28px] border border-white/10 bg-white/5 p-5 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="space-y-4">
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-amber-300/80">
              OpenClaw assessment build
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Streaming chat over a live OpenClaw gateway, inside one Next.js app.
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              The UI streams assistant output token-by-token from a server route
              that performs the OpenClaw websocket handshake and forwards live
              chat events.
            </p>
          </div>

          <div className="grid gap-3 rounded-[24px] border border-white/10 bg-slate-900/80 p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-[0.25em] text-slate-400">
                Gateway status
              </span>
              <span
                className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] ${
                  connectionState.tone === "good"
                    ? "bg-emerald-400/15 text-emerald-200"
                    : connectionState.tone === "bad"
                      ? "bg-rose-400/15 text-rose-200"
                      : "bg-white/10 text-slate-200"
                }`}
              >
                {connectionState.label}
              </span>
            </div>
            <div className="grid gap-2 text-sm text-slate-300">
              <p>Model: Anthropic Claude Sonnet 4.5</p>
              <p>Transport: Next.js route handler → OpenClaw websocket</p>
              <p>Mode: Server-mediated streaming</p>
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-900/85">
          <div
            ref={listRef}
            className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6"
          >
            {messages.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-white/5 p-6 text-sm leading-7 text-slate-300">
                Start with a prompt like{" "}
                <span className="font-mono text-amber-200">
                  Summarize why websocket streaming matters here.
                </span>
              </div>
            ) : null}

            {messages.map((message) => (
              <article
                key={message.id}
                className={`max-w-3xl rounded-[24px] px-4 py-3 shadow-[0_14px_32px_rgba(15,23,42,0.25)] ${
                  message.role === "user"
                    ? "ml-auto bg-amber-300 text-slate-950"
                    : message.status === "error"
                      ? "bg-rose-300/12 text-rose-100"
                      : "bg-white/6 text-slate-100"
                }`}
              >
                <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.22em] opacity-70">
                  {message.role === "user" ? "Operator" : "Assistant"}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-7 sm:text-[15px]">
                  {message.content || "Streaming..."}
                </p>
              </article>
            ))}
          </div>

          <form
            onSubmit={handleSubmit}
            className="border-t border-white/10 bg-black/10 p-4 sm:p-5"
          >
            <div className="flex flex-col gap-3 lg:flex-row">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Send a message through OpenClaw..."
                rows={3}
                className="min-h-28 flex-1 resize-none rounded-[22px] border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/25"
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-[22px] bg-amber-300 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-amber-100"
              >
                {isSubmitting ? "Streaming..." : "Send"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
