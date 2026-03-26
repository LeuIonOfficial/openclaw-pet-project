"use client";

import Image from "next/image";
import { useCallback } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Menu, Paperclip, Plus, Send, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { AssistantMarkdown } from "@/features/chat-workspace/assistant-markdown";
import {
  formatUpdatedAt,
  getThreadPreview,
} from "@/features/chat-workspace/helpers";
import type {
  MessageAttachment,
  ToolCallTrace,
} from "@/features/chat-workspace/types";
import {
  useChatWorkspace,
  type ChatWorkspaceController,
} from "@/features/chat-workspace/use-chat-workspace";
import { cn } from "@/lib/utils";

function formatBytes(value: number): string {
  if (value < 1_024) {
    return `${value} B`;
  }

  if (value < 1_024 * 1_024) {
    return `${Math.round(value / 1_024)} KB`;
  }

  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

function connectionVariant(
  tone: ChatWorkspaceController["connectionState"]["tone"],
): "default" | "success" | "danger" {
  if (tone === "good") {
    return "success";
  }

  if (tone === "bad") {
    return "danger";
  }

  return "default";
}

function ToolTraceCard({ trace }: { trace: ToolCallTrace }) {
  return (
    <Card className="border-white/10 bg-slate-900/55">
      <CardContent className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
            Tool
          </span>
          <span className="text-xs font-semibold text-slate-100">{trace.name}</span>
          <Badge
            variant={
              trace.status === "completed"
                ? "success"
                : trace.status === "error"
                  ? "danger"
                  : "warning"
            }
            className="px-2 py-0.5 text-[9px]"
          >
            {trace.status}
          </Badge>
        </div>

        {trace.meta ? <p className="text-xs text-slate-400">{trace.meta}</p> : null}

        {trace.args ? (
          <details className="rounded-lg border border-white/10 bg-black/20 p-2">
            <summary className="cursor-pointer text-xs font-medium text-slate-300">
              Parameters
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-slate-300">
              {trace.args}
            </pre>
          </details>
        ) : null}

        {trace.output ? (
          <details
            className="rounded-lg border border-white/10 bg-black/20 p-2"
            open={trace.status === "error"}
          >
            <summary className="cursor-pointer text-xs font-medium text-slate-300">
              Output
            </summary>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-slate-300">
              {trace.output}
            </pre>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AttachmentPreview({
  attachments,
  onRemove,
}: {
  attachments: MessageAttachment[];
  onRemove?: (attachmentId: string) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group relative overflow-hidden rounded-xl border border-white/15 bg-slate-900/75"
        >
          <Image
            src={attachment.dataUrl}
            alt={attachment.name}
            width={112}
            height={80}
            unoptimized
            className="h-20 w-28 object-cover"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1">
            <p className="line-clamp-1 text-[10px] text-white">{attachment.name}</p>
            <p className="text-[9px] uppercase tracking-[0.12em] text-slate-200">
              {formatBytes(attachment.size)}
            </p>
          </div>
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(attachment.id)}
              className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/60 text-[10px] text-white hover:bg-black/80"
              aria-label={`Remove ${attachment.name}`}
            >
              <span aria-hidden>x</span>
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function SidebarContent({
  controller,
}: {
  controller: ChatWorkspaceController;
}) {
  const {
    agents,
    selectedAgent,
    selectedAgentId,
    visibleThreads,
    activeThread,
    isSubmitting,
    isCreatingAgent,
    isConfigSaving,
    newAgentName,
    newAgentInstructions,
    configDraft,
    configStatus,
    setConfigModelPrimaryValue,
    setConfigGatewayModeValue,
    setConfigGatewayBindValue,
    setConfigTokenEnvIdValue,
    setNewAgentNameValue,
    setNewAgentInstructionsValue,
    startCreateAgent,
    cancelCreateAgent,
    createThreadForSelectedAgent,
    selectAgent,
    selectThread,
    handleConfigSubmit,
    handleCreateAgent,
  } = controller;

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-white/10 bg-slate-950/78 px-3 py-4">
      <div className="mb-4 border-b border-white/10 px-1 pb-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-slate-400">
          OpenClaw
        </p>
        <p className="text-base font-semibold text-slate-100">Agent Workspace</p>
      </div>

      <Button
        type="button"
        onClick={createThreadForSelectedAgent}
        disabled={isSubmitting}
        className="mb-4 justify-start rounded-xl bg-amber-300 text-slate-950 hover:bg-amber-200"
      >
        <Plus className="mr-2 h-4 w-4" />
        New Chat
      </Button>

      <p className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">
        Agents
      </p>

      <ScrollArea className="mb-4 max-h-56 pr-1">
        <div className="space-y-1 pb-1 pr-2">
          {agents.map((agent, index) => (
            <Button
              key={agent.id}
              type="button"
              variant="ghost"
              onClick={() => selectAgent(agent.id)}
              style={{ animationDelay: `${index * 35}ms` }}
              className={cn(
                "app-enter-soft row-shift h-auto w-full flex-col items-start rounded-xl border px-3 py-2.5 text-left",
                selectedAgentId === agent.id
                  ? "border-sky-300/40 bg-sky-300/10"
                  : "border-transparent bg-white/5 hover:border-white/15 hover:bg-white/10",
              )}
            >
              <span className="line-clamp-1 w-full text-sm font-medium text-slate-100">
                {agent.name}
              </span>
              <span className="line-clamp-2 w-full text-xs leading-5 text-slate-400">
                {agent.instructions}
              </span>
            </Button>
          ))}
        </div>
      </ScrollArea>

      {isCreatingAgent ? (
        <form
          onSubmit={handleCreateAgent}
          className="mb-4 space-y-2 rounded-xl border border-white/15 bg-white/5 p-3"
        >
          <Input
            value={newAgentName}
            onChange={(event) => setNewAgentNameValue(event.target.value)}
            placeholder="Agent name"
            className="h-10"
          />
          <Textarea
            value={newAgentInstructions}
            onChange={(event) => setNewAgentInstructionsValue(event.target.value)}
            placeholder="Agent instructions"
            rows={4}
            className="min-h-[112px] resize-none rounded-xl px-3 py-2"
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={!newAgentName.trim() || !newAgentInstructions.trim()}
              className="h-9 flex-1 bg-amber-300 text-xs uppercase tracking-[0.14em] text-slate-950 hover:bg-amber-200"
            >
              Create
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={cancelCreateAgent}
              className="h-9 border-white/20 px-3 text-xs uppercase tracking-[0.14em] text-slate-200"
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={startCreateAgent}
          className="mb-4 h-10 rounded-xl border-white/15 bg-white/5 text-xs uppercase tracking-[0.16em] text-slate-200 hover:bg-white/10"
        >
          <Plus className="mr-2 h-3.5 w-3.5" />
          Create Agent
        </Button>
      )}

      <p className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">
        {selectedAgent?.name ?? "Agent"} Chats
      </p>

      <ScrollArea className="min-h-0 flex-1 pr-1">
        <div className="space-y-1 pb-2 pr-2">
          {visibleThreads.length ? (
            visibleThreads.map((thread, index) => (
              <Button
                key={thread.id}
                type="button"
                variant="ghost"
                onClick={() => selectThread(thread)}
                style={{ animationDelay: `${index * 28}ms` }}
                className={cn(
                  "app-enter-soft row-shift h-auto w-full flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left",
                  activeThread?.id === thread.id
                    ? "border-amber-300/40 bg-amber-300/10"
                    : "border-transparent bg-white/5 hover:border-white/15 hover:bg-white/10",
                )}
              >
                <span className="line-clamp-1 w-full text-sm font-medium text-slate-100">
                  {thread.title}
                </span>
                <span className="line-clamp-2 w-full text-xs leading-5 text-slate-400">
                  {getThreadPreview(thread)}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  {formatUpdatedAt(thread.updatedAt)}
                </span>
              </Button>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-3 text-xs leading-6 text-slate-300">
              No chats yet for this agent.
            </div>
          )}
        </div>
      </ScrollArea>

      <Card className="mt-4 border-white/12 bg-white/5">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
            Gateway Config
          </CardTitle>
          <CardDescription>Applied to OpenClaw gateway runtime.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            value={configDraft.modelPrimary}
            onChange={(event) => setConfigModelPrimaryValue(event.target.value)}
            placeholder="Model id"
            className="h-9 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={configDraft.gatewayMode}
              onChange={(event) => setConfigGatewayModeValue(event.target.value)}
              placeholder="Mode"
              className="h-9 text-xs"
            />
            <Input
              value={configDraft.gatewayBind}
              onChange={(event) => setConfigGatewayBindValue(event.target.value)}
              placeholder="Bind"
              className="h-9 text-xs"
            />
          </div>
          <Input
            value={configDraft.tokenEnvId}
            onChange={(event) => setConfigTokenEnvIdValue(event.target.value)}
            placeholder="Token env id"
            className="h-9 text-xs"
          />
          <Button
            type="button"
            onClick={() => void handleConfigSubmit()}
            disabled={isConfigSaving}
            className="h-9 w-full rounded-lg bg-sky-300 text-xs uppercase tracking-[0.16em] text-slate-950 hover:bg-sky-200"
          >
            {isConfigSaving ? "Saving..." : "Save Config"}
          </Button>
          {configStatus ? (
            <p className="text-[11px] leading-5 text-slate-300">{configStatus}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function ChatShell() {
  const controller = useChatWorkspace();
  const {
    listRef,
    activeAgent,
    activeThread,
    connectionState,
    input,
    inputLength,
    attachments,
    attachmentError,
    isSubmitting,
    isSidebarOpen,
    setSidebarOpen,
    setInputValue,
    clearAttachment,
    clearComposerAttachments,
    handleAttachmentFiles,
    handleSubmit,
  } = controller;

  const onDrop = useCallback(
    (acceptedFiles: File[], rejections: FileRejection[]) => {
      const files = [...acceptedFiles, ...rejections.map((entry) => entry.file)];

      if (files.length === 0) {
        return;
      }

      void handleAttachmentFiles(files);
    },
    [handleAttachmentFiles],
  );

  const { getInputProps, getRootProps, isDragActive, open } = useDropzone({
    accept: {
      "image/*": [],
    },
    noClick: true,
    noKeyboard: true,
    multiple: true,
    disabled: isSubmitting,
    onDrop,
  });

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#040714] text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-20%] h-[48vh] w-[48vh] rounded-full bg-sky-400/10 blur-3xl" />
        <div className="absolute -right-20 bottom-[-22%] h-[44vh] w-[44vh] rounded-full bg-amber-300/10 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(to_right,rgba(148,163,184,0.04)_1px,transparent_1px)] bg-[size:42px_42px]" />
      </div>

      <div className="relative mx-auto h-full w-full max-w-[1680px] p-2 sm:p-4">
        <div className="app-enter grid h-full min-h-0 overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/72 shadow-[0_28px_90px_rgba(2,6,23,0.58)] lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="hidden min-h-0 lg:flex">
            <SidebarContent controller={controller} />
          </aside>

          <Sheet open={isSidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-[min(90vw,340px)] p-0 lg:hidden">
              <SheetHeader className="sr-only">
                <SheetTitle>Agent Workspace</SheetTitle>
                <SheetDescription>Switch agents and chats.</SheetDescription>
              </SheetHeader>
              <SidebarContent controller={controller} />
            </SheetContent>
          </Sheet>

          <section className="relative flex min-h-0 min-w-0 flex-col">
            <header className="app-enter-soft flex items-center justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-6 sm:py-4">
              <div className="flex min-w-0 items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen(true)}
                  className="h-9 w-9 rounded-lg border border-white/15 bg-white/10 text-slate-100 hover:bg-white/15 lg:hidden"
                >
                  <Menu className="h-4 w-4" />
                  <span className="sr-only">Open agents</span>
                </Button>

                <div className="min-w-0">
                  <p className="line-clamp-1 text-base font-semibold text-slate-100 sm:text-lg">
                    {activeThread?.title ?? "New chat"}
                  </p>
                  <p className="line-clamp-1 font-mono text-[11px] uppercase tracking-[0.22em] text-slate-400">
                    {activeAgent?.name ?? "Assistant"} • isolated session
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="hidden rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300 sm:inline-flex">
                  Live stream
                </span>
                <Badge variant={connectionVariant(connectionState.tone)}>
                  {connectionState.label}
                </Badge>
              </div>
            </header>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-8 sm:py-6">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 sm:gap-6">
                {(activeThread?.messages.length ?? 0) === 0 ? (
                  <Card className="app-enter-soft border-dashed border-white/15 bg-white/5">
                    <CardContent className="p-5 text-sm leading-7 text-slate-300 sm:p-6">
                      No messages in this chat yet. This thread is attached to{" "}
                      <span className="font-semibold text-slate-100">
                        {activeAgent?.name ?? "Assistant"}
                      </span>
                      . Start with your task and it will stay isolated in this session.
                    </CardContent>
                  </Card>
                ) : null}

                {activeThread?.messages.map((message, index) => (
                  <article
                    key={message.id}
                    style={{ animationDelay: `${Math.min(index, 10) * 28}ms` }}
                    className={cn(
                      "message-enter max-w-[min(100%,54rem)] rounded-2xl px-4 py-3 sm:px-5",
                      message.role === "user"
                        ? "ml-auto border border-amber-200/20 bg-amber-300 text-slate-950"
                        : message.status === "error"
                          ? "mr-auto border border-rose-300/30 bg-rose-300/15 text-rose-100"
                          : "mr-auto border border-white/10 bg-white/8 text-slate-100",
                    )}
                  >
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] opacity-70 sm:text-[11px]">
                      {message.role === "user"
                        ? "Operator"
                        : activeAgent?.name ?? "Assistant"}
                    </p>

                    {message.role === "assistant" ? (
                      <div className="space-y-3">
                        {message.status === "done" ? (
                          <AssistantMarkdown content={message.content} />
                        ) : (
                          <p className="whitespace-pre-wrap text-sm leading-7 sm:text-[15px]">
                            {message.content || "Streaming..."}
                          </p>
                        )}

                        {message.toolCalls?.length ? (
                          <div className="space-y-2 pt-1">
                            {message.toolCalls.map((trace) => (
                              <ToolTraceCard key={trace.id} trace={trace} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="whitespace-pre-wrap text-sm leading-7 sm:text-[15px]">
                          {message.content || "Streaming..."}
                        </p>
                        <AttachmentPreview attachments={message.attachments ?? []} />
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="border-t border-white/10 bg-slate-950/72 px-3 py-3 backdrop-blur sm:px-8 sm:py-4"
            >
              <div className="mx-auto w-full max-w-4xl space-y-3">
                <AttachmentPreview attachments={attachments} onRemove={clearAttachment} />
                {attachmentError ? (
                  <p className="text-xs text-rose-200">{attachmentError}</p>
                ) : null}

                <div
                  {...getRootProps()}
                  className={cn(
                    "rounded-2xl border border-dashed border-white/20 bg-white/4 px-3 py-2.5 sm:px-4",
                    isDragActive && "border-amber-300/60 bg-amber-300/10",
                    isSubmitting && "pointer-events-none opacity-70",
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-300">
                      {isDragActive
                        ? "Drop images to attach"
                        : "Drag images here or use attach"}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={open}
                        disabled={isSubmitting}
                        className="h-8 border-white/20 bg-white/6 text-[11px] uppercase tracking-[0.12em] text-slate-200"
                      >
                        <Paperclip className="mr-1.5 h-3.5 w-3.5" />
                        Attach
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearComposerAttachments}
                        disabled={isSubmitting || attachments.length === 0}
                        className="h-8 text-[11px] uppercase tracking-[0.12em] text-slate-300"
                      >
                        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <Textarea
                    value={input}
                    onChange={(event) => setInputValue(event.target.value)}
                    placeholder={`Message ${activeAgent?.name ?? "assistant"}...`}
                    rows={3}
                    className="min-h-[104px] resize-y"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      {inputLength} chars • {attachments.length} img
                    </span>
                    <Button
                      type="submit"
                      disabled={
                        isSubmitting ||
                        !activeThread ||
                        (inputLength === 0 && attachments.length === 0)
                      }
                      className="h-10 w-full bg-amber-300 text-sm text-slate-950 hover:bg-amber-200 sm:w-auto"
                    >
                      <Send className="mr-1.5 h-4 w-4" />
                      {isSubmitting ? "Streaming..." : "Send"}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
