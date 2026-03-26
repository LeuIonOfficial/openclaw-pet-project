import { z } from "zod";

const agentBootstrapSchema = z
  .object({
    agentId: z.string().trim().min(1, "agentId is required."),
    name: z.string().trim().min(1, "name is required."),
    instructions: z.string().trim().min(1, "instructions are required."),
  })
  .strict();

export type AgentBootstrapDraft = z.infer<typeof agentBootstrapSchema>;

function zodErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? "Invalid agent bootstrap payload.";
}

export function parseAgentBootstrapDraft(body: unknown): {
  draft?: AgentBootstrapDraft;
  error?: string;
} {
  const parsed = agentBootstrapSchema.safeParse(body);

  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }

  return { draft: parsed.data };
}
