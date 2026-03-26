import type { AgentTemplate, ConnectionState } from "./types";

export const INITIAL_CONNECTION_STATE: ConnectionState = {
  label: "Checking gateway",
  tone: "neutral",
};

export const STORAGE_KEYS = {
  threads: "openclaw.chat.threads.v3",
  activeThread: "openclaw.chat.active-thread.v3",
  agents: "openclaw.chat.agents.v3",
  selectedAgent: "openclaw.chat.selected-agent.v3",
} as const;

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "agent-career",
    name: "Career Manager",
    instructions:
      "Act as a direct career coach. Ask targeted clarifying questions, identify gaps, and provide a concrete step-by-step plan with timelines for growth, interviews, salary progression, and role transitions.",
  },
  {
    id: "agent-moldova-pdd-law",
    name: "Moldova PDD + Law",
    instructions:
      "Act as a Moldova traffic rules and legal guidance assistant. Explain PDD rules clearly, reference practical legal context, ask for missing facts, and provide step-by-step actions for drivers. State uncertainty when facts are incomplete.",
  },
  {
    id: "agent-js-guru",
    name: "JS Guru",
    instructions:
      "Act as a senior JavaScript/TypeScript engineer. Give production-grade guidance for architecture, debugging, performance, testing, and clean code. Prefer concrete examples, tradeoffs, and actionable next steps.",
  },
];
