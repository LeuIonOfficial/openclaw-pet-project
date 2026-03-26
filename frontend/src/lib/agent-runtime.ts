export const RUNTIME_KEY_FALLBACK = "agent";

export function normalizeRuntimeKey(
  value: string,
  fallback = RUNTIME_KEY_FALLBACK,
): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return normalized.slice(0, 40) || fallback;
}

export function buildSessionKey(agentId: string, threadId: string): string {
  return `agent:${normalizeRuntimeKey(agentId)}:chat:${normalizeRuntimeKey(threadId)}`;
}

export function buildWorkspaceFolderName(agentId: string): string {
  return `workspace-${normalizeRuntimeKey(agentId)}`;
}
