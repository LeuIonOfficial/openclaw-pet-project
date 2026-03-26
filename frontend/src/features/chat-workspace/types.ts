export type ConnectionState = {
  label: string;
  tone: "neutral" | "good" | "bad";
};

export type MessageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
};

export type ToolCallStatus = "running" | "completed" | "error";

export type ToolCallTrace = {
  id: string;
  name: string;
  status: ToolCallStatus;
  args?: string;
  output?: string;
  meta?: string;
  updatedAt: number;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "done" | "streaming" | "error";
  attachments?: MessageAttachment[];
  toolCalls?: ToolCallTrace[];
};

export type AgentProfile = {
  id: string;
  name: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
};

export type ChatThread = {
  id: string;
  agentId: string;
  sessionKey: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

export type AgentTemplate = {
  id: string;
  name: string;
  instructions: string;
};

export type HealthResponse = {
  hasToken?: boolean;
  hasIdentity?: boolean;
  error?: string;
};

export type ChatStreamPayload =
  | { type: "status"; stage: string }
  | { type: "delta"; text: string }
  | {
      type: "tool";
      phase: "start" | "update" | "result";
      toolCallId: string;
      name: string;
      status: ToolCallStatus;
      args?: unknown;
      partialResult?: unknown;
      result?: unknown;
      meta?: string;
      isError?: boolean;
    }
  | { type: "final"; text: string }
  | { type: "error"; message: string };

export type GatewayConfigPayload = {
  modelPrimary: string;
  gatewayMode: string;
  gatewayBind: string;
  tokenEnvId: string;
};

export type GatewayConfigResponse = {
  config?: GatewayConfigPayload;
  savedAt?: string;
  error?: string;
};
