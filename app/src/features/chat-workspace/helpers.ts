import { AGENT_TEMPLATES } from "./constants";
import type {
  AgentProfile,
  ChatThread,
  Message,
  MessageAttachment,
  ToolCallTrace,
} from "./types";
import { buildSessionKey as buildRuntimeSessionKey } from "@openclaw/module/runtime/keys";

export function createDefaultAgents(now = Date.now()): AgentProfile[] {
  return AGENT_TEMPLATES.map((template) => ({
    ...template,
    createdAt: now,
    updatedAt: now,
  }));
}

export function sortThreadsByRecent(threads: ChatThread[]): ChatThread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function buildSessionKey(agentId: string, threadId: string): string {
  return buildRuntimeSessionKey(agentId, threadId);
}

export function createThread(agentId: string, now = Date.now()): ChatThread {
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

export function createAgent(
  name: string,
  instructions: string,
  now = Date.now(),
): AgentProfile {
  return {
    id: `agent-${crypto.randomUUID()}`,
    name,
    instructions,
    createdAt: now,
    updatedAt: now,
  };
}

export function deriveTitleFromMessage(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "New chat";
  }

  return normalized.length > 44 ? `${normalized.slice(0, 44)}…` : normalized;
}

export function getThreadPreview(thread: ChatThread): string {
  if (!thread.messages.length) {
    return "No messages yet.";
  }

  const last = thread.messages[thread.messages.length - 1];
  const normalized = last.content.replace(/\s+/g, " ").trim();

  if (!normalized) {
    if (last.role === "user" && last.attachments?.length) {
      return last.attachments.length > 1
        ? `Sent ${last.attachments.length} attachments`
        : "Sent an attachment";
    }

    if (last.role === "assistant" && last.toolCalls?.length) {
      return "Used tools in this reply";
    }

    return last.role === "assistant" ? "Streaming..." : "Empty message";
  }

  return normalized.length > 72 ? `${normalized.slice(0, 72)}…` : normalized;
}

export function formatUpdatedAt(timestamp: number): string {
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

export function mergeStreamText(previous: string, incoming: string): string {
  if (!incoming) {
    return previous;
  }

  if (!previous) {
    return incoming;
  }

  if (incoming.startsWith(previous)) {
    return incoming;
  }

  if (previous.startsWith(incoming)) {
    return previous;
  }

  const maxOverlap = Math.min(previous.length, incoming.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    if (previous.slice(-size) === incoming.slice(0, size)) {
      return `${previous}${incoming.slice(size)}`;
    }
  }

  return `${previous}${incoming}`;
}

export function parseJson(value: string | null): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeAttachment(value: unknown): MessageAttachment | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<MessageAttachment>;

  if (
    typeof entry.id !== "string" ||
    typeof entry.name !== "string" ||
    typeof entry.mimeType !== "string" ||
    typeof entry.size !== "number"
  ) {
    return null;
  }

  // Do not hydrate base64 payloads from local storage into runtime message history.
  // Keeping large image payloads in the browser state can crash the renderer.
  return {
    id: entry.id,
    name: entry.name,
    mimeType: entry.mimeType,
    size: entry.size,
  };
}

function normalizeToolCall(value: unknown): ToolCallTrace | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<ToolCallTrace>;

  if (
    typeof entry.id !== "string" ||
    typeof entry.name !== "string" ||
    (entry.status !== "running" &&
      entry.status !== "completed" &&
      entry.status !== "error") ||
    typeof entry.updatedAt !== "number"
  ) {
    return null;
  }

  return {
    id: entry.id,
    name: entry.name,
    status: entry.status,
    args: typeof entry.args === "string" ? entry.args : undefined,
    output: typeof entry.output === "string" ? entry.output : undefined,
    meta: typeof entry.meta === "string" ? entry.meta : undefined,
    updatedAt: entry.updatedAt,
  };
}

function normalizeMessage(value: unknown): Message | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<Message>;

  if (
    typeof item.id !== "string" ||
    (item.role !== "user" && item.role !== "assistant") ||
    typeof item.content !== "string" ||
    (item.status !== "done" && item.status !== "streaming" && item.status !== "error")
  ) {
    return null;
  }

  const attachments = Array.isArray(item.attachments)
    ? item.attachments
        .map((attachment) => normalizeAttachment(attachment))
        .filter((attachment): attachment is MessageAttachment => attachment !== null)
    : undefined;
  const toolCalls = Array.isArray(item.toolCalls)
    ? item.toolCalls
        .map((toolCall) => normalizeToolCall(toolCall))
        .filter((toolCall): toolCall is ToolCallTrace => toolCall !== null)
    : undefined;

  return {
    id: item.id,
    role: item.role,
    content: item.content,
    status: item.status,
    attachments: attachments?.length ? attachments : undefined,
    toolCalls: toolCalls?.length ? toolCalls : undefined,
  };
}

export function normalizeStoredAgents(value: unknown): AgentProfile[] {
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
      } satisfies AgentProfile;
    })
    .filter((agent): agent is AgentProfile => agent !== null);

  return normalized;
}

export function normalizeStoredThreads(
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
        messages: thread.messages
          .map((message) => normalizeMessage(message))
          .filter((message): message is Message => message !== null),
      } satisfies ChatThread;
    })
    .filter((thread): thread is ChatThread => thread !== null);

  return sortThreadsByRecent(normalized);
}
