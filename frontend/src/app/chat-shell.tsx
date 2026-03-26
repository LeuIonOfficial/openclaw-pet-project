"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

type AgentProfile = {
  id: string;
  name: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
};

type ChatThread = {
  id: string;
  agentId: string;
  sessionKey: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

type AgentTemplate = {
  id: string;
  name: string;
  instructions: string;
};

const initialConnectionState: ConnectionState = {
  label: "Checking gateway",
  tone: "neutral",
};

const STORAGE_THREADS_KEY = "openclaw.chat.threads.v2";
const STORAGE_ACTIVE_THREAD_KEY = "openclaw.chat.active-thread.v2";
const STORAGE_AGENTS_KEY = "openclaw.chat.agents.v2";
const STORAGE_SELECTED_AGENT_KEY = "openclaw.chat.selected-agent.v2";

const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "agent-general",
    name: "General Assistant",
    instructions:
      "Provide clear, actionable answers. Keep responses concise unless the user asks for detail.",
  },
  {
    id: "agent-travel",
    name: "Travel Agent",
    instructions:
      "Act as a travel planner. Ask clarifying questions when dates, budget, or destination details are missing. Provide practical itineraries and options.",
  },
  {
    id: "agent-career",
    name: "Career Manager",
    instructions:
      "Act as a career coach. Give direct guidance on goals, skills, resume strategy, interview prep, and next steps.",
  },
];

function createDefaultAgents(): AgentProfile[] {
  const now = Date.now();

  return AGENT_TEMPLATES.map((template) => ({
    ...template,
    createdAt: now,
    updatedAt: now,
  }));
}

function sortThreadsByRecent(threads: ChatThread[]): ChatThread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

function toSessionPart(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return normalized.slice(0, 40) || "agent";
}

function buildSessionKey(agentId: string, threadId: string): string {
  return `agent:${toSessionPart(agentId)}:chat:${toSessionPart(threadId)}`;
}

function createThread(agentId: string): ChatThread {
  const now = Date.now();
  const id = crypto.randomUUID();

  return {
    id,
    agentId,
    sessionKey: buildSessionKey(agentId, id),
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
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

function mergeStreamText(previous: string, incoming: string): string {
  if (!incoming) {
    return previous;
  }

  if (!previous) {
    return incoming;
  }

  // Some providers stream cumulative snapshots ("full text so far").
  if (incoming.startsWith(previous)) {
    return incoming;
  }

  // Ignore shorter regressions during intermittent stream hiccups.
  if (previous.startsWith(incoming)) {
    return previous;
  }

  // Token streams can arrive with overlapping boundaries; dedupe overlap.
  const maxOverlap = Math.min(previous.length, incoming.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    if (previous.slice(-size) === incoming.slice(0, size)) {
      return `${previous}${incoming.slice(size)}`;
    }
  }

  return `${previous}${incoming}`;
}

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm leading-7 sm:text-[15px] [&_a]:text-amber-200 [&_a]:underline [&_blockquote]:mb-4 [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_code]:rounded-md [&_code]:bg-black/30 [&_code]:px-1.5 [&_code]:py-0.5 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-4 [&_p:last-child]:mb-0 [&_pre]:mb-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-black/35 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
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

function normalizeStoredAgents(value: unknown): AgentProfile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const agent = entry as Partial<AgentProfile>;

      if (
        typeof agent.id !== "string" ||
        typeof agent.name !== "string" ||
        typeof agent.instructions !== "string"
      ) {
        return null;
      }

      if (seen.has(agent.id)) {
        return null;
      }

      seen.add(agent.id);

      return {
        id: agent.id,
        name: agent.name.trim() || "Custom Agent",
        instructions: agent.instructions.trim(),
        createdAt: typeof agent.createdAt === "number" ? agent.createdAt : Date.now(),
        updatedAt: typeof agent.updatedAt === "number" ? agent.updatedAt : Date.now(),
      } as AgentProfile;
    })
    .filter((agent): agent is AgentProfile => agent !== null);

  return normalized;
}

