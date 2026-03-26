"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

import { AGENT_TEMPLATES, INITIAL_CONNECTION_STATE, STORAGE_KEYS } from "./constants";
import {
  createAgent,
  createDefaultAgents,
  createThread,
  deriveTitleFromMessage,
  mergeStreamText,
  normalizeStoredAgents,
  normalizeStoredThreads,
  parseJson,
  sortThreadsByRecent,
} from "./helpers";
import type {
  AgentProfile,
  ChatStreamPayload,
  ChatThread,
  ConnectionState,
  HealthResponse,
  Message,
} from "./types";

type AssistantMessageUpdater = (message: Message) => Message;

function parseStreamPayload(rawEvent: string): ChatStreamPayload | null {
  const line = rawEvent
    .split("\n")
    .find((entry) => entry.startsWith("data: "));

  if (!line) {
    return null;
  }

  const parsed = parseJson(line.slice(6));

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const payload = parsed as Partial<ChatStreamPayload>;

  if (payload.type === "status" && typeof payload.stage === "string") {
    return payload as ChatStreamPayload;
  }

  if (payload.type === "delta" && typeof payload.text === "string") {
    return payload as ChatStreamPayload;
  }

  if (payload.type === "final" && typeof payload.text === "string") {
    return payload as ChatStreamPayload;
  }

  if (payload.type === "error" && typeof payload.message === "string") {
    return payload as ChatStreamPayload;
  }

  return null;
}

