"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Send,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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

function agentInitials(name: string): string {
  const tokens = name
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (!tokens.length) {
    return "A";
  }

  if (tokens.length === 1) {
    return tokens[0].slice(0, 2).toUpperCase();
  }

  return `${tokens[0][0] ?? "A"}${tokens[1][0] ?? "G"}`.toUpperCase();
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

type SidebarContentProps = {
  controller: ChatWorkspaceController;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
};

function SidebarContent({
  controller,
  isCollapsed = false,
  onToggleCollapse,
}: SidebarContentProps) {
  const {
    agents,
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

  if (isCollapsed) {
    return (
      <div className="relative z-20 flex h-full min-h-0 flex-col items-center overflow-hidden border-r border-white/12 bg-[#2a3649] px-2.5 py-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="h-9 w-9 rounded-lg border border-white/20 bg-white/8 text-slate-100 hover:bg-white/14"
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          onClick={createThreadForSelectedAgent}
          disabled={isSubmitting}
          size="icon"
          className="mt-3 h-10 w-10 rounded-lg bg-amber-300 text-slate-950 hover:bg-amber-200"
          title="New chat"
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </Button>

        <ScrollArea className="mt-3 w-full min-h-0 flex-1">
          <div className="flex flex-col items-center gap-2 py-1">
            {agents.map((agent) => {
              const isSelected = selectedAgentId === agent.id;

              return (
                <Button
                  key={agent.id}
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => selectAgent(agent.id)}
                  className={cn(
                    "h-10 w-10 rounded-lg border text-[11px] font-semibold tracking-[0.03em]",
                    isSelected
                      ? "border-sky-200/50 bg-sky-200/15 text-sky-50"
                      : "border-transparent bg-white/8 text-slate-200 hover:border-white/20 hover:bg-white/14",
                  )}
                  title={agent.name}
                  aria-label={agent.name}
                >
                  {agentInitials(agent.name)}
                </Button>
              );
            })}
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="relative z-20 flex h-full min-h-0 flex-col overflow-hidden border-r border-white/12 bg-[#2a3649] px-4 py-4">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-white/12 px-1 pb-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-slate-300">
            OpenClaw
          </p>
          <p className="text-base font-semibold text-slate-50">Agent Workspace</p>
        </div>
        {onToggleCollapse ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            className="h-8 w-8 rounded-md border border-white/20 bg-white/10 text-slate-100 hover:bg-white/16"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <Button
        type="button"
        onClick={createThreadForSelectedAgent}
        disabled={isSubmitting}
        className="mb-4 h-11 justify-start rounded-lg bg-amber-300 text-slate-950 hover:bg-amber-200"
      >
        <Plus className="mr-2 h-4 w-4" />
        New Chat
      </Button>

      <ScrollArea className="min-h-0 flex-1 pr-1">
        <div className="space-y-4 pb-3 pr-1.5">
          <div className="px-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-slate-300/85">
              Thread Tree
            </p>
          </div>
          <div className="space-y-1">
            {agents.map((agent, index) => {
              const isSelected = selectedAgentId === agent.id;

              return (
                <div
                  key={agent.id}
                  style={{ animationDelay: `${index * 28}ms` }}
                  className="app-enter-soft"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => selectAgent(agent.id)}
                    className={cn(
                      "h-10 w-full justify-start rounded-md border px-3 text-left text-[13px]",
                      isSelected
                        ? "border-white/25 bg-white/12 text-slate-50"
                        : "border-transparent bg-transparent text-slate-200 hover:border-white/15 hover:bg-white/8",
                    )}
                  >
                    {isSelected ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                    )}
                    {isSelected ? (
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-200" />
                    ) : (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    )}
                    <span className="min-w-0 truncate font-medium">{agent.name}</span>
                  </Button>

                  {isSelected ? (
                    <div className="ml-5 mt-1.5 space-y-1 border-l border-white/15 pl-3">
                      {visibleThreads.length ? (
                        visibleThreads.map((thread) => (
                          <Button
                            key={thread.id}
                            type="button"
                            variant="ghost"
                            onClick={() => selectThread(thread)}
                            className={cn(
                              "h-auto w-full items-start justify-start gap-2 rounded-md px-2.5 py-2 text-left",
                              activeThread?.id === thread.id
                                ? "bg-slate-100/10 text-slate-100"
                                : "text-slate-300 hover:bg-white/8 hover:text-slate-100",
                            )}
                          >
                            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 space-y-0.5">
                              <span className="block truncate text-[12px] font-medium leading-5">
                                {thread.title}
                              </span>
                              <span className="block truncate text-[10px] text-slate-400">
                                {getThreadPreview(thread)}
                              </span>
                              <span className="block text-[9px] uppercase tracking-[0.14em] text-slate-400">
                                {formatUpdatedAt(thread.updatedAt)}
                              </span>
                            </span>
                          </Button>
                        ))
                      ) : (
                        <p className="px-2 py-1 text-[11px] text-slate-500">
                          Empty folder
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="border-t border-white/12 pt-3">
            {isCreatingAgent ? (
              <form
                onSubmit={handleCreateAgent}
                className="space-y-2.5 rounded-lg border border-white/15 bg-white/7 p-3"
              >
                <Input
                  value={newAgentName}
                  onChange={(event) => setNewAgentNameValue(event.target.value)}
                  placeholder="Agent name"
                  className="h-10"
                />
                <Textarea
                  value={newAgentInstructions}
                  onChange={(event) =>
                    setNewAgentInstructionsValue(event.target.value)
                  }
                  placeholder="Agent instructions"
                  rows={3}
                  className="min-h-[98px] resize-none rounded-lg px-3 py-2"
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={!newAgentName.trim() || !newAgentInstructions.trim()}
                    className="h-8 flex-1 bg-amber-300 text-[11px] uppercase tracking-[0.12em] text-slate-950 hover:bg-amber-200"
                  >
                    Create
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={cancelCreateAgent}
                    className="h-8 border-white/20 px-2.5 text-[11px] uppercase tracking-[0.12em] text-slate-200"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={startCreateAgent}
                className="h-9 w-full justify-start rounded-md text-[12px] uppercase tracking-[0.15em] text-slate-200 hover:bg-white/10"
              >
                <Plus className="h-3.5 w-3.5" />
                New Agent Folder
              </Button>
            )}
          </div>
        </div>
      </ScrollArea>

      <Card className="mt-4 border-white/15 bg-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-300">
            Gateway Config
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            value={configDraft.modelPrimary}
            onChange={(event) => setConfigModelPrimaryValue(event.target.value)}
            placeholder="Model id"
            className="h-8 text-[11px]"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={configDraft.gatewayMode}
              onChange={(event) => setConfigGatewayModeValue(event.target.value)}
              placeholder="Mode"
              className="h-8 text-[11px]"
            />
            <Input
              value={configDraft.gatewayBind}
              onChange={(event) => setConfigGatewayBindValue(event.target.value)}
              placeholder="Bind"
              className="h-8 text-[11px]"
            />
          </div>
          <Input
            value={configDraft.tokenEnvId}
            onChange={(event) => setConfigTokenEnvIdValue(event.target.value)}
            placeholder="Token env id"
            className="h-8 text-[11px]"
          />
          <Button
            type="button"
            onClick={() => void handleConfigSubmit()}
            disabled={isConfigSaving}
            className="h-8 w-full rounded-lg bg-sky-300 text-[11px] uppercase tracking-[0.16em] text-slate-950 hover:bg-sky-200"
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const toggleSidebarCollapsed = useCallback(() => {
    setIsSidebarCollapsed((current) => !current);
  }, []);

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
        <div
          className={cn(
            "app-enter isolate grid h-full min-h-0 overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/72 shadow-[0_28px_90px_rgba(2,6,23,0.58)] lg:grid-cols-[360px_minmax(0,1fr)]",
            isSidebarCollapsed && "lg:grid-cols-[82px_minmax(0,1fr)]",
          )}
        >
          <aside className="hidden min-h-0 lg:relative lg:z-20 lg:flex">
            <SidebarContent
              controller={controller}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={toggleSidebarCollapsed}
            />
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

          <section className="relative z-0 flex min-h-0 min-w-0 flex-col border-l border-white/8">
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
