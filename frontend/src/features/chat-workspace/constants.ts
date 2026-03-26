import type { AgentTemplate, ConnectionState } from "./types";

export const INITIAL_CONNECTION_STATE: ConnectionState = {
  label: "Checking gateway",
  tone: "neutral",
};

export const STORAGE_KEYS = {
  threads: "openclaw.chat.threads.v2",
  activeThread: "openclaw.chat.active-thread.v2",
  agents: "openclaw.chat.agents.v2",
  selectedAgent: "openclaw.chat.selected-agent.v2",
} as const;

export const AGENT_TEMPLATES: AgentTemplate[] = [
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
