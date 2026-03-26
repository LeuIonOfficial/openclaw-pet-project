"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";

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

type ChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

const initialConnectionState: ConnectionState = {
  label: "Checking gateway",
  tone: "neutral",
};

const STORAGE_THREADS_KEY = "openclaw.chat.threads.v1";
const STORAGE_ACTIVE_THREAD_KEY = "openclaw.chat.active-thread.v1";

function createThread(): ChatThread {
  const now = Date.now();

  return {
    id: crypto.randomUUID(),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function sortThreadsByRecent(threads: ChatThread[]): ChatThread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

function deriveTitleFromMessage(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "New chat";
  }

  return normalized.length > 44 ? `${normalized.slice(0, 44)}…` : normalized;
}

function getThreadPreview(thread: ChatThread): string {
  if (!thread.messages.length) {
    return "No messages yet.";
  }

  const last = thread.messages[thread.messages.length - 1];
  const normalized = last.content.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return last.role === "assistant" ? "Streaming..." : "Empty message";
  }

  return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized;
}

function formatUpdatedAt(timestamp: number): string {
  if (!timestamp) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") {
    return false;
  }

  const item = value as Partial<Message>;
  return (
    typeof item.id === "string" &&
    (item.role === "user" || item.role === "assistant") &&
    typeof item.content === "string" &&
    (item.status === "done" || item.status === "streaming" || item.status === "error")
  );
}

function normalizeStoredThreads(value: unknown): ChatThread[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const thread = entry as Partial<ChatThread>;

      if (
        typeof thread.id !== "string" ||
        typeof thread.title !== "string" ||
        !Array.isArray(thread.messages)
      ) {
        return null;
      }

      return {
        id: thread.id,
        title: thread.title.trim() || "New chat",
        createdAt: typeof thread.createdAt === "number" ? thread.createdAt : Date.now(),
        updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : Date.now(),
        messages: thread.messages.filter(isMessage),
      } as ChatThread;
    })
    .filter((thread): thread is ChatThread => thread !== null);

  return sortThreadsByRecent(normalized);
}

