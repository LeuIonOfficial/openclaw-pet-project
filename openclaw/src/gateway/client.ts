import 'server-only';

import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import { logError, logInfo, logWarn } from '../logger';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const CONNECT_TIMEOUT_MS = 10_000;
const PATCH_FALLBACK_MS = 450;
const PAIRING_RETRY_DELAY_MS = 1_500;
const PAIRING_MAX_CONNECT_ATTEMPTS = 8;
const DEFAULT_SESSION_KEY = 'agent:main:main';
const PAIRING_RETRY_SENTINEL = '__PAIRING_RETRY__';

const OPERATOR_SCOPES = [
  'operator.admin',
  'operator.read',
  'operator.write',
  'operator.approvals',
  'operator.pairing',
];

type DeviceIdentity = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
};

type GatewayResponseFrame = {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: {
      code?: string;
      reason?: string;
    };
  };
};

type GatewayEventFrame = {
  type: 'event';
  event: string;
  payload?: unknown;
};

type ChatPayload = {
  runId?: string;
  state?: 'delta' | 'final' | 'aborted' | 'error';
  errorMessage?: string;
  stopReason?: string;
  usage?: unknown;
  message?: unknown;
};

type ChatAttachmentInput = {
  type?: string;
  name?: string;
  mimeType: string;
  content: string;
};

type ToolPhase = 'start' | 'update' | 'result';

type GatewayAgentEventPayload = {
  runId?: unknown;
  stream?: unknown;
  data?: unknown;
};

type ParsedToolEvent = {
  runId: string;
  phase: ToolPhase;
  toolCallId: string;
  name: string;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  meta?: string;
  isError?: boolean;
};

export type ChatStreamEvent =
  | {
      type: 'status';
      stage: 'connecting' | 'connected' | 'started';
      runId?: string;
    }
  | { type: 'delta'; text: string }
  | {
      type: 'tool';
      phase: ToolPhase;
      toolCallId: string;
      name: string;
      status: 'running' | 'completed' | 'error';
      args?: unknown;
      partialResult?: unknown;
      result?: unknown;
      meta?: string;
      isError?: boolean;
    }
  | { type: 'final'; text: string; stopReason?: string; usage?: unknown }
  | { type: 'error'; message: string };

type StreamChatParams = {
  message: string;
  attachments?: ChatAttachmentInput[];
  sessionKey?: string;
  requestId?: string;
  signal: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void | Promise<void>;
};

type GatewayConfig = {
  url: string;
  token: string;
  identityPath: string;
  clientId: 'cli';
  clientMode: 'cli';
  platform: string;
  deviceFamily: string;
};

type ActiveStreamContext = {
  requestId: string;
  params: StreamChatParams;
  startedAt: number;
  attempt: number;
  resolvedSessionKey: string;
  patchSessionId: string;
  sendId: string;
  runId: string;
  settled: boolean;
  chatSendDispatched: boolean;
  assistantSnapshot: string;
  deltaChunks: number;
  deltaCharacters: number;
  toolStarted: number;
  toolCompleted: number;
  toolFailed: number;
  patchFallbackTimer: ReturnType<typeof setTimeout> | null;
  abortHandler: () => void;
  resolve: () => void;
  reject: (error: Error) => void;
  done: Promise<void>;
};

function base64UrlEncode(value: Buffer): string {
  return value
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = crypto.createPublicKey(publicKeyPem).export({
    type: 'spki',
    format: 'der',
  });

  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }

  return spki;
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, 'utf8'), key));
}

function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string;
  nonce: string;
  platform: string;
  deviceFamily: string;
}): string {
  return [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token,
    params.nonce,
    params.platform,
    params.deviceFamily,
  ].join('|');
}

function extractTextParts(value: { content?: unknown }): Array<{
  text: string;
  type?: string;
}> {
  if (!Array.isArray(value.content)) {
    return [];
  }

  return value.content.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const part = item as {
      text?: unknown;
      type?: unknown;
    };

    if (typeof part.text !== 'string') {
      return [];
    }

    return [
      {
        text: part.text,
        type: typeof part.type === 'string' ? part.type : undefined,
      },
    ];
  });
}

