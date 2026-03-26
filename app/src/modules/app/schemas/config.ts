import { z } from "zod";

export const configDraftSchema = z.object({
  modelPrimary: z.string().trim().min(1, "modelPrimary is required."),
  gatewayMode: z.string().trim().min(1, "gatewayMode is required."),
  gatewayBind: z.string().trim().min(1, "gatewayBind is required."),
});

export type ConfigDraft = z.infer<typeof configDraftSchema>;

function zodErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue?.message ?? "Invalid config payload.";
}

export function parseConfigDraft(body: unknown): {
  draft?: ConfigDraft;
  error?: string;
} {
  const parsed = configDraftSchema.safeParse(body);

  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }

  return { draft: parsed.data };
}
