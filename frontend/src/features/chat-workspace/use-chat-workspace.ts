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

import { INITIAL_CONNECTION_STATE, STORAGE_KEYS } from "./constants";
import {
  createAgent,
  createDefaultAgents,
  createThread,
  deriveTitleFromMessage,
  normalizeStoredAgents,
  normalizeStoredThreads,
  parseJson,
  sortThreadsByRecent,
} from "./helpers";
import type {
  AgentBootstrapResponse,
  AgentProfile,
  ChatStreamPayload,
  ChatThread,
  ConnectionState,
  GatewayConfigPayload,
  GatewayConfigResponse,
  HealthResponse,
  Message,
  MessageAttachment,
  ToolCallTrace,
} from "./types";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from "@/lib/schemas/chat";
import { configDraftSchema } from "@/lib/schemas/config";

type AssistantMessageUpdater = (message: Message) => Message;

function safeStringify(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeToolOutput(payload: ChatStreamPayload): string | undefined {
  if (payload.type !== "tool") {
    return undefined;
  }

  if (payload.phase === "update") {
    return safeStringify(payload.partialResult);
  }

  if (payload.phase === "result") {
    return safeStringify(payload.result);
  }

  return undefined;
}

function upsertToolCallTrace(
  traces: ToolCallTrace[] | undefined,
  payload: Extract<ChatStreamPayload, { type: "tool" }>,
): ToolCallTrace[] {
  const current = traces ?? [];
  const nextOutput = normalizeToolOutput(payload);
  const nextArgs = safeStringify(payload.args);
  const updatedAt = Date.now();
  const existing = current.find((trace) => trace.id === payload.toolCallId);

  if (!existing) {
    return [
      ...current,
      {
        id: payload.toolCallId,
        name: payload.name,
        status: payload.status,
        args: nextArgs,
        output: nextOutput,
        meta: payload.meta,
        updatedAt,
      },
    ];
  }

  return current.map((trace) =>
    trace.id === payload.toolCallId
      ? {
          ...trace,
          name: payload.name || trace.name,
          status: payload.status,
          args: nextArgs ?? trace.args,
          output: nextOutput ?? trace.output,
          meta: payload.meta ?? trace.meta,
          updatedAt,
        }
      : trace,
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Failed to read "${file.name}".`));
        return;
      }

      resolve(reader.result);
    };

    reader.onerror = () => {
      reject(new Error(`Failed to read "${file.name}".`));
    };

    reader.readAsDataURL(file);
  });
}

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

  if (
    payload.type === "tool" &&
    (payload.phase === "start" || payload.phase === "update" || payload.phase === "result") &&
    typeof payload.toolCallId === "string" &&
    typeof payload.name === "string" &&
    (payload.status === "running" ||
      payload.status === "completed" ||
      payload.status === "error")
  ) {
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
  attachments: MessageAttachment[];
  attachmentError: string;
  isSubmitting: boolean;
  isSidebarOpen: boolean;
  isCreatingAgent: boolean;
  isCreatingAgentPending: boolean;
  isConfigSaving: boolean;
  newAgentName: string;
  newAgentInstructions: string;
  createAgentStatus: string;
  configDraft: GatewayConfigPayload;
  configStatus: string;
  setSidebarOpen: (isOpen: boolean) => void;
  setInputValue: (value: string) => void;
  setConfigModelPrimaryValue: (value: string) => void;
  setConfigGatewayModeValue: (value: string) => void;
  setConfigGatewayBindValue: (value: string) => void;
  setNewAgentNameValue: (value: string) => void;
  setNewAgentInstructionsValue: (value: string) => void;
  startCreateAgent: () => void;
  cancelCreateAgent: () => void;
  createThreadForSelectedAgent: () => void;
  selectAgent: (agentId: string) => void;
  selectThread: (thread: ChatThread) => void;
  clearAttachment: (attachmentId: string) => void;
  clearComposerAttachments: () => void;
  handleAttachmentFiles: (files: FileList | File[]) => Promise<void>;
  handleConfigSubmit: (nextDraft?: GatewayConfigPayload) => Promise<void>;
  handleCreateAgent: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function useChatWorkspace(): ChatWorkspaceController {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const [isCreatingAgentPending, setIsCreatingAgentPending] = useState(false);
  const [isConfigSaving, setIsConfigSaving] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentInstructions, setNewAgentInstructions] = useState("");
  const [createAgentStatus, setCreateAgentStatus] = useState("");
  const [configDraft, setConfigDraft] = useState<GatewayConfigPayload>({
    modelPrimary: "anthropic/claude-sonnet-4-5",
    gatewayMode: "remote",
    gatewayBind: "lan",
  });
  const [configStatus, setConfigStatus] = useState("");
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
      setAttachments([]);
      setAttachmentError("");
      setIsSidebarOpen(false);
    },
    [isSubmitting],
  );

  useEffect(() => {
    const defaultAgents = createDefaultAgents();

    const parsedAgents = normalizeStoredAgents(
      parseJson(localStorage.getItem(STORAGE_KEYS.agents)),
    );
    const knownAgentIds = new Set(parsedAgents.map((agent) => agent.id));
    const missingDefaultAgents = defaultAgents.filter(
      (agent) => !knownAgentIds.has(agent.id),
    );
    const resolvedAgents = parsedAgents.length
      ? [...parsedAgents, ...missingDefaultAgents]
      : defaultAgents;

    if (resolvedAgents.length === 0) {
      setAgents([]);
      setThreads([]);
      setActiveThreadId("");
      setSelectedAgentId("");
      return;
    }

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

    void fetch("/api/config")
      .then(async (response) => {
        const payload = (await response.json()) as GatewayConfigResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load gateway config.");
        }

        if (!payload.config) {
          return;
        }

        setConfigDraft(payload.config);
      })
      .catch((error) => {
        setConfigStatus(
          error instanceof Error
            ? `Config load failed: ${error.message}`
            : "Config load failed.",
        );
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
    setAttachmentError("");
    setIsSidebarOpen(false);
  }, []);

  const clearAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
  }, []);

  const clearComposerAttachments = useCallback(() => {
    setAttachments([]);
    setAttachmentError("");
  }, []);

  const handleAttachmentFiles = useCallback(
    async (files: FileList | File[]) => {
      if (isSubmitting) {
        return;
      }

      const selected = Array.from(files);

      if (!selected.length) {
        return;
      }

      const imageFiles = selected.filter((file) => file.type.startsWith("image/"));
      const availableSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);

      if (!imageFiles.length || availableSlots === 0) {
        setAttachmentError(
          availableSlots === 0
            ? `You can attach up to ${MAX_ATTACHMENTS} images per message.`
            : "Only image attachments are supported.",
        );
        return;
      }

      if (imageFiles.length !== selected.length || imageFiles.length > availableSlots) {
        setAttachmentError(
          `Attached ${Math.min(imageFiles.length, availableSlots)} image(s). Max ${MAX_ATTACHMENTS} per message.`,
        );
      } else {
        setAttachmentError("");
      }

      const acceptedFiles = imageFiles.slice(0, availableSlots);
      const resolvedAttachments: MessageAttachment[] = [];

      for (const file of acceptedFiles) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setAttachmentError(`"${file.name}" exceeds ${MAX_ATTACHMENT_BYTES} bytes.`);
          continue;
        }

        try {
          const dataUrl = await readFileAsDataUrl(file);

          resolvedAttachments.push({
            id: crypto.randomUUID(),
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            dataUrl,
            size: file.size,
          });
        } catch (error) {
          setAttachmentError(
            error instanceof Error
              ? error.message
              : `Failed to read "${file.name}".`,
          );
        }
      }

      if (!resolvedAttachments.length) {
        return;
      }

      setAttachments((current) => [...current, ...resolvedAttachments]);
    },
    [attachments.length, isSubmitting],
  );

  const handleConfigSubmit = useCallback(async (nextDraft?: GatewayConfigPayload) => {
    if (isConfigSaving) {
      return;
    }

    const draftToSave = nextDraft ?? configDraft;
    const parsedDraft = configDraftSchema.safeParse(draftToSave);

    if (!parsedDraft.success) {
      setConfigStatus(parsedDraft.error.issues[0]?.message ?? "Invalid config fields.");
      return;
    }

    const validatedDraft = parsedDraft.data;
    setIsConfigSaving(true);
    setConfigStatus("Saving gateway config...");

    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validatedDraft),
      });
      const payload = (await response.json()) as GatewayConfigResponse;

      if (!response.ok || !payload.config) {
        throw new Error(payload.error ?? "Failed to save gateway config.");
      }

      setConfigDraft(payload.config);
      setConfigStatus(
        payload.savedAt
          ? `Config updated at ${new Date(payload.savedAt).toLocaleTimeString()}.`
          : "Config updated.",
      );
    } catch (error) {
      setConfigStatus(
        error instanceof Error
          ? `Config update failed: ${error.message}`
          : "Config update failed.",
      );
    } finally {
      setIsConfigSaving(false);
    }
  }, [configDraft, isConfigSaving]);

  const handleCreateAgent = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (isSubmitting || isCreatingAgentPending) {
        return;
      }

      const name = newAgentName.trim();
      const instructions = newAgentInstructions.trim();

      if (!name || !instructions) {
        return;
      }

      const agent = createAgent(name, instructions);

      setIsCreatingAgentPending(true);
      setCreateAgentStatus("Preparing OpenClaw workspace files...");

      try {
        const response = await fetch("/api/agents/bootstrap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agentId: agent.id,
            name,
            instructions,
          }),
        });
        const payload = (await response.json()) as AgentBootstrapResponse;

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to bootstrap agent workspace.");
        }

        setAgents((current) => [agent, ...current]);
        setNewAgentName("");
        setNewAgentInstructions("");
        setIsCreatingAgent(false);
        setCreateAgentStatus(
          `Workspace ready (${payload.workspaceFolder ?? "folder created"}).`,
        );
        createThreadForAgent(agent.id);
      } catch (error) {
        setCreateAgentStatus(
          error instanceof Error
            ? `Agent setup failed: ${error.message}`
            : "Agent setup failed.",
        );
      } finally {
        setIsCreatingAgentPending(false);
      }
    },
    [
      createThreadForAgent,
      isCreatingAgentPending,
      isSubmitting,
      newAgentInstructions,
      newAgentName,
    ],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const message = input.trim();
      const pendingAttachments = attachments;
      const targetThread = activeThread;

      if ((!message && pendingAttachments.length === 0) || isSubmitting || !targetThread) {
        return;
      }

      const targetAgent =
        agents.find((agent) => agent.id === targetThread.agentId) ?? selectedAgent;

      if (!targetAgent) {
        return;
      }

      const targetThreadId = targetThread.id;
      const attachmentSummary =
        pendingAttachments.length === 0
          ? ""
          : pendingAttachments.length === 1
            ? `[Image] ${pendingAttachments[0]?.name ?? "attachment"}`
            : `[${pendingAttachments.length} images attached]`;
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: message || attachmentSummary,
        status: "done",
        attachments: pendingAttachments.length ? pendingAttachments : undefined,
      };
      const assistantMessageId = crypto.randomUUID();

      setInput("");
      setAttachments([]);
      setAttachmentError("");
      setIsSubmitting(true);
      setConnectionState({
        label: "Streaming response",
        tone: "neutral",
      });

      updateThread(targetThreadId, (thread) => ({
        ...thread,
        title:
          thread.messages.length === 0
            ? deriveTitleFromMessage(
                message || pendingAttachments[0]?.name || "New chat",
              )
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
            attachments: pendingAttachments.map((attachment) => ({
              name: attachment.name,
              mimeType: attachment.mimeType,
              dataUrl: attachment.dataUrl,
            })),
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
                    content: payload.text,
                  }),
                );
              });
              continue;
            }

            if (payload.type === "tool") {
              startTransition(() => {
                updateAssistantMessage(
                  targetThreadId,
                  assistantMessageId,
                  (entry) => ({
                    ...entry,
                    toolCalls: upsertToolCallTrace(entry.toolCalls, payload),
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
      attachments,
      input,
      isSubmitting,
      selectedAgent,
      updateAssistantMessage,
      updateThread,
    ],
  );

  const createThreadForSelectedAgent = useCallback(() => {
    if (!selectedAgent?.id) {
      return;
    }

    createThreadForAgent(selectedAgent.id);
  }, [createThreadForAgent, selectedAgent?.id]);

  const startCreateAgent = useCallback(() => {
    setIsCreatingAgent(true);
    setCreateAgentStatus("");
  }, []);

  const cancelCreateAgent = useCallback(() => {
    setIsCreatingAgent(false);
    setNewAgentName("");
    setNewAgentInstructions("");
    setCreateAgentStatus("");
  }, []);

  const setSidebarOpen = useCallback((isOpen: boolean) => {
    setIsSidebarOpen(isOpen);
  }, []);

  const setInputValue = useCallback((value: string) => {
    setInput(value);
  }, []);

  const setConfigModelPrimaryValue = useCallback((value: string) => {
    setConfigDraft((current) => ({
      ...current,
      modelPrimary: value,
    }));
  }, []);

  const setConfigGatewayModeValue = useCallback((value: string) => {
    setConfigDraft((current) => ({
      ...current,
      gatewayMode: value,
    }));
  }, []);

  const setConfigGatewayBindValue = useCallback((value: string) => {
    setConfigDraft((current) => ({
      ...current,
      gatewayBind: value,
    }));
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
    attachments,
    attachmentError,
    isSubmitting,
    isSidebarOpen,
    isCreatingAgent,
    isCreatingAgentPending,
    isConfigSaving,
    newAgentName,
    newAgentInstructions,
    createAgentStatus,
    configDraft,
    configStatus,
    setSidebarOpen,
    setInputValue,
    setConfigModelPrimaryValue,
    setConfigGatewayModeValue,
    setConfigGatewayBindValue,
    setNewAgentNameValue,
    setNewAgentInstructionsValue,
    startCreateAgent,
    cancelCreateAgent,
    createThreadForSelectedAgent,
    selectAgent,
    selectThread,
    clearAttachment,
    clearComposerAttachments,
    handleAttachmentFiles,
    handleConfigSubmit,
    handleCreateAgent,
    handleSubmit,
  };
}