function extractDeltaText(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const value = message as {
    text?: unknown;
    content?: unknown;
  };

  if (typeof value.text === 'string') {
    return value.text;
  }

  if (typeof value.content === 'string') {
    return value.content;
  }

  const parts = extractTextParts(value);
  const textDeltaParts = parts.filter((part) => part.type === 'text_delta');

  if (textDeltaParts.length) {
    return textDeltaParts[textDeltaParts.length - 1]?.text ?? '';
  }

  if (parts.length === 0) {
    return '';
  }

  if (parts.length === 1) {
    return parts[0].text;
  }

  return parts[parts.length - 1].text;
}

function extractFinalText(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return '';
  }

  const value = message as {
    text?: unknown;
    content?: unknown;
  };

  if (typeof value.text === 'string') {
    return value.text;
  }

  if (typeof value.content === 'string') {
    return value.content;
  }

  const parts = extractTextParts(value);

  if (parts.length === 0) {
    return '';
  }

  const outputText = parts
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text)
    .join('');

  if (outputText) {
    return outputText;
  }

  return parts.map((part) => part.text).join('');
}

function mergeDeltaSnapshot(previous: string, incoming: string): string {
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

  if (incoming.includes(previous)) {
    return incoming;
  }

  if (previous.includes(incoming)) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseAgentToolEvent(payload: unknown): ParsedToolEvent | null {
  if (!isRecord(payload)) {
    return null;
  }

  const envelope = payload as GatewayAgentEventPayload;

  if (typeof envelope.runId !== 'string') {
    return null;
  }

  if (envelope.stream !== 'tool' || !isRecord(envelope.data)) {
    return null;
  }

  const phase = envelope.data.phase;
  const toolCallId = envelope.data.toolCallId;

  if (
    (phase !== 'start' && phase !== 'update' && phase !== 'result') ||
    typeof toolCallId !== 'string'
  ) {
    return null;
  }

  return {
    runId: envelope.runId,
    phase,
    toolCallId,
    name: typeof envelope.data.name === 'string' ? envelope.data.name : 'tool',
    args: envelope.data.args,
    partialResult: envelope.data.partialResult,
    result: envelope.data.result,
    meta:
      typeof envelope.data.meta === 'string' ? envelope.data.meta : undefined,
    isError:
      typeof envelope.data.isError === 'boolean'
        ? envelope.data.isError
        : undefined,
  };
}

async function loadIdentity(identityPath: string): Promise<DeviceIdentity> {
  const raw = await fs.readFile(identityPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<DeviceIdentity>;

  if (
    typeof parsed.deviceId !== 'string' ||
    typeof parsed.publicKeyPem !== 'string' ||
    typeof parsed.privateKeyPem !== 'string'
  ) {
    throw new Error(`Invalid OpenClaw identity file at ${identityPath}`);
  }

  return {
    deviceId: parsed.deviceId,
    publicKeyPem: parsed.publicKeyPem,
    privateKeyPem: parsed.privateKeyPem,
  };
}

function readGatewayConfig(): GatewayConfig {
  const url = process.env.OPENCLAW_GATEWAY_URL ?? 'ws://openclaw:18789';
  const token = process.env.OPENCLAW_GATEWAY_TOKEN ?? '';
  const identityPath =
    process.env.OPENCLAW_IDENTITY_PATH ?? '/app/openclaw/identity/device.json';

  if (!token) {
    throw new Error('OPENCLAW_GATEWAY_TOKEN is missing');
  }

  return {
    url,
    token,
    identityPath,
    clientId: 'cli',
    clientMode: 'cli',
    platform: process.env.OPENCLAW_CLIENT_PLATFORM ?? 'linux',
    deviceFamily: process.env.OPENCLAW_CLIENT_DEVICE_FAMILY ?? 'docker',
  };
}

class OpenClawGatewayClient {
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private connectGeneration = 0;
  private defaultSessionKey = DEFAULT_SESSION_KEY;

  private readonly contextsByPatchId = new Map<string, ActiveStreamContext>();
  private readonly contextsBySendId = new Map<string, ActiveStreamContext>();
  private readonly contextsByRunId = new Map<string, ActiveStreamContext>();

  async streamChat(params: StreamChatParams): Promise<void> {
    const requestId = params.requestId ?? crypto.randomUUID();
    const startedAt = Date.now();
    const attempt = 0;

    logInfo('openclaw.gateway', 'openclaw.stream.init', {
      requestId,
      attempt,
      gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? 'ws://openclaw:18789',
      hasSessionKey: Boolean(params.sessionKey),
      messageChars: params.message.length,
      attachmentCount: params.attachments?.length ?? 0,
      reusingConnection: this.isConnected(),
    });

    this.emit(params, { type: 'status', stage: 'connecting' });

    try {
      await this.ensureConnected(requestId);
    } catch (error) {
      logError('openclaw.gateway', 'openclaw.stream.unhandled_error', {
        requestId,
        attempt,
        durationMs: Date.now() - startedAt,
        message:
          error instanceof Error ? error.message : 'Unknown stream error.',
      });
      throw error;
    }

    this.emit(params, { type: 'status', stage: 'connected' });

    if (params.signal.aborted) {
      logWarn('openclaw.gateway', 'openclaw.stream.aborted', {
        requestId,
        attempt,
        durationMs: Date.now() - startedAt,
      });
      return;
    }

    const resolvedSessionKey = params.sessionKey ?? this.defaultSessionKey;
    const patchSessionId = crypto.randomUUID();
    const sendId = crypto.randomUUID();

    let resolveDone: () => void = () => undefined;
    let rejectDone: (error: Error) => void = () => undefined;

    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const context: ActiveStreamContext = {
      requestId,
      params,
      startedAt,
      attempt,
      resolvedSessionKey,
      patchSessionId,
      sendId,
      runId: '',
      settled: false,
      chatSendDispatched: false,
      assistantSnapshot: '',
      deltaChunks: 0,
      deltaCharacters: 0,
      toolStarted: 0,
      toolCompleted: 0,
      toolFailed: 0,
      patchFallbackTimer: null,
      abortHandler: () => {
        logWarn('openclaw.gateway', 'openclaw.stream.aborted', {
          requestId,
          attempt,
          runId: context.runId || undefined,
          deltaChunks: context.deltaChunks,
          deltaCharacters: context.deltaCharacters,
          durationMs: Date.now() - startedAt,
        });
        this.finishContext(context);
      },
      resolve: resolveDone,
      reject: rejectDone,
      done,
    };

    params.signal.addEventListener('abort', context.abortHandler, {
      once: true,
    });

    this.contextsByPatchId.set(context.patchSessionId, context);
    try {
      this.sendFrame({
        type: 'req',
        id: context.patchSessionId,
        method: 'sessions.patch',
        params: {
          key: context.resolvedSessionKey,
          verboseLevel: 'full',
        },
      });
    } catch (error) {
      this.failContext(
        context,
        error instanceof Error
          ? error.message
          : 'Failed to patch OpenClaw session verbose level.',
        { state: 'socket-send-patch' },
      );
    }

    context.patchFallbackTimer = setTimeout(() => {
      if (context.chatSendDispatched || context.settled) {
        return;
      }

      logWarn('openclaw.gateway', 'openclaw.session.patch_verbose.timeout', {
        requestId,
        attempt,
        sessionKey: context.resolvedSessionKey,
        timeoutMs: PATCH_FALLBACK_MS,
      });
      this.dispatchChatSend(context);
    }, PATCH_FALLBACK_MS);

    try {
      await context.done;
    } catch (error) {
      logError('openclaw.gateway', 'openclaw.stream.unhandled_error', {
        requestId,
        attempt,
        durationMs: Date.now() - startedAt,
        message:
          error instanceof Error ? error.message : 'Unknown stream error.',
      });
      throw error;
    }
  }

  private emit(params: StreamChatParams, event: ChatStreamEvent): void {
    void Promise.resolve(params.onEvent(event)).catch(() => {
      // Event callbacks should not break gateway routing.
    });
  }

  private isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private ensureSocketAvailable(): WebSocket {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('OpenClaw websocket is not connected.');
    }

    return this.ws;
  }

  private sendFrame(frame: Record<string, unknown>): void {
    const ws = this.ensureSocketAvailable();
    ws.send(JSON.stringify(frame));
  }

  private dispatchChatSend(context: ActiveStreamContext): void {
    if (context.chatSendDispatched || context.settled) {
      return;
    }

    context.chatSendDispatched = true;
    this.contextsBySendId.set(context.sendId, context);

    try {
      this.sendFrame({
        type: 'req',
        id: context.sendId,
        method: 'chat.send',
        params: {
          sessionKey: context.resolvedSessionKey,
          message: context.params.message,
          attachments: context.params.attachments,
          idempotencyKey: crypto.randomUUID(),
        },
      });
    } catch (error) {
      this.failContext(
        context,
        error instanceof Error
          ? error.message
          : 'Failed to send chat request to OpenClaw.',
        { state: 'socket-send-chat' },
      );
    }
  }

  private clearPatchTimer(context: ActiveStreamContext): void {
    if (!context.patchFallbackTimer) {
      return;
    }

    clearTimeout(context.patchFallbackTimer);
    context.patchFallbackTimer = null;
  }

  private cleanupContext(context: ActiveStreamContext): void {
    this.clearPatchTimer(context);

    if (context.params.signal) {
      context.params.signal.removeEventListener('abort', context.abortHandler);
    }

    this.contextsByPatchId.delete(context.patchSessionId);
    this.contextsBySendId.delete(context.sendId);

    if (context.runId) {
      this.contextsByRunId.delete(context.runId);
    }
  }

  private finishContext(context: ActiveStreamContext, error?: Error): void {
    if (context.settled) {
      return;
    }

    context.settled = true;
    this.cleanupContext(context);

    if (error) {
      context.reject(error);
      return;
    }

    context.resolve();
  }

  private failContext(
    context: ActiveStreamContext,
    message: string,
    data: Record<string, unknown> = {},
  ): void {
    logError('openclaw.gateway', 'openclaw.stream.failure', {
      requestId: context.requestId,
      attempt: context.attempt,
      runId: context.runId || undefined,
      durationMs: Date.now() - context.startedAt,
      message,
      ...data,
    });

    this.finishContext(context, new Error(message));
  }

  private failAllActiveContexts(
    message: string,
    data: Record<string, unknown> = {},
  ): void {
    const active = new Set<ActiveStreamContext>([
      ...this.contextsByPatchId.values(),
      ...this.contextsBySendId.values(),
      ...this.contextsByRunId.values(),
    ]);

    for (const context of active) {
      this.failContext(context, message, data);
    }
  }

  private handleResponseFrame(frame: GatewayResponseFrame): void {
    const patchContext = this.contextsByPatchId.get(frame.id);

    if (patchContext) {
      this.clearPatchTimer(patchContext);

      if (!frame.ok) {
        logWarn('openclaw.gateway', 'openclaw.session.patch_verbose.failed', {
          requestId: patchContext.requestId,
          attempt: patchContext.attempt,
          runId: patchContext.runId || undefined,
          sessionKey: patchContext.resolvedSessionKey,
          errorCode: frame.error?.code,
          detailCode: frame.error?.details?.code,
          message: frame.error?.message ?? 'Failed to patch verbose level.',
        });
      } else {
        logInfo('openclaw.gateway', 'openclaw.session.patch_verbose.applied', {
          requestId: patchContext.requestId,
          attempt: patchContext.attempt,
          sessionKey: patchContext.resolvedSessionKey,
          verboseLevel: 'full',
        });
      }

      this.contextsByPatchId.delete(frame.id);
      this.dispatchChatSend(patchContext);
      return;
    }

    const sendContext = this.contextsBySendId.get(frame.id);

    if (!sendContext) {
      return;
    }

    this.contextsBySendId.delete(frame.id);

    if (!frame.ok) {
      this.failContext(
        sendContext,
        frame.error?.message ?? 'chat.send failed.',
        {
          state: 'chat-send',
          errorCode: frame.error?.code,
        },
      );
      return;
    }

    const payload =
      frame.payload && typeof frame.payload === 'object' ? frame.payload : {};

    sendContext.runId =
      'runId' in payload && typeof payload.runId === 'string'
        ? payload.runId
        : '';

    if (!sendContext.runId) {
      this.failContext(sendContext, 'chat.send response missing runId.', {
        state: 'chat-send-response',
      });
      return;
    }

    this.contextsByRunId.set(sendContext.runId, sendContext);

    logInfo('openclaw.gateway', 'openclaw.chat.started', {
      requestId: sendContext.requestId,
      attempt: sendContext.attempt,
      runId: sendContext.runId,
      sessionKey: sendContext.resolvedSessionKey,
    });

    this.emit(sendContext.params, {
      type: 'status',
      stage: 'started',
      runId: sendContext.runId,
    });
  }

  private handleAgentEvent(payload: unknown): void {
    const toolEvent = parseAgentToolEvent(payload);

    if (!toolEvent) {
      return;
    }

    const context = this.contextsByRunId.get(toolEvent.runId);

    if (!context) {
      return;
    }

    let status: 'running' | 'completed' | 'error';

    if (toolEvent.phase === 'result') {
      status = toolEvent.isError ? 'error' : 'completed';
    } else {
      status = 'running';
    }

    if (toolEvent.phase === 'start') {
      context.toolStarted += 1;
      logInfo('openclaw.gateway', 'openclaw.tool.start', {
        requestId: context.requestId,
        attempt: context.attempt,
        runId: context.runId,
        toolCallId: toolEvent.toolCallId,
        toolName: toolEvent.name,
      });
    } else if (toolEvent.phase === 'result') {
      if (toolEvent.isError) {
        context.toolFailed += 1;
      } else {
        context.toolCompleted += 1;
      }

      logInfo('openclaw.gateway', 'openclaw.tool.result', {
        requestId: context.requestId,
        attempt: context.attempt,
        runId: context.runId,
        toolCallId: toolEvent.toolCallId,
        toolName: toolEvent.name,
        isError: toolEvent.isError ?? false,
      });
    }

    this.emit(context.params, {
      type: 'tool',
      phase: toolEvent.phase,
      toolCallId: toolEvent.toolCallId,
      name: toolEvent.name,
      status,
      args: toolEvent.args,
      partialResult: toolEvent.partialResult,
      result: toolEvent.result,
      meta: toolEvent.meta,
      isError: toolEvent.isError,
    });
  }

  private handleChatEvent(payload: unknown): void {
    const chatPayload = payload as ChatPayload;

    if (!chatPayload?.runId) {
      return;
    }

    const context = this.contextsByRunId.get(chatPayload.runId);

    if (!context) {
      return;
    }

    if (chatPayload.state === 'delta') {
      const text = extractDeltaText(chatPayload.message);

      if (text) {
        context.assistantSnapshot = mergeDeltaSnapshot(
          context.assistantSnapshot,
          text,
        );
        context.deltaChunks += 1;
        context.deltaCharacters += text.length;
        this.emit(context.params, {
          type: 'delta',
          text: context.assistantSnapshot,
        });
      }

      return;
    }

    if (chatPayload.state === 'final') {
      const extractedFinalText = extractFinalText(chatPayload.message);
      const finalText = extractedFinalText || context.assistantSnapshot;

      logInfo('openclaw.gateway', 'openclaw.chat.final', {
        requestId: context.requestId,
        attempt: context.attempt,
        runId: context.runId,
        stopReason: chatPayload.stopReason,
        deltaChunks: context.deltaChunks,
        deltaCharacters: context.deltaCharacters,
        finalCharacters: finalText.length,
        toolStarted: context.toolStarted,
        toolCompleted: context.toolCompleted,
        toolFailed: context.toolFailed,
        durationMs: Date.now() - context.startedAt,
      });

      this.emit(context.params, {
        type: 'final',
        text: finalText,
        stopReason: chatPayload.stopReason,
        usage: chatPayload.usage,
      });

      this.finishContext(context);
      return;
    }

    if (chatPayload.state === 'aborted') {
      this.failContext(context, 'Chat request was aborted.', {
        state: 'chat-aborted',
        deltaChunks: context.deltaChunks,
        deltaCharacters: context.deltaCharacters,
      });
      return;
    }

    if (chatPayload.state === 'error') {
      this.failContext(
        context,
        chatPayload.errorMessage ?? 'Chat request failed.',
        {
          state: 'chat-error',
          deltaChunks: context.deltaChunks,
          deltaCharacters: context.deltaCharacters,
        },
      );
    }
  }

  private handleMessageFrame(
    frame: GatewayResponseFrame | GatewayEventFrame,
  ): void {
    if (frame.type === 'res') {
      this.handleResponseFrame(frame);
      return;
    }

    if (frame.event === 'agent') {
      this.handleAgentEvent(frame.payload);
      return;
    }

    if (frame.event === 'chat') {
      this.handleChatEvent(frame.payload);
    }
  }

  private bindConnectedSocket(ws: WebSocket): void {
    const generation = ++this.connectGeneration;

    ws.onerror = () => {
      if (this.connectGeneration !== generation) {
        return;
      }

      this.ws = null;
      this.failAllActiveContexts('OpenClaw websocket connection failed.', {
        state: 'socket-error',
      });
    };

    ws.onclose = (event) => {
      if (this.connectGeneration !== generation) {
        return;
      }

      this.ws = null;
      this.failAllActiveContexts(`OpenClaw websocket closed (${event.code}).`, {
        state: 'socket-close',
        socketCode: event.code,
        socketReason: event.reason,
      });
    };

    ws.onmessage = (event) => {
      let frame: GatewayResponseFrame | GatewayEventFrame;

      try {
        frame = JSON.parse(String(event.data)) as
          | GatewayResponseFrame
          | GatewayEventFrame;
      } catch (error) {
        logError('openclaw.gateway', 'openclaw.stream.unhandled_error', {
          message:
            error instanceof Error
              ? error.message
              : 'Failed to parse frame JSON.',
          state: 'frame-parse',
        });
        this.failAllActiveContexts('OpenClaw frame parse failed.', {
          state: 'frame-parse',
        });
        return;
      }

      this.handleMessageFrame(frame);
    };
  }

  private async establishConnectedSocket(params: {
    config: GatewayConfig;
    identity: DeviceIdentity;
    requestId: string;
    attempt: number;
  }): Promise<WebSocket> {
    const startedAt = Date.now();

    return new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(params.config.url);
      const connectId = crypto.randomUUID();
      let settled = false;
      let connectTimeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (connectTimeoutId) {
          clearTimeout(connectTimeoutId);
          connectTimeoutId = null;
        }
      };

      const finish = (error?: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();

        if (error) {
          if (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
          ) {
            ws.close();
          }

          reject(error);
          return;
        }

        resolve(ws);
      };

      const fail = (message: string, data: Record<string, unknown> = {}) => {
        logError('openclaw.gateway', 'openclaw.stream.failure', {
          requestId: params.requestId,
          attempt: params.attempt,
          durationMs: Date.now() - startedAt,
          message,
          ...data,
        });
        finish(new Error(message));
      };

      connectTimeoutId = setTimeout(() => {
        fail('Timed out while connecting to OpenClaw.', {
          state: 'connect-timeout',
        });
      }, CONNECT_TIMEOUT_MS);

      ws.onerror = () => {
        fail('OpenClaw websocket connection failed.', {
          state: 'socket-error',
        });
      };

      ws.onclose = (event) => {
        if (!settled) {
          fail(`OpenClaw websocket closed (${event.code}).`, {
            state: 'socket-close',
            socketCode: event.code,
            socketReason: event.reason,
          });
        }
      };

      ws.onopen = () => {
        logInfo('openclaw.gateway', 'openclaw.socket.open', {
          requestId: params.requestId,
          attempt: params.attempt,
        });
      };

      ws.onmessage = (event) => {
        let frame: GatewayResponseFrame | GatewayEventFrame;

        try {
          frame = JSON.parse(String(event.data)) as
            | GatewayResponseFrame
            | GatewayEventFrame;
        } catch (error) {
          fail('OpenClaw frame parse failed.', {
            state: 'frame-parse',
            message:
              error instanceof Error
                ? error.message
                : 'Failed to parse frame JSON.',
          });
          return;
        }

        if (frame.type === 'event' && frame.event === 'connect.challenge') {
          const nonce =
            frame.payload &&
            typeof frame.payload === 'object' &&
            'nonce' in frame.payload &&
            typeof frame.payload.nonce === 'string'
              ? frame.payload.nonce
              : '';

          if (!nonce) {
            fail('OpenClaw challenge nonce was missing.', {
              state: 'connect-challenge',
            });
            return;
          }

          logInfo('openclaw.gateway', 'openclaw.connect.challenge', {
            requestId: params.requestId,
            attempt: params.attempt,
          });

          const signedAtMs = Date.now();
          const payload = buildDeviceAuthPayload({
            deviceId: params.identity.deviceId,
            clientId: params.config.clientId,
            clientMode: params.config.clientMode,
            role: 'operator',
            scopes: OPERATOR_SCOPES,
            signedAtMs,
            token: params.config.token,
            nonce,
            platform: params.config.platform,
            deviceFamily: params.config.deviceFamily,
          });

          ws.send(
            JSON.stringify({
              type: 'req',
              id: connectId,
              method: 'connect',
              params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                  id: params.config.clientId,
                  version: '0.1.0',
                  platform: params.config.platform,
                  deviceFamily: params.config.deviceFamily,
                  mode: params.config.clientMode,
                },
                auth: {
                  token: params.config.token,
                },
                role: 'operator',
                scopes: OPERATOR_SCOPES,
                device: {
                  id: params.identity.deviceId,
                  publicKey: publicKeyRawBase64UrlFromPem(
                    params.identity.publicKeyPem,
                  ),
                  signature: signDevicePayload(
                    params.identity.privateKeyPem,
                    payload,
                  ),
                  signedAt: signedAtMs,
                  nonce,
                },
              },
            }),
          );
          return;
        }

        if (frame.type !== 'res' || frame.id !== connectId) {
          return;
        }

        if (!frame.ok) {
          const detailCode = frame.error?.details?.code;
          const message = frame.error?.message ?? 'OpenClaw connect failed.';

          if (detailCode === 'PAIRING_REQUIRED') {
            if (params.attempt < PAIRING_MAX_CONNECT_ATTEMPTS - 1) {
              logWarn('openclaw.gateway', 'openclaw.connect.pairing_required', {
                requestId: params.requestId,
                attempt: params.attempt,
                detailCode,
              });
              finish(new Error(PAIRING_RETRY_SENTINEL));
              return;
            }

            fail(message, {
              state: 'connect-response',
              detailCode,
              errorCode: frame.error?.code,
            });
            return;
          }

          fail(message, {
            state: 'connect-response',
            detailCode,
            errorCode: frame.error?.code,
          });
          return;
        }

        const hello =
          frame.payload && typeof frame.payload === 'object'
            ? frame.payload
            : {};

        this.defaultSessionKey =
          'snapshot' in hello &&
          hello.snapshot &&
          typeof hello.snapshot === 'object' &&
          'sessionDefaults' in hello.snapshot &&
          hello.snapshot.sessionDefaults &&
          typeof hello.snapshot.sessionDefaults === 'object' &&
          'mainSessionKey' in hello.snapshot.sessionDefaults &&
          typeof hello.snapshot.sessionDefaults.mainSessionKey === 'string'
            ? hello.snapshot.sessionDefaults.mainSessionKey
            : DEFAULT_SESSION_KEY;

        logInfo('openclaw.gateway', 'openclaw.connect.accepted', {
          requestId: params.requestId,
          attempt: params.attempt,
          resolvedSessionKey: this.defaultSessionKey,
        });

        finish();
      };
    });
  }

  private async ensureConnected(requestId: string): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      let config: GatewayConfig;

      try {
        config = readGatewayConfig();
      } catch (error) {
        logError('openclaw.gateway', 'openclaw.config.error', {
          requestId,
          attempt: 0,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to read gateway config.',
        });
        throw error;
      }

      let identity: DeviceIdentity;

      try {
        identity = await loadIdentity(config.identityPath);
      } catch (error) {
        logError('openclaw.gateway', 'openclaw.identity.error', {
          requestId,
          attempt: 0,
          identityPath: config.identityPath,
          message:
            error instanceof Error
              ? error.message
              : 'Failed to load device identity.',
        });
        throw error;
      }

      for (let attempt = 0; attempt < PAIRING_MAX_CONNECT_ATTEMPTS; attempt += 1) {
        try {
          const ws = await this.establishConnectedSocket({
            config,
            identity,
            requestId,
            attempt,
          });

          this.ws = ws;
          this.bindConnectedSocket(ws);
          return;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === PAIRING_RETRY_SENTINEL &&
            attempt < PAIRING_MAX_CONNECT_ATTEMPTS - 1
          ) {
            logWarn('openclaw.gateway', 'openclaw.connect.retry_pairing', {
              requestId,
              attempt,
              remainingAttempts: PAIRING_MAX_CONNECT_ATTEMPTS - attempt - 1,
              delayMs: PAIRING_RETRY_DELAY_MS,
            });
            await new Promise((resolve) =>
              setTimeout(resolve, PAIRING_RETRY_DELAY_MS),
            );
            continue;
          }

          throw error;
        }
      }
    })().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }
}

const gatewayClient = new OpenClawGatewayClient();

export async function streamChat(params: StreamChatParams): Promise<void> {
  return gatewayClient.streamChat(params);
}

export async function healthcheck(): Promise<{
  gatewayUrl: string;
  hasToken: boolean;
  hasIdentity: boolean;
}> {
  const config = readGatewayConfig();
  let hasIdentity = false;

  try {
    await fs.access(config.identityPath);
    hasIdentity = true;
  } catch {
    hasIdentity = false;
  }

  return {
    gatewayUrl: config.url,
    hasToken: Boolean(config.token),
    hasIdentity,
  };
}