export type ChatWorkspaceController = {
  listRef: RefObject<HTMLDivElement | null>;
  agents: AgentProfile[];
  selectedAgent: AgentProfile | null;
  selectedAgentId: string;
  activeAgent: AgentProfile | null;
  visibleThreads: ChatThread[];
  activeThread: ChatThread | null;
  connectionState: ConnectionState;
  input: string;
  inputLength: number;
  isSubmitting: boolean;
  isSidebarOpen: boolean;
  isCreatingAgent: boolean;
  newAgentName: string;
  newAgentInstructions: string;
  setSidebarOpen: (isOpen: boolean) => void;
  setInputValue: (value: string) => void;
  setNewAgentNameValue: (value: string) => void;
  setNewAgentInstructionsValue: (value: string) => void;
  startCreateAgent: () => void;
  cancelCreateAgent: () => void;
  createThreadForSelectedAgent: () => void;
  selectAgent: (agentId: string) => void;
  selectThread: (thread: ChatThread) => void;
  handleCreateAgent: (event: FormEvent<HTMLFormElement>) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function useChatWorkspace(): ChatWorkspaceController {
  const [agents, setAgents] = useState<AgentProfile[]>(() => createDefaultAgents());
  const [threads, setThreads] = useState<ChatThread[]>(() => [
    createThread(AGENT_TEMPLATES[0].id),
  ]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState(AGENT_TEMPLATES[0].id);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentInstructions, setNewAgentInstructions] = useState("");
  const [connectionState, setConnectionState] = useState(INITIAL_CONNECTION_STATE);
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

  const updateThread = useCallback(
    (threadId: string, updater: (currentThread: ChatThread) => ChatThread) => {
      setThreads((current) => {
        const next = current.map((thread) =>
          thread.id === threadId ? updater(thread) : thread,
        );

        return sortThreadsByRecent(next);
      });
    },
    [],
  );

  const updateAssistantMessage = useCallback(
    (
      threadId: string,
      assistantMessageId: string,
      updater: AssistantMessageUpdater,
    ) => {
      updateThread(threadId, (thread) => ({
        ...thread,
        updatedAt: Date.now(),
        messages: thread.messages.map((entry) =>
          entry.id === assistantMessageId ? updater(entry) : entry,
        ),
      }));
    },
    [updateThread],
  );

  const createThreadForAgent = useCallback(
    (agentId: string) => {
      if (isSubmitting) {
        return;
      }

      const next = createThread(agentId);

      setThreads((current) => sortThreadsByRecent([next, ...current]));
      setActiveThreadId(next.id);
      setSelectedAgentId(agentId);
      setInput("");
      setIsSidebarOpen(false);
    },
    [isSubmitting],
  );

  useEffect(() => {
    const defaultAgents = createDefaultAgents();

    const parsedAgents = normalizeStoredAgents(
      parseJson(localStorage.getItem(STORAGE_KEYS.agents)),
    );
    const resolvedAgents = parsedAgents.length ? parsedAgents : defaultAgents;
    const validAgentIds = new Set(resolvedAgents.map((agent) => agent.id));
    const fallbackAgentId = resolvedAgents[0].id;

    const parsedThreads = normalizeStoredThreads(
      parseJson(localStorage.getItem(STORAGE_KEYS.threads)),
      fallbackAgentId,
      validAgentIds,
    );
    const resolvedThreads = parsedThreads.length
      ? parsedThreads
      : [createThread(fallbackAgentId)];

    const rawActiveThreadId = localStorage.getItem(STORAGE_KEYS.activeThread);
    const rawSelectedAgentId = localStorage.getItem(STORAGE_KEYS.selectedAgent);
    const resolvedActiveThreadId =
      rawActiveThreadId &&
      resolvedThreads.some((thread) => thread.id === rawActiveThreadId)
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
    localStorage.setItem(STORAGE_KEYS.agents, JSON.stringify(agents));
  }, [agents]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.threads, JSON.stringify(threads));
  }, [threads]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }

    localStorage.setItem(STORAGE_KEYS.activeThread, activeThreadId);
  }, [activeThreadId]);

  useEffect(() => {
    if (!selectedAgentId) {
      return;
    }

    localStorage.setItem(STORAGE_KEYS.selectedAgent, selectedAgentId);
  }, [selectedAgentId]);

  useEffect(() => {
    void fetch("/api/health")
      .then(async (response) => {
        const payload = (await response.json()) as HealthResponse;

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

  const selectAgent = useCallback(
    (agentId: string) => {
      setSelectedAgentId(agentId);

      const nextActiveThread = threads.find((thread) => thread.agentId === agentId);

      if (nextActiveThread) {
        setActiveThreadId(nextActiveThread.id);
      }
    },
    [threads],
  );

  const selectThread = useCallback((thread: ChatThread) => {
    setActiveThreadId(thread.id);
    setSelectedAgentId(thread.agentId);
    setIsSidebarOpen(false);
  }, []);

  const handleCreateAgent = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
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
    },
    [createThreadForAgent, isSubmitting, newAgentInstructions, newAgentName],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
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
            const payload = parseStreamPayload(rawEvent);

            if (!payload) {
              continue;
            }

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
                updateAssistantMessage(
                  targetThreadId,
                  assistantMessageId,
                  (entry) => ({
                    ...entry,
                    content: mergeStreamText(entry.content, payload.text),
                  }),
                );
              });
              continue;
            }

            if (payload.type === "final") {
              startTransition(() => {
                updateAssistantMessage(
                  targetThreadId,
                  assistantMessageId,
                  (entry) => ({
                    ...entry,
                    content: payload.text || entry.content,
                    status: "done",
                  }),
                );
                setConnectionState({
                  label: "Gateway ready",
                  tone: "good",
                });
              });
              continue;
            }

            startTransition(() => {
              updateAssistantMessage(
                targetThreadId,
                assistantMessageId,
                (entry) => ({
                  ...entry,
                  content: payload.message,
                  status: "error",
                }),
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
          updateAssistantMessage(
            targetThreadId,
            assistantMessageId,
            (entry) => ({
              ...entry,
              content:
                error instanceof Error
                  ? error.message
                  : "Unexpected request failure.",
              status: "error",
            }),
          );
          setConnectionState({
            label: "Gateway error",
            tone: "bad",
          });
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      activeThread,
      agents,
      input,
      isSubmitting,
      selectedAgent,
      updateAssistantMessage,
      updateThread,
    ],
  );

  const createThreadForSelectedAgent = useCallback(() => {
    createThreadForAgent(selectedAgent?.id ?? AGENT_TEMPLATES[0].id);
  }, [createThreadForAgent, selectedAgent?.id]);

  const startCreateAgent = useCallback(() => {
    setIsCreatingAgent(true);
  }, []);

  const cancelCreateAgent = useCallback(() => {
    setIsCreatingAgent(false);
    setNewAgentName("");
    setNewAgentInstructions("");
  }, []);

  const setSidebarOpen = useCallback((isOpen: boolean) => {
    setIsSidebarOpen(isOpen);
  }, []);

  const setInputValue = useCallback((value: string) => {
    setInput(value);
  }, []);

  const setNewAgentNameValue = useCallback((value: string) => {
    setNewAgentName(value);
  }, []);

  const setNewAgentInstructionsValue = useCallback((value: string) => {
    setNewAgentInstructions(value);
  }, []);

  return {
    listRef,
    agents,
    selectedAgent,
    selectedAgentId,
    activeAgent,
    visibleThreads,
    activeThread,
    connectionState,
    input,
    inputLength: input.trim().length,
    isSubmitting,
    isSidebarOpen,
    isCreatingAgent,
    newAgentName,
    newAgentInstructions,
    setSidebarOpen,
    setInputValue,
    setNewAgentNameValue,
    setNewAgentInstructionsValue,
    startCreateAgent,
    cancelCreateAgent,
    createThreadForSelectedAgent,
    selectAgent,
    selectThread,
    handleCreateAgent,
    handleSubmit,
  };
}