function normalizeStoredThreads(
  value: unknown,
  fallbackAgentId: string,
  validAgentIds: Set<string>,
): ChatThread[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const thread = entry as Partial<ChatThread> & {
        agentId?: unknown;
        sessionKey?: unknown;
      };

      if (
        typeof thread.id !== "string" ||
        typeof thread.title !== "string" ||
        !Array.isArray(thread.messages)
      ) {
        return null;
      }

      const storedAgentId =
        typeof thread.agentId === "string" && validAgentIds.has(thread.agentId)
          ? thread.agentId
          : fallbackAgentId;
      const storedSessionKey =
        typeof thread.sessionKey === "string" && thread.sessionKey.trim()
          ? thread.sessionKey.trim()
          : buildSessionKey(storedAgentId, thread.id);

      return {
        id: thread.id,
        agentId: storedAgentId,
        sessionKey: storedSessionKey,
        title: thread.title.trim() || "New chat",
        createdAt: typeof thread.createdAt === "number" ? thread.createdAt : Date.now(),
        updatedAt: typeof thread.updatedAt === "number" ? thread.updatedAt : Date.now(),
        messages: thread.messages.filter(isMessage),
      } as ChatThread;
    })
    .filter((thread): thread is ChatThread => thread !== null);

  return sortThreadsByRecent(normalized);
}

function createAgent(name: string, instructions: string): AgentProfile {
  const now = Date.now();

  return {
    id: `agent-${crypto.randomUUID()}`,
    name,
    instructions,
    createdAt: now,
    updatedAt: now,
  };
}

