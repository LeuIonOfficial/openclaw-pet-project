export type ConnectionState = {
  label: string;
  tone: "neutral" | "good" | "bad";
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "done" | "streaming" | "error";
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
  | { type: "final"; text: string }
  | { type: "error"; message: string };