export function ChatShell() {
  const [threads, setThreads] = useState<ChatThread[]>(() => [createThread()]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    initialConnectionState,
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null,
    [activeThreadId, threads],
  );
  const activeMessageCount = activeThread?.messages.length ?? 0;

  useEffect(() => {
    const fallbackThread = createThread();

    try {
      const savedThreadsRaw = localStorage.getItem(STORAGE_THREADS_KEY);
      const savedActiveThreadId = localStorage.getItem(STORAGE_ACTIVE_THREAD_KEY);
      const loadedThreads = savedThreadsRaw
        ? normalizeStoredThreads(JSON.parse(savedThreadsRaw))
        : [];
      const resolvedThreads = loadedThreads.length ? loadedThreads : [fallbackThread];

      setThreads(resolvedThreads);
      setActiveThreadId(
        savedActiveThreadId &&
          resolvedThreads.some((thread) => thread.id === savedActiveThreadId)
          ? savedActiveThreadId
          : resolvedThreads[0].id,
      );
    } catch {
      setThreads([fallbackThread]);
      setActiveThreadId(fallbackThread.id);
    }
  }, []);

  useEffect(() => {
    if (!activeThread && threads.length) {
      setActiveThreadId(threads[0].id);
    }
  }, [activeThread, threads]);

  useEffect(() => {
    localStorage.setItem(STORAGE_THREADS_KEY, JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }

    localStorage.setItem(STORAGE_ACTIVE_THREAD_KEY, activeThreadId);
  }, [activeThreadId]);

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
  }, [activeThreadId, activeMessageCount]);

  function updateThread(
    threadId: string,
    updater: (currentThread: ChatThread) => ChatThread,
  ) {
    setThreads((current) => {
      const next = current.map((thread) =>
        thread.id === threadId ? updater(thread) : thread,
      );
      return sortThreadsByRecent(next);
    });
  }

  function handleCreateThread() {
    if (isSubmitting) {
      return;
    }

    const next = createThread();
    setThreads((current) => [next, ...current]);
    setActiveThreadId(next.id);
    setInput("");
    setIsSidebarOpen(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = input.trim();
    const targetThreadId = activeThread?.id;

    if (!message || isSubmitting || !targetThreadId) {
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
    updateThread(targetThreadId, (thread) => ({
      ...thread,
      title:
        thread.messages.length === 0
          ? deriveTitleFromMessage(message)
          : thread.title,
      updatedAt: Date.now(),
      messages: [
        ...thread.messages,
        userMessage,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          status: "streaming",
        },
      ],
    }));

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
              updateThread(targetThreadId, (thread) => ({
                ...thread,
                updatedAt: Date.now(),
                messages: thread.messages.map((entry) =>
                  entry.id === assistantMessageId
                    ? {
                        ...entry,
                        content: `${entry.content}${payload.text}`,
                      }
                    : entry,
                ),
              }));
            });
            continue;
          }

          if (payload.type === "final") {
            startTransition(() => {
              updateThread(targetThreadId, (thread) => ({
                ...thread,
                updatedAt: Date.now(),
                messages: thread.messages.map((entry) =>
                  entry.id === assistantMessageId
                    ? {
                        ...entry,
                        content: payload.text || entry.content,
                        status: "done",
                      }
                    : entry,
                ),
              }));
              setConnectionState({
                label: "Gateway ready",
                tone: "good",
              });
            });
            continue;
          }

          startTransition(() => {
            updateThread(targetThreadId, (thread) => ({
              ...thread,
              updatedAt: Date.now(),
              messages: thread.messages.map((entry) =>
                entry.id === assistantMessageId
                  ? {
                      ...entry,
                      content: payload.message,
                      status: "error",
                    }
                  : entry,
              ),
            }));
            setConnectionState({
              label: "Gateway error",
              tone: "bad",
            });
          });
        }
      }
    } catch (error) {
      startTransition(() => {
        updateThread(targetThreadId, (thread) => ({
          ...thread,
          updatedAt: Date.now(),
          messages: thread.messages.map((entry) =>
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
        }));
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
    <main className="h-screen bg-[radial-gradient(circle_at_top_left,_rgba(148,163,184,0.2),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(245,158,11,0.16),_transparent_32%),linear-gradient(180deg,_#0f172a_0%,_#020617_100%)] p-3 text-slate-100 sm:p-4">
      <div className="mx-auto flex h-full max-w-[1500px] overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/70 shadow-[0_20px_80px_rgba(2,6,23,0.55)] backdrop-blur">
        {isSidebarOpen ? (
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 z-20 bg-black/50 lg:hidden"
            aria-label="Close history sidebar"
          />
        ) : null}

        <aside
          className={`fixed inset-y-0 left-0 z-30 flex w-[296px] flex-col border-r border-white/10 bg-slate-950/95 px-3 py-3 transition-transform duration-200 lg:static lg:z-auto lg:w-[320px] lg:translate-x-0 lg:bg-slate-950/75 ${
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <button
            type="button"
            onClick={handleCreateThread}
            disabled={isSubmitting}
            className="mb-3 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium text-slate-100 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            + New chat
          </button>

          <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-400">
            History
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => {
                  setActiveThreadId(thread.id);
                  setIsSidebarOpen(false);
                }}
                className={`flex w-full flex-col gap-1 rounded-2xl border px-3 py-3 text-left transition ${
                  activeThread?.id === thread.id
                    ? "border-amber-300/40 bg-amber-300/10"
                    : "border-transparent bg-white/5 hover:border-white/15 hover:bg-white/10"
                }`}
              >
                <span className="line-clamp-1 text-sm font-medium text-slate-100">
                  {thread.title}
                </span>
                <span className="line-clamp-2 text-xs leading-5 text-slate-400">
                  {getThreadPreview(thread)}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  {formatUpdatedAt(thread.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/15 lg:hidden"
              >
                History
              </button>
              <div className="min-w-0">
                <p className="line-clamp-1 text-sm font-semibold text-slate-100 sm:text-base">
                  {activeThread?.title ?? "New chat"}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400 sm:text-[11px]">
                  OpenClaw streaming chat
                </p>
              </div>
            </div>
            <div
              className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] sm:text-[11px] ${
                connectionState.tone === "good"
                  ? "bg-emerald-400/15 text-emerald-200"
                  : connectionState.tone === "bad"
                    ? "bg-rose-400/15 text-rose-200"
                    : "bg-white/10 text-slate-200"
              }`}
            >
              {connectionState.label}
            </div>
          </header>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
              {(activeThread?.messages.length ?? 0) === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/15 bg-white/5 p-6 text-sm leading-7 text-slate-300">
                  Your chat history lives in the left sidebar. Start this thread with
                  a prompt like{" "}
                  <span className="font-mono text-amber-200">
                    Explain how OpenClaw streaming works in this app.
                  </span>
                </div>
              ) : null}

              {activeThread?.messages.map((message) => (
                <article
                  key={message.id}
                  className={`rounded-3xl px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.35)] sm:px-5 ${
                    message.role === "user"
                      ? "ml-auto max-w-3xl bg-amber-300 text-slate-950"
                      : message.status === "error"
                        ? "mr-auto max-w-3xl bg-rose-300/15 text-rose-100"
                        : "mr-auto max-w-3xl bg-white/8 text-slate-100"
                  }`}
                >
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] opacity-70 sm:text-[11px]">
                    {message.role === "user" ? "Operator" : "Assistant"}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-7 sm:text-[15px]">
                    {message.content || "Streaming..."}
                  </p>
                </article>
              ))}
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="border-t border-white/10 bg-black/10 px-4 py-4 sm:px-6"
          >
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 sm:flex-row sm:items-end">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Send a message through OpenClaw..."
                rows={3}
                className="min-h-[96px] flex-1 resize-none rounded-3xl border border-white/15 bg-slate-950/90 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/25"
              />
              <button
                type="submit"
                disabled={isSubmitting || !activeThread}
                className="h-11 rounded-2xl bg-amber-300 px-6 text-sm font-semibold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-amber-100"
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