export function ChatShell() {
  const [agents, setAgents] = useState<AgentProfile[]>(() => createDefaultAgents());
  const [threads, setThreads] = useState<ChatThread[]>(() => [
    createThread(AGENT_TEMPLATES[0].id),
  ]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>(AGENT_TEMPLATES[0].id);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentInstructions, setNewAgentInstructions] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    initialConnectionState,
  );

  const listRef = useRef<HTMLDivElement | null>(null);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null,
    [activeThreadId, threads],
  );
  const activeAgent = useMemo(
    () =>
      agents.find((agent) => agent.id === (activeThread?.agentId ?? selectedAgentId)) ??
      agents.find((agent) => agent.id === selectedAgentId) ??
      agents[0] ??
      null,
    [activeThread?.agentId, agents, selectedAgentId],
  );
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  );
  const visibleThreads = useMemo(
    () => threads.filter((thread) => thread.agentId === selectedAgentId),
    [selectedAgentId, threads],
  );
  const activeMessageCount = activeThread?.messages.length ?? 0;

  useEffect(() => {
    const defaultAgents = createDefaultAgents();

    try {
      const rawAgents = localStorage.getItem(STORAGE_AGENTS_KEY);
      const parsedAgents = rawAgents
        ? normalizeStoredAgents(JSON.parse(rawAgents))
        : defaultAgents;
      const resolvedAgents = parsedAgents.length ? parsedAgents : defaultAgents;

      const validAgentIds = new Set(resolvedAgents.map((agent) => agent.id));
      const fallbackAgentId = resolvedAgents[0].id;

      const rawThreads = localStorage.getItem(STORAGE_THREADS_KEY);
      const parsedThreads = rawThreads
        ? normalizeStoredThreads(
            JSON.parse(rawThreads),
            fallbackAgentId,
            validAgentIds,
          )
        : [];
      const resolvedThreads = parsedThreads.length
        ? parsedThreads
        : [createThread(fallbackAgentId)];

      const rawActiveThreadId = localStorage.getItem(STORAGE_ACTIVE_THREAD_KEY);
      const rawSelectedAgentId = localStorage.getItem(STORAGE_SELECTED_AGENT_KEY);
      const resolvedActiveThreadId =
        rawActiveThreadId && resolvedThreads.some((thread) => thread.id === rawActiveThreadId)
          ? rawActiveThreadId
          : resolvedThreads[0].id;
      const resolvedSelectedAgentId =
        rawSelectedAgentId && validAgentIds.has(rawSelectedAgentId)
          ? rawSelectedAgentId
          : resolvedThreads.find((thread) => thread.id === resolvedActiveThreadId)?.agentId ??
            fallbackAgentId;

      setAgents(resolvedAgents);
      setThreads(resolvedThreads);
      setActiveThreadId(resolvedActiveThreadId);
      setSelectedAgentId(resolvedSelectedAgentId);
    } catch {
      const fallbackThread = createThread(defaultAgents[0].id);
      setAgents(defaultAgents);
      setThreads([fallbackThread]);
      setActiveThreadId(fallbackThread.id);
      setSelectedAgentId(defaultAgents[0].id);
    }
  }, []);

  useEffect(() => {
    if (!activeThread && threads.length) {
      setActiveThreadId(threads[0].id);
    }
  }, [activeThread, threads]);

  useEffect(() => {
    if (!selectedAgent && agents.length) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgent]);

  useEffect(() => {
    localStorage.setItem(STORAGE_AGENTS_KEY, JSON.stringify(agents));
  }, [agents]);

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
    if (!selectedAgentId) {
      return;
    }

    localStorage.setItem(STORAGE_SELECTED_AGENT_KEY, selectedAgentId);
  }, [selectedAgentId]);

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

  function createThreadForAgent(agentId: string) {
    if (isSubmitting) {
      return;
    }

    const next = createThread(agentId);

    setThreads((current) => sortThreadsByRecent([next, ...current]));
    setActiveThreadId(next.id);
    setSelectedAgentId(agentId);
    setInput("");
    setIsSidebarOpen(false);
  }

  function handleSelectAgent(agentId: string) {
    setSelectedAgentId(agentId);

    const nextActiveThread = threads.find((thread) => thread.agentId === agentId);

    if (nextActiveThread) {
      setActiveThreadId(nextActiveThread.id);
    }
  }

  function handleCreateAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const name = newAgentName.trim();
    const instructions = newAgentInstructions.trim();

    if (!name || !instructions) {
      return;
    }

    const agent = createAgent(name, instructions);

    setAgents((current) => [agent, ...current]);
    setNewAgentName("");
    setNewAgentInstructions("");
    setIsCreatingAgent(false);
    createThreadForAgent(agent.id);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = input.trim();
    const targetThread = activeThread;

    if (!message || isSubmitting || !targetThread) {
      return;
    }

    const targetAgent =
      agents.find((agent) => agent.id === targetThread.agentId) ?? selectedAgent;

    if (!targetAgent) {
      return;
    }

    const targetThreadId = targetThread.id;

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
        body: JSON.stringify({
          message,
          sessionKey: targetThread.sessionKey,
          agentName: targetAgent.name,
          agentPrompt: targetAgent.instructions,
        }),
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
                        content: mergeStreamText(entry.content, payload.text),
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
    <main className="relative h-screen overflow-hidden bg-[#040714] text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-20%] h-[48vh] w-[48vh] rounded-full bg-sky-400/10 blur-3xl" />
        <div className="absolute -right-20 bottom-[-22%] h-[44vh] w-[44vh] rounded-full bg-amber-300/10 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(to_right,rgba(148,163,184,0.04)_1px,transparent_1px)] bg-[size:42px_42px]" />
      </div>

      <div className="relative mx-auto h-full max-w-[1620px] p-3 sm:p-4">
        <div className="app-enter grid h-full overflow-hidden rounded-[30px] border border-white/10 bg-slate-950/72 shadow-[0_28px_90px_rgba(2,6,23,0.58)] lg:grid-cols-[340px_minmax(0,1fr)]">
          {isSidebarOpen ? (
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 z-20 bg-black/45 lg:hidden"
              aria-label="Close sidebar"
            />
          ) : null}

          <aside
            className={`fixed inset-y-0 left-0 z-30 flex w-[316px] flex-col border-r border-white/10 bg-slate-950/96 px-3 py-4 transition-transform duration-300 lg:static lg:z-auto lg:w-[340px] lg:translate-x-0 lg:bg-slate-950/70 ${
              isSidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="app-enter-soft mb-4 flex items-center justify-between border-b border-white/10 px-1 pb-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-slate-400">
                  OpenClaw
                </p>
                <p className="text-base font-semibold text-slate-100">Agent Workspace</p>
              </div>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                className="h-8 rounded-lg border border-white/15 px-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-300 lg:hidden"
              >
                Close
              </button>
            </div>

            <button
              type="button"
              onClick={() => createThreadForAgent(selectedAgent?.id ?? AGENT_TEMPLATES[0].id)}
              disabled={isSubmitting}
              className="mb-4 rounded-2xl border border-amber-300/45 bg-amber-300/90 px-4 py-3 text-left text-sm font-semibold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-65"
            >
              + New Chat
            </button>

            <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">
              Agents
            </div>

            <div className="mb-4 space-y-1 overflow-y-auto pr-1">
              {agents.map((agent, index) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => handleSelectAgent(agent.id)}
                  style={{ animationDelay: `${index * 35}ms` }}
                  className={`app-enter-soft row-shift flex w-full flex-col rounded-xl border px-3 py-2.5 text-left ${
                    selectedAgentId === agent.id
                      ? "border-sky-300/40 bg-sky-300/10"
                      : "border-transparent bg-white/5 hover:border-white/15 hover:bg-white/10"
                  }`}
                >
                  <span className="line-clamp-1 text-sm font-medium text-slate-100">
                    {agent.name}
                  </span>
                  <span className="line-clamp-2 text-xs leading-5 text-slate-400">
                    {agent.instructions}
                  </span>
                </button>
              ))}
            </div>

            {isCreatingAgent ? (
              <form
                onSubmit={handleCreateAgent}
                className="mb-4 space-y-2 rounded-xl border border-white/15 bg-white/5 p-3"
              >
                <input
                  value={newAgentName}
                  onChange={(event) => setNewAgentName(event.target.value)}
                  placeholder="Agent name"
                  className="h-10 w-full rounded-lg border border-white/15 bg-slate-950/85 px-3 text-sm text-slate-100 outline-none focus:border-amber-300/70"
                />
                <textarea
                  value={newAgentInstructions}
                  onChange={(event) => setNewAgentInstructions(event.target.value)}
                  placeholder="Agent instructions"
                  rows={4}
                  className="w-full resize-none rounded-lg border border-white/15 bg-slate-950/85 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-300/70"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={!newAgentName.trim() || !newAgentInstructions.trim()}
                    className="h-9 flex-1 rounded-lg bg-amber-300 text-xs font-semibold uppercase tracking-[0.14em] text-slate-950 disabled:cursor-not-allowed disabled:bg-amber-100"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreatingAgent(false);
                      setNewAgentName("");
                      setNewAgentInstructions("");
                    }}
                    className="h-9 rounded-lg border border-white/20 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setIsCreatingAgent(true)}
                className="mb-4 h-10 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-200 transition hover:bg-white/10"
              >
                + Create Agent
              </button>
            )}

            <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">
              {selectedAgent?.name ?? "Agent"} Chats
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {visibleThreads.length ? (
                visibleThreads.map((thread, index) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => {
                      setActiveThreadId(thread.id);
                      setSelectedAgentId(thread.agentId);
                      setIsSidebarOpen(false);
                    }}
                    style={{ animationDelay: `${index * 28}ms` }}
                    className={`app-enter-soft row-shift flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left ${
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
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-3 text-xs leading-6 text-slate-300">
                  No chats yet for this agent.
                </div>
              )}
            </div>
          </aside>

          <section className="relative flex min-h-0 min-w-0 flex-col">
            <header className="app-enter-soft flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(true)}
                  className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/15 lg:hidden"
                >
                  Agents
                </button>
                <div className="min-w-0">
                  <p className="line-clamp-1 text-lg font-semibold text-slate-100">
                    {activeThread?.title ?? "New chat"}
                  </p>
                  <p className="line-clamp-1 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-400">
                    {activeAgent?.name ?? "Assistant"} • isolated session
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300 sm:inline-flex">
                  Live stream
                </span>
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
              </div>
            </header>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-10">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                {(activeThread?.messages.length ?? 0) === 0 ? (
                  <div className="app-enter-soft rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-sm leading-7 text-slate-300">
                    No messages in this chat yet. This thread is attached to{" "}
                    <span className="font-semibold text-slate-100">
                      {activeAgent?.name ?? "Assistant"}
                    </span>
                    . Start with your task and it will stay isolated in this session.
                  </div>
                ) : null}

                {activeThread?.messages.map((message, index) => (
                  <article
                    key={message.id}
                    style={{ animationDelay: `${Math.min(index, 10) * 28}ms` }}
                    className={`message-enter rounded-2xl px-4 py-3 sm:px-5 ${
                      message.role === "user"
                        ? "ml-auto max-w-3xl border border-amber-200/20 bg-amber-300 text-slate-950"
                        : message.status === "error"
                          ? "mr-auto max-w-3xl border border-rose-300/30 bg-rose-300/15 text-rose-100"
                          : "mr-auto max-w-3xl border border-white/10 bg-white/8 text-slate-100"
                    }`}
                  >
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] opacity-70 sm:text-[11px]">
                      {message.role === "user" ? "Operator" : activeAgent?.name ?? "Assistant"}
                    </p>
                    {message.role === "assistant" ? (
                      message.content ? (
                        <AssistantMarkdown content={message.content} />
                      ) : (
                        <p className="text-sm leading-7 sm:text-[15px]">Streaming...</p>
                      )
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-7 sm:text-[15px]">
                        {message.content || "Streaming..."}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="border-t border-white/10 bg-slate-950/72 px-4 py-4 backdrop-blur sm:px-8 sm:py-5"
            >
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:flex-row sm:items-end">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={`Message ${activeAgent?.name ?? "assistant"}...`}
                  rows={3}
                  className="min-h-[104px] flex-1 resize-none rounded-2xl border border-white/15 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/25"
                />
                <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    {input.trim().length} chars
                  </span>
                  <button
                    type="submit"
                    disabled={isSubmitting || !activeThread}
                    className="h-11 rounded-xl bg-amber-300 px-6 text-sm font-semibold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-amber-100"
                  >
                    {isSubmitting ? "Streaming..." : "Send"}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
