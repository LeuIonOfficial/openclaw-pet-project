import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import { buildWorkspaceFolderName, normalizeRuntimeKey } from "../runtime/keys";
import type { AgentWorkspaceDraft } from './types';

const DEFAULT_OPENCLAW_ROOT = "/app/openclaw";
const MANAGED_PROFILE_START = "<!-- OPENCLAW_APP_AGENT_PROFILE_START -->";
const MANAGED_PROFILE_END = "<!-- OPENCLAW_APP_AGENT_PROFILE_END -->";

const WORKSPACE_FILES = [
  "AGENTS.md",
  "BOOTSTRAP.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md",
] as const;

function resolveOpenClawRoot(): string {
  const explicitRoot = process.env.OPENCLAW_DATA_PATH;

  if (explicitRoot && explicitRoot.trim()) {
    return explicitRoot;
  }

  const configPath = process.env.OPENCLAW_CONFIG_PATH;

  if (configPath && configPath.trim()) {
    return path.dirname(configPath);
  }

  return DEFAULT_OPENCLAW_ROOT;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;

    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function fallbackTemplate(fileName: string): string {
  return `# ${fileName}\n\n`;
}

function upsertManagedSection(content: string, section: string): string {
  const startIndex = content.indexOf(MANAGED_PROFILE_START);
  const endIndex = content.indexOf(MANAGED_PROFILE_END);
  const wrappedSection = `${MANAGED_PROFILE_START}\n${section}\n${MANAGED_PROFILE_END}`;

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    const before = content.slice(0, startIndex).trimEnd();
    const after = content.slice(endIndex + MANAGED_PROFILE_END.length).trimStart();

    if (!after) {
      return `${before}\n\n${wrappedSection}\n`;
    }

    return `${before}\n\n${wrappedSection}\n\n${after}\n`;
  }

  const normalized = content.trimEnd();

  if (!normalized) {
    return `${wrappedSection}\n`;
  }

  return `${normalized}\n\n${wrappedSection}\n`;
}

function buildManagedProfileSection(draft: AgentWorkspaceDraft): string {
  const runtimeAgentKey = normalizeRuntimeKey(draft.agentId);
  const timestamp = new Date().toISOString();

  return [
    "## OpenClaw App Agent Profile",
    "",
    `- Agent ID: \`${draft.agentId}\``,
    `- Runtime Key: \`${runtimeAgentKey}\``,
    `- Name: ${draft.name}`,
    `- Updated At: ${timestamp}`,
    "",
    "### Instructions",
    "",
    draft.instructions,
  ].join("\n");
}

async function seedWorkspaceState(workspacePath: string): Promise<void> {
  const statePath = path.join(workspacePath, ".openclaw", "workspace-state.json");
  const existing = await readFileIfExists(statePath);

  if (existing) {
    return;
  }

  const next = {
    version: 1,
    bootstrapSeededAt: new Date().toISOString(),
  };

  await fs.writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function seedDailyMemory(workspacePath: string, draft: AgentWorkspaceDraft): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const memoryPath = path.join(workspacePath, "memory", `${day}.md`);
  const existing = await readFileIfExists(memoryPath);

  if (existing) {
    return;
  }

  const initial = [
    `# ${day}`,
    "",
    "## Agent bootstrap",
    `- Agent: ${draft.name} (\`${draft.agentId}\`)`,
    "- Source: OpenClaw app agent setup",
    "",
  ].join("\n");

  await fs.writeFile(memoryPath, initial, "utf8");
}

async function resolveTemplateContent(rootPath: string, fileName: string): Promise<string> {
  const templatePath = path.join(rootPath, "workspace", fileName);
  const template = await readFileIfExists(templatePath);

  if (template) {
    return template;
  }

  return fallbackTemplate(fileName);
}

export async function bootstrapAgentWorkspace(draft: AgentWorkspaceDraft): Promise<{
  workspacePath: string;
  workspaceFolder: string;
  runtimeAgentKey: string;
  managedFiles: string[];
}> {
  const rootPath = resolveOpenClawRoot();
  const runtimeAgentKey = normalizeRuntimeKey(draft.agentId);
  const workspaceFolder = buildWorkspaceFolderName(draft.agentId);
  const workspacePath = path.join(rootPath, workspaceFolder);

  await fs.mkdir(path.join(workspacePath, ".openclaw"), { recursive: true });
  await fs.mkdir(path.join(workspacePath, "memory"), { recursive: true });

  await seedWorkspaceState(workspacePath);
  await seedDailyMemory(workspacePath, draft);

  const profileSection = buildManagedProfileSection(draft);
  const managedFiles: string[] = [];

  for (const fileName of WORKSPACE_FILES) {
    const targetPath = path.join(workspacePath, fileName);
    const existing = await readFileIfExists(targetPath);
    const baseContent =
      existing ??
      (await resolveTemplateContent(rootPath, fileName));
    const next = upsertManagedSection(baseContent, profileSection);

    await fs.writeFile(targetPath, next, "utf8");
    managedFiles.push(fileName);
  }

  return {
    workspacePath,
    workspaceFolder,
    runtimeAgentKey,
    managedFiles,
  };
}
