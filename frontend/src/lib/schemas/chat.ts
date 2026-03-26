import { z } from "zod";

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5_000_000;

export type NormalizedAttachment = {
  type: "image";
  name: string;
  mimeType: string;
  content: string;
  size: number;
};

const chatAttachmentInputSchema = z.object({
  name: z.string().optional(),
  mimeType: z.string().optional(),
  dataUrl: z.string().optional(),
  content: z.string().optional(),
});

const chatRequestSchema = z
  .object({
    message: z.string().optional(),
    sessionKey: z.string().optional(),
    agentName: z.string().optional(),
    agentPrompt: z.string().optional(),
    attachments: z
      .array(chatAttachmentInputSchema)
      .max(MAX_ATTACHMENTS, `You can attach up to ${MAX_ATTACHMENTS} images per message.`)
      .optional(),
  })
  .strict();

type ParsedChatBody = z.infer<typeof chatRequestSchema>;

export type ParsedChatRequest = {
  message: string;
  sessionKey?: string;
  agentName?: string;
  agentPrompt?: string;
  attachments: NormalizedAttachment[];
};

function parseBase64DataUrl(value: string): { mimeType: string; content: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(value.trim());

  if (!match) {
    return null;
  }

  const mimeType = match[1]?.trim().toLowerCase() ?? "";
  const content = match[2]?.trim() ?? "";

  if (!mimeType || !content) {
    return null;
  }

  return { mimeType, content };
}

function estimateBase64Bytes(content: string): number {
  const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
  return Math.floor((content.length * 3) / 4) - padding;
}

function asOptionalText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function zodErrorMessage(error: z.ZodError): string {
  const issue = error.issues[0];

  if (!issue) {
    return "Invalid payload.";
  }

  return issue.message || "Invalid payload.";
}

function normalizeAttachments(input: ParsedChatBody["attachments"]): {
  attachments: NormalizedAttachment[];
  error?: string;
} {
  if (!input?.length) {
    return { attachments: [] };
  }

  const attachments: NormalizedAttachment[] = [];

  for (const [index, raw] of input.entries()) {
    const name =
      asOptionalText(raw.name) ??
      `attachment-${index + 1}`;
    const parsedDataUrl = raw.dataUrl ? parseBase64DataUrl(raw.dataUrl) : null;
    const mimeType =
      asOptionalText(raw.mimeType)?.toLowerCase() ?? parsedDataUrl?.mimeType ?? "";
    const content = asOptionalText(raw.content) ?? parsedDataUrl?.content ?? "";

    if (!mimeType.startsWith("image/")) {
      return { attachments: [], error: `Attachment "${name}" must be image/*.` };
    }

    if (!content) {
      return {
        attachments: [],
        error: `Attachment "${name}" is missing base64 content.`,
      };
    }

    const bytes = estimateBase64Bytes(content);
    if (bytes <= 0 || bytes > MAX_ATTACHMENT_BYTES) {
      return {
        attachments: [],
        error: `Attachment "${name}" exceeds ${MAX_ATTACHMENT_BYTES} bytes.`,
      };
    }

    attachments.push({
      type: "image",
      name,
      mimeType,
      content,
      size: bytes,
    });
  }

  return { attachments };
}

export function parseChatRequest(body: unknown): {
  data?: ParsedChatRequest;
  error?: string;
} {
  const parsed = chatRequestSchema.safeParse(body);

  if (!parsed.success) {
    return { error: zodErrorMessage(parsed.error) };
  }

  const normalized = normalizeAttachments(parsed.data.attachments);

  if (normalized.error) {
    return { error: normalized.error };
  }

  return {
    data: {
      message: asOptionalText(parsed.data.message) ?? "",
      sessionKey: asOptionalText(parsed.data.sessionKey),
      agentName: asOptionalText(parsed.data.agentName),
      agentPrompt: asOptionalText(parsed.data.agentPrompt),
      attachments: normalized.attachments,
    },
  };
}
