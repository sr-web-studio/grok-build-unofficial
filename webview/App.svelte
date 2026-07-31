<script lang="ts">
  import { insertionIndex } from '../src/shared/protocol';
  import type {
    ApprovalDecision,
    HostMessage,
    PermissionMode,
    QuestionResponse,
    RewindPoint,
    SessionSummary,
    TranscriptBlock,
    UiStatus,
    WorktreeAction,
  } from '../src/shared/protocol';
  import About from './components/About.svelte';
  import CommandResult from './components/CommandResult.svelte';
  import Composer from './components/Composer.svelte';
  import Header from './components/Header.svelte';
  import Icon from './components/Icon.svelte';
  import PlanDock from './components/PlanDock.svelte';
  import StatusLine from './components/StatusLine.svelte';
  import Transcript from './components/Transcript.svelte';
  import { loadDraft, onHostMessage, saveDraft, send } from './ipc';
  import type { CommandResult as CommandResultMsg } from '../src/shared/protocol';

  /** Until the host sends the real state, render a plausible shell instead of nothing. */
  const initialStatus: UiStatus = {
    agentState: 'stopped',
    permissionMode: 'default',
    models: [],
    availableCommands: [],
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      turns: 0,
    },
    queuedCount: 0,
    queuedMessages: [],
  };

  let status = $state<UiStatus>(initialStatus);
  let blocks = $state<TranscriptBlock[]>([]);
  let showThinking = $state(true);
  let autoExpandThinking = $state(true);
  /** Resolved palette from the host (`grokBuild.theme`); applied as data-theme on <html>. */
  let theme = $state<'dark' | 'light'>('dark');

  /** Bumped on every host message so the transcript can re-run its sticky-scroll effect. */
  let revision = $state(0);

  let sessions = $state<SessionSummary[]>([]);
  let rewindPoints = $state<RewindPoint[]>([]);
  let panel = $state<'none' | 'history' | 'rewind' | 'about'>('none');
  let lastActiveElement = $state<HTMLElement | null>(null);
  let popoverElement = $state<HTMLElement | null>(null);
  let worktreeName = $state('');

  /** History filter, plus the row whose delete icon has been armed and is awaiting confirmation. */
  let sessionQuery = $state('');
  let pendingDelete = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  let renameDraft = $state('');
  let searchInput = $state<HTMLInputElement | null>(null);
  let renameInput = $state<HTMLInputElement | null>(null);

  const visibleSessions = $derived.by(() => {
    const q = sessionQuery.trim().toLowerCase();
    return q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions;
  });

  // Focus trap & trigger restoration for accessibility (§8)
  function openPanel(nextPanel: 'history' | 'rewind' | 'about') {
    if (panel === nextPanel) {
      closePanel();
    } else {
      lastActiveElement = (document.activeElement as HTMLElement) ?? null;
      panel = nextPanel;
      sessionQuery = '';
      pendingDelete = null;
      renamingId = null;
      renameDraft = '';
      if (nextPanel === 'history') send({ type: 'listSessions' });
      if (nextPanel === 'rewind') send({ type: 'listRewindPoints' });
    }
  }

  function closePanel() {
    panel = 'none';
    if (lastActiveElement) {
      lastActiveElement.focus();
      lastActiveElement = null;
    }
  }

  function handlePopoverKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (pendingDelete) {
        pendingDelete = null;
        return;
      }
      closePanel();
      return;
    }
    if (e.key === 'Tab' && popoverElement) {
      const focusables = popoverElement.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }

  $effect(() => {
    if (panel === 'history' && !renamingId) searchInput?.focus();
  });

  $effect(() => {
    if (renamingId) renameInput?.focus();
  });

  let draft = $state(loadDraft());
  let focusSignal = $state(0);
  /** Modal for /context, /compact, and other slash utilities (not chat bubbles). */
  let commandResult = $state<CommandResultMsg | null>(null);

  const busy = $derived(status.agentState === 'thinking' || status.agentState === 'awaitingApproval');
  const noGit = $derived(status.isGitRepo === false);

  $effect(() => {
    saveDraft(draft);
  });

  $effect(() => {
    document.documentElement.dataset.theme = theme;
  });

  $effect(() => {
    const off = onHostMessage(apply);
    send({ type: 'ready' });
    return off;
  });

  function apply(message: HostMessage): void {
    switch (message.type) {
      case 'state':
        status = message.state.status;
        blocks = message.state.blocks;
        showThinking = message.state.showThinking;
        autoExpandThinking = message.state.autoExpandThinking;
        break;
      case 'status':
        status = message.status;
        break;
      case 'blockAdd':
        blocks.splice(insertionIndex(blocks, message.anchorId), 0, message.block);
        break;
      case 'blockPatch': {
        const block = blocks.find((b) => b.id === message.id);
        if (!block) break;
        Object.assign(block, message.patch as Partial<TranscriptBlock>);
        if (message.appendText !== undefined && 'text' in block) {
          block.text += message.appendText;
        }
        if (message.appendOutput !== undefined && block.kind === 'tool') {
          block.liveOutput = (block.liveOutput ?? '') + message.appendOutput;
        }
        break;
      }
      case 'blockRemove': {
        const index = blocks.findIndex((b) => b.id === message.id);
        if (index >= 0) blocks.splice(index, 1);
        break;
      }
      case 'clear':
        blocks = [];
        break;
      case 'sessions':
        sessions = message.sessions;
        break;
      case 'rewindPoints':
        rewindPoints = message.points;
        break;
      case 'insertText':
        draft = draft ? `${draft.replace(/\s*$/, '')}\n${message.text}` : message.text;
        focusSignal += 1;
        break;
      case 'focusInput':
        focusSignal += 1;
        break;
      case 'commandResult':
        commandResult = message.result;
        break;
      case 'theme':
        theme = message.theme;
        break;
      default: {
        const exhaustive: never = message;
        void exhaustive;
      }
    }
    revision += 1;
  }

  function toggleTheme(): void {
    const next = theme === 'dark' ? 'light' : 'dark';
    theme = next;
    send({ type: 'setTheme', theme: next });
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (pendingDelete) {
        pendingDelete = null;
        return;
      }
      if (panel !== 'none') {
        closePanel();
        return;
      }
      if (busy) send({ type: 'cancel' });
    }
  }

  function deleteSession(sessionId: string): void {
    send({ type: 'deleteSession', sessionId });
    pendingDelete = null;
  }

  function startRename(session: SessionSummary): void {
    pendingDelete = null;
    renamingId = session.sessionId;
    renameDraft = session.title === '(untitled)' ? '' : session.title;
  }

  function cancelRename(): void {
    renamingId = null;
    renameDraft = '';
  }

  function commitRename(): void {
    if (!renamingId) return;
    const title = renameDraft.trim();
    if (!title) {
      cancelRename();
      return;
    }
    send({ type: 'renameSession', sessionId: renamingId, title });
    renamingId = null;
    renameDraft = '';
  }

  function loadSession(sessionId: string): void {
    if (sessionId === status.sessionId) {
      closePanel();
      return;
    }
    send({ type: 'loadSession', sessionId });
    closePanel();
  }

  function rewind(pointId: string): void {
    send({ type: 'rewind', pointId });
    closePanel();
  }

  function worktree(action: WorktreeAction): void {
    const name = worktreeName.trim();
    send({ type: 'worktree', action, name: action === 'create' && name ? name : undefined });
    if (action === 'create') worktreeName = '';
    closePanel();
  }

  function when(ts?: number): string {
    if (!ts) return '';
    const diff = Date.now() - ts;
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(ts).toLocaleDateString();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="gb-app">
  {#if commandResult}
    <CommandResult result={commandResult} onClose={() => (commandResult = null)} />
  {/if}
  <div class="gb-top">
    <Header
      {showThinking}
      {theme}
      isGitRepo={status.isGitRepo}
      onToggleTheme={toggleTheme}
      onNewSession={() => send({ type: 'newSession' })}
      onToggleHistory={() => openPanel('history')}
      onToggleRewind={() => openPanel('rewind')}
      onToggleThinking={(show) => {
        showThinking = show;
        send({ type: 'toggleThinking', show });
      }}
      onOpenUserConfig={() => send({ type: 'openUserConfig' })}
      onShowLog={() => send({ type: 'showLog' })}
      onRestart={() => send({ type: 'restartAgent' })}
      onAbout={() => openPanel('about')}
    />

    <StatusLine {status} />

    {#if panel !== 'none'}
      <div
        class="gb-backdrop"
        role="presentation"
        onclick={closePanel}
        oncontextmenu={closePanel}
      ></div>
      <div
        bind:this={popoverElement}
        class="gb-popover"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        onkeydown={handlePopoverKeydown}
      >
        {#if panel === 'about'}
          <About agentVersion={status.agentVersion} onClose={closePanel} />
        {:else if panel === 'history'}
          <div class="gb-modal-panel">
            <div class="gb-modal-header">
              <span class="gb-modal-title">Session History</span>
              <button class="gb-icon-btn" onclick={closePanel} aria-label="Close">
                <Icon name="close" size={14} />
              </button>
            </div>
            <div class="gb-modal-body">
              <div class="gb-search-box">
                <Icon name="search" size={12} />
                <input
                  bind:this={searchInput}
                  bind:value={sessionQuery}
                  class="gb-question-input"
                  placeholder="Search sessions…"
                  spellcheck="false"
                />
                {#if sessionQuery}
                  <button class="gb-icon-btn clear-btn" onclick={() => (sessionQuery = '')} aria-label="Clear search">
                    <Icon name="close" size={12} />
                  </button>
                {/if}
              </div>

              {#if sessions.length === 0}
                <div class="gb-panel-empty">No sessions yet.</div>
              {:else if visibleSessions.length === 0}
                <div class="gb-panel-empty">Nothing matches “{sessionQuery.trim()}”.</div>
              {:else}
                {#each visibleSessions as session (session.sessionId)}
                  {@const arming = pendingDelete === session.sessionId}
                  {@const current = session.sessionId === status.sessionId}
                  {@const renaming = renamingId === session.sessionId}
                  <div class="gb-history-row" class:danger-armed={arming} class:current>
                    {#if renaming}
                      <form
                        class="gb-rename-form"
                        onsubmit={(e) => {
                          e.preventDefault();
                          commitRename();
                        }}
                      >
                        <input
                          bind:this={renameInput}
                          bind:value={renameDraft}
                          class="gb-question-input rename-input"
                          placeholder="Session name"
                          spellcheck="false"
                          aria-label="Session name"
                          onkeydown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                        />
                        <button class="gb-btn-ghost-action" type="submit" title="Save name" aria-label="Save name">
                          <Icon name="check" size={12} />
                        </button>
                        <button
                          class="gb-btn-ghost-action"
                          type="button"
                          title="Cancel"
                          aria-label="Cancel rename"
                          onclick={cancelRename}
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </form>
                    {:else if arming}
                      <span class="gb-armed-text">Delete session "{session.title}"?</span>
                      <div class="gb-row-actions">
                        <button
                          class="gb-btn-ghost-action danger-act"
                          title="Delete this session for good"
                          aria-label="Confirm delete"
                          onclick={() => deleteSession(session.sessionId)}
                        >
                          <Icon name="check" size={12} />
                        </button>
                        <button
                          class="gb-btn-ghost-action"
                          title="Keep it"
                          aria-label="Cancel delete"
                          onclick={() => (pendingDelete = null)}
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </div>
                    {:else}
                      <button class="gb-row-button" onclick={() => loadSession(session.sessionId)}>
                        <span class="gb-session-title">{session.title}</span>
                        {#if current}<span class="gb-current-tag">current</span>{/if}
                        <span class="gb-session-time">{when(session.updatedAt)}</span>
                      </button>
                      <div class="gb-row-actions">
                        <button
                          class="gb-btn-ghost-action"
                          title="Rename session"
                          aria-label="Rename session"
                          onclick={() => startRename(session)}
                        >
                          <Icon name="edit" size={12} />
                        </button>
                        {#if !current}
                          <button
                            class="gb-btn-ghost-action"
                            title="Delete this session"
                            aria-label="Delete session"
                            onclick={() => (pendingDelete = session.sessionId)}
                          >
                            <Icon name="trash" size={12} />
                          </button>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {:else if panel === 'rewind'}
          <div class="gb-modal-panel">
            <div class="gb-modal-header">
              <span class="gb-modal-title">Rewind &amp; Worktree</span>
              <button class="gb-icon-btn" onclick={closePanel} aria-label="Close">
                <Icon name="close" size={14} />
              </button>
            </div>
            <div class="gb-modal-body">
              <span class="gb-card-kicker">CHECKPOINTS</span>
              {#if rewindPoints.length === 0}
                <div class="gb-panel-empty">No checkpoints in this session yet.</div>
              {:else}
                {#each rewindPoints as point (point.id)}
                  <button class="gb-history-row gb-row-button" onclick={() => rewind(point.id)}>
                    <span class="gb-session-title">{point.label}</span>
                    <span class="gb-session-time">{when(point.ts)}</span>
                  </button>
                {/each}
                <div class="gb-panel-note">
                  Rewinding drops everything after that prompt — from the transcript and from the
                  agent's own history.
                </div>
              {/if}

              <span class="gb-card-kicker worktree-kicker">WORKTREE</span>
              <input
                bind:value={worktreeName}
                class="gb-question-input"
                placeholder="worktree name (optional)"
                disabled={noGit}
                onkeydown={(e) => {
                  if (e.key === 'Enter' && !noGit) worktree('create');
                }}
              />
              <div class="gb-action-group worktree-actions">
                <button
                  class="gb-btn-primary"
                  onclick={() => worktree('create')}
                  disabled={noGit}
                  title="Copy this repo into a fresh sandbox"
                >
                  Create
                </button>
                <button
                  class="gb-btn-secondary"
                  onclick={() => worktree('resume')}
                  disabled={noGit}
                  title="Create a sandbox and continue this chat inside it"
                >
                  Move session
                </button>
                <button class="gb-btn-secondary" onclick={() => worktree('list')} disabled={noGit}>Open…</button>
                <button
                  class="gb-btn-secondary"
                  onclick={() => worktree('apply')}
                  disabled={noGit}
                  title="Bring a sandbox's changes back here"
                >
                  Apply…
                </button>
                <button class="gb-btn-ghost-danger" onclick={() => worktree('remove')} disabled={noGit}>
                  Remove…
                </button>
              </div>
              {#if noGit}
                <div class="gb-panel-note">Worktrees need this folder to be a git repository.</div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="gb-chat">
    <div class="gb-chat-stream">
      <Transcript
        {blocks}
        {showThinking}
        {autoExpandThinking}
        cwd={status.cwd}
        {revision}
        agentState={status.agentState}
        setupHint={status.setupHint}
        loadingHistory={status.loadingHistory}
        onApprove={(requestId, decision: ApprovalDecision) =>
          send({ type: 'approve', requestId, decision })}
        onPlanDecision={(requestId, approve, feedback) =>
          send({ type: 'planDecision', requestId, approve, feedback })}
        onAnswerQuestion={(requestId, response: QuestionResponse) =>
          send({ type: 'answerQuestion', requestId, response })}
        onOpenPath={(path, line) => send({ type: 'openPath', path, line })}
        onOpenDiff={(blockId) => send({ type: 'openDiff', blockId })}
        onShowLog={() => send({ type: 'showLog' })}
      />
    </div>
    {#if status.planEntries?.length}
      <PlanDock entries={status.planEntries} />
    {/if}
  </div>

  <Composer
    bind:text={draft}
    {status}
    commands={status.availableCommands}
    queuedMessages={status.queuedMessages ?? []}
    {focusSignal}
    onCancel={() => send({ type: 'cancel' })}
    onClearQueue={() => send({ type: 'clearQueue' })}
    onPushQueue={(id) => send({ type: 'pushQueue', blockId: id })}
    onSetModel={(modelId) => send({ type: 'setModel', modelId })}
    onSetEffort={(effort) => send({ type: 'setReasoningEffort', effort })}
    onSetPermissionMode={(mode: PermissionMode) => send({ type: 'setPermissionMode', mode })}
    onRestart={() => send({ type: 'restartAgent' })}
  />
</div>

<style>
  /* Icon-sized ghost action inside a list row — smaller padding than the modal button set. */
  .gb-btn-ghost-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--text-muted);
    padding: 4px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .gb-btn-ghost-action:hover {
    background-color: var(--bg-hover);
    color: var(--text);
  }

  .gb-btn-ghost-action.danger-act {
    color: var(--danger);
  }

  .gb-app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    min-height: 0;
    background-color: var(--bg);
    color: var(--text);
  }

  .gb-top {
    position: relative;
    flex: 0 0 auto;
    z-index: 30;
  }

  .gb-backdrop {
    position: fixed;
    inset: 0;
    z-index: 19;
    background-color: rgba(0, 0, 0, 0.45);
  }

  .gb-popover {
    position: absolute;
    top: 100%;
    left: 8px;
    right: 8px;
    z-index: 20;
    max-height: 65vh;
    overflow-y: auto;
    background-color: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-overlay);
  }

  .gb-modal-panel {
    display: flex;
    flex-direction: column;
  }

  .gb-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3);
    border-bottom: 1px solid var(--border);
  }

  .gb-modal-title {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }

  .gb-icon-btn {
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    cursor: pointer;
    padding: 0;
  }

  .gb-icon-btn:hover {
    background-color: var(--bg-hover);
    color: var(--text);
  }

  .gb-modal-body {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .gb-card-kicker {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .worktree-kicker {
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
  }

  .gb-search-box {
    position: relative;
    display: flex;
    align-items: center;
  }

  .gb-search-box :global(svg) {
    position: absolute;
    left: 10px;
    color: var(--text-faint);
    pointer-events: none;
  }

  .gb-search-box input.gb-question-input {
    padding-left: 28px;
    padding-right: 28px;
    margin-top: 0;
  }

  .gb-search-box .clear-btn {
    position: absolute;
    right: 4px;
  }

  /* List rows & history rows (§1 focus rule) */
  .gb-history-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background-color: transparent;
    cursor: pointer;
    user-select: none;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
    transition: background-color var(--dur-fast) var(--ease-standard);

  }

  .gb-history-row:hover {
    background-color: var(--bg-hover);
  }

  .gb-history-row:focus-visible {
    outline: none;
    background-color: var(--bg-hover);
    border-left: 2px solid var(--focus);
  }

  .gb-history-row.current {
    background-color: var(--accent-subtle);
  }

  .gb-history-row.danger-armed {
    background-color: var(--diff-del-bg);
    border-left: 2px solid var(--danger);
  }

  .gb-row-button {
    border: none;
    background: transparent;
    font-family: var(--font-ui);
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
    padding: 0;
    color: var(--text);
    /* A button centres its text by default, so a short session title floated to the middle of
       the row while a long one filled it — the list looked ragged for no visible reason. */
    text-align: left;
  }

  .gb-session-title {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
  }

  .gb-current-tag {
    color: var(--accent);
    font-size: 11px;
    font-weight: 500;
    flex-shrink: 0;
  }

  .gb-session-time {
    color: var(--text-faint);
    font-size: 11px;
    flex-shrink: 0;
  }

  .gb-row-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0;
  }

  .gb-history-row:hover .gb-row-actions,
  .gb-history-row:focus-within .gb-row-actions,
  .gb-history-row.danger-armed .gb-row-actions {
    opacity: 1;
  }




  .gb-armed-text {
    font-size: 12.5px;
    color: var(--danger);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gb-rename-form {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
  }

  .rename-input {
    margin-top: 0;
    padding: 2px 6px;
  }

  /* Inputs (§1 focus rule): border to --focus at 1px + single outline offset 0. No double ring. */
  .gb-question-input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background-color: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12.5px;
    box-sizing: border-box;
  }

  .gb-question-input:focus-visible {
    border-color: var(--focus);
    outline: 1px solid var(--focus);
    outline-offset: 0;
  }

  .gb-panel-empty,
  .gb-panel-note {
    font-size: 11.5px;
    color: var(--text-muted);
    padding: 4px 0;
  }

  .worktree-actions {
    margin-top: 4px;
  }

  .gb-action-group {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }










  /* Chat column & stream */
  .gb-chat {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .gb-chat-stream {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /*
   * The scroll-to-latest pill lives in Transcript.svelte, positioned against the scroller it
   * belongs to. App used to render a second one here off the same `jumpVisible` flag; two pills
   * for one action is worse than none, so this layer keeps only the layout.
   */

  button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
</style>
