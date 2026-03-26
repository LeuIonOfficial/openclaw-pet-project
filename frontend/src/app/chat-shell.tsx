"use client";

import { AssistantMarkdown } from "@/features/chat-workspace/assistant-markdown";
import {
  formatUpdatedAt,
  getThreadPreview,
} from "@/features/chat-workspace/helpers";
import { useChatWorkspace } from "@/features/chat-workspace/use-chat-workspace";

export function ChatShell() {
  const {
    listRef,
    agents,
    selectedAgent,
    selectedAgentId,
    activeAgent,
    visibleThreads,
    activeThread,
    connectionState,
    input,
    inputLength,
    isSubmitting,
    isSidebarOpen,
    isCreatingAgent,
    newAgentName,
    newAgentInstructions,
    setSidebarOpen,
    setInputValue,
    setNewAgentNameValue,
    setNewAgentInstructionsValue,
    startCreateAgent,
    cancelCreateAgent,
    createThreadForSelectedAgent,
    selectAgent,
    selectThread,
    handleCreateAgent,
    handleSubmit,
  } = useChatWorkspace();

  return (
    <main className="relative h-screen overflow-hidden bg-[#040714] text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-[-20%] h-[48vh] w-[48vh] rounded-full bg-sky-400/10 blur-3xl" />
        <div className="absolute -right-20 bottom-[-22%] h-[44vh] w-[44vh] rounded-full bg-amber-300/10 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(148,163,184,0.06)_1px,transparent_1px),linear-gradient(to_right,rgba(148,163,184,0.04)_1px,transparent_1px)] bg-[size:42px_42px]" />
      </div>

      <div className="relative mx-auto h-full max-w-[1620px] p-3 sm:p-4">
        <div className="app-enter grid h-full overflow-hidden rounded-[30px] border border-white/10 bg-slate-950/72 shadow-[0_28px_90px_rgba(2,6,23,0.58)] lg:grid-cols-[340px_minmax(0,1fr)]">
          {isSidebarOpen ? (
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-20 bg-black/45 lg:hidden"
              aria-label="Close sidebar"
            />
          ) : null}

          <aside
            className={`fixed inset-y-0 left-0 z-30 flex w-[316px] flex-col border-r border-white/10 bg-slate-950/96 px-3 py-4 transition-transform duration-300 lg:static lg:z-auto lg:w-[340px] lg:translate-x-0 lg:bg-slate-950/70 ${
              isSidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="app-enter-soft mb-4 flex items-center justify-between border-b border-white/10 px-1 pb-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-slate-400">
                  OpenClaw
                </p>
                <p className="text-base font-semibold text-slate-100">Agent Workspace</p>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="h-8 rounded-lg border border-white/15 px-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-300 lg:hidden"
              >
                Close
              </button>
            </div>

            <button
              type="button"
              onClick={createThreadForSelectedAgent}
              disabled={isSubmitting}
              className="mb-4 rounded-2xl border border-amber-300/45 bg-amber-300/90 px-4 py-3 text-left text-sm font-semibold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-65"
            >
              + New Chat
            </button>

            <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">
              Agents
            </div>

            <div className="mb-4 space-y-1 overflow-y-auto pr-1">
              {agents.map((agent, index) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => selectAgent(agent.id)}
                  style={{ animationDelay: `${index * 35}ms` }}
                  className={`app-enter-soft row-shift flex w-full flex-col rounded-xl border px-3 py-2.5 text-left ${
                    selectedAgentId === agent.id
                      ? "border-sky-300/40 bg-sky-300/10"
                      : "border-transparent bg-white/5 hover:border-white/15 hover:bg-white/10"
                  }`}
                >
                  <span className="line-clamp-1 text-sm font-medium text-slate-100">
                    {agent.name}
                  </span>
                  <span className="line-clamp-2 text-xs leading-5 text-slate-400">
                    {agent.instructions}
                  </span>
                </button>
              ))}
            </div>

            {isCreatingAgent ? (
              <form
                onSubmit={handleCreateAgent}
                className="mb-4 space-y-2 rounded-xl border border-white/15 bg-white/5 p-3"
              >
                <input
                  value={newAgentName}
                  onChange={(event) => setNewAgentNameValue(event.target.value)}
                  placeholder="Agent name"
                  className="h-10 w-full rounded-lg border border-white/15 bg-slate-950/85 px-3 text-sm text-slate-100 outline-none focus:border-amber-300/70"
                />
                <textarea
                  value={newAgentInstructions}
                  onChange={(event) =>
                    setNewAgentInstructionsValue(event.target.value)
                  }
                  placeholder="Agent instructions"
                  rows={4}
                  className="w-full resize-none rounded-lg border border-white/15 bg-slate-950/85 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-300/70"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={!newAgentName.trim() || !newAgentInstructions.trim()}
                    className="h-9 flex-1 rounded-lg bg-amber-300 text-xs font-semibold uppercase tracking-[0.14em] text-slate-950 disabled:cursor-not-allowed disabled:bg-amber-100"
                  >
                    Create
                  </button>
                  <button
                    type="button"
                    onClick={cancelCreateAgent}
                    className="h-9 rounded-lg border border-white/20 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={startCreateAgent}
                className="mb-4 h-10 rounded-xl border border-white/15 bg-white/5 px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-200 transition hover:bg-white/10"
              >
                + Create Agent
              </button>
            )}

            <div className="mb-2 px-1 font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">
              {selectedAgent?.name ?? "Agent"} Chats
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {visibleThreads.length ? (
                visibleThreads.map((thread, index) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => selectThread(thread)}
                    style={{ animationDelay: `${index * 28}ms` }}
                    className={`app-enter-soft row-shift flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left ${
                      activeThread?.id === thread.id
                        ? "border-amber-300/40 bg-amber-300/10"
                        : "border-transparent bg-white/5 hover:border-white/15 hover:bg-white/10"
                    }`}
                  >
                    <span className="line-clamp-1 text-sm font-medium text-slate-100">
                      {thread.title}
                    </span>
                    <span className="line-clamp-2 text-xs leading-5 text-slate-400">
                      {getThreadPreview(thread)}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      {formatUpdatedAt(thread.updatedAt)}
                    </span>
                  </button>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-3 text-xs leading-6 text-slate-300">
                  No chats yet for this agent.
                </div>
              )}
            </div>
          </aside>

          <section className="relative flex min-h-0 min-w-0 flex-col">
            <header className="app-enter-soft flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-200 transition hover:bg-white/15 lg:hidden"
                >
                  Agents
                </button>
                <div className="min-w-0">
                  <p className="line-clamp-1 text-lg font-semibold text-slate-100">
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
                <div
                  className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] sm:text-[11px] ${
                    connectionState.tone === "good"
                      ? "bg-emerald-400/15 text-emerald-200"
                      : connectionState.tone === "bad"
                        ? "bg-rose-400/15 text-rose-200"
                        : "bg-white/10 text-slate-200"
                  }`}
                >
                  {connectionState.label}
                </div>
              </div>
            </header>

            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-10">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                {(activeThread?.messages.length ?? 0) === 0 ? (
                  <div className="app-enter-soft rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-sm leading-7 text-slate-300">
                    No messages in this chat yet. This thread is attached to{" "}
                    <span className="font-semibold text-slate-100">
                      {activeAgent?.name ?? "Assistant"}
                    </span>
                    . Start with your task and it will stay isolated in this session.
                  </div>
                ) : null}

                {activeThread?.messages.map((message, index) => (
                  <article
                    key={message.id}
                    style={{ animationDelay: `${Math.min(index, 10) * 28}ms` }}
                    className={`message-enter rounded-2xl px-4 py-3 sm:px-5 ${
                      message.role === "user"
                        ? "ml-auto max-w-3xl border border-amber-200/20 bg-amber-300 text-slate-950"
                        : message.status === "error"
                          ? "mr-auto max-w-3xl border border-rose-300/30 bg-rose-300/15 text-rose-100"
                          : "mr-auto max-w-3xl border border-white/10 bg-white/8 text-slate-100"
                    }`}
                  >
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] opacity-70 sm:text-[11px]">
                      {message.role === "user" ? "Operator" : activeAgent?.name ?? "Assistant"}
                    </p>
                    {message.role === "assistant" ? (
                      message.status === "done" ? (
                        <AssistantMarkdown content={message.content} />
                      ) : (
                        <p className="whitespace-pre-wrap text-sm leading-7 sm:text-[15px]">
                          {message.content || "Streaming..."}
                        </p>
                      )
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-7 sm:text-[15px]">
                        {message.content || "Streaming..."}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="border-t border-white/10 bg-slate-950/72 px-4 py-4 backdrop-blur sm:px-8 sm:py-5"
            >
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 sm:flex-row sm:items-end">
                <textarea
                  value={input}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder={`Message ${activeAgent?.name ?? "assistant"}...`}
                  rows={3}
                  className="min-h-[104px] flex-1 resize-none rounded-2xl border border-white/15 bg-slate-950/85 px-4 py-3 text-sm text-slate-100 outline-none transition focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/25"
                />
                <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    {inputLength} chars
                  </span>
                  <button
                    type="submit"
                    disabled={isSubmitting || !activeThread}
                    className="h-11 rounded-xl bg-amber-300 px-6 text-sm font-semibold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:bg-amber-100"
                  >
                    {isSubmitting ? "Streaming..." : "Send"}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
