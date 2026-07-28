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
  import Composer from './components/Composer.svelte';
  import Header from './components/Header.svelte';
  import Icon from './components/Icon.svelte';
  import PlanDock from './components/PlanDock.svelte';
  import StatusLine from './components/StatusLine.svelte';
  import Transcript from './components/Transcript.svelte';
  import { loadDraft, onHostMessage, saveDraft, send } from './ipc';

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

  /** Bumped on every host message so the transcript can re-run its sticky-scroll effect. */
  let revision = $state(0);

  let sessions = $state<SessionSummary[]>([]);
  let rewindPoints = $state<RewindPoint[]>([]);
  let panel = $state<'none' | 'history' | 'rewind' | 'about'>('none');
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

  // Opening the history should put the caret in the search box — the list is a keyboard surface,
  // and the binding only lands after the popover renders, so this waits for it rather than the click.
  $effect(() => {
    if (panel === 'history' && !renamingId) searchInput?.focus();
  });

  $effect(() => {
    if (renamingId) renameInput?.focus();
  });

  let draft = $state(loadDraft());
  let focusSignal = $state(0);

  /** Latest jump lives on the .chat layer so it paints above Plan / other bottom overlays. */
  let jumpVisible = $state(false);
  let scrollTranscriptToBottom = $state<() => void>(() => undefined);

  const busy = $derived(status.agentState === 'thinking' || status.agentState === 'awaitingApproval');
  const noGit = $derived(status.isGitRepo === false);

  $effect(() => {
    saveDraft(draft);
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
        // The host sends narrow patches; it owns the shape, so a cast is honest here.
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
      default: {
        const exhaustive: never = message;
        void exhaustive;
      }
    }
    revision += 1;
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      // An armed delete is the innermost thing on screen, so Escape disarms it before it closes
      // anything — pressing Escape must never be the gesture that deletes a session.
      if (pendingDelete) {
        pendingDelete = null;
        return;
      }
      if (panel !== 'none') {
        panel = 'none';
        return;
      }
      if (busy) send({ type: 'cancel' });
    }
  }

  function toggleHistory(): void {
    panel = panel === 'history' ? 'none' : 'history';
    sessionQuery = '';
    pendingDelete = null;
    renamingId = null;
    renameDraft = '';
    if (panel === 'history') send({ type: 'listSessions' });
  }

  /** The host answers with a refreshed list, so the row disappears on its own. */
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

  function toggleRewind(): void {
    panel = panel === 'rewind' ? 'none' : 'rewind';
    if (panel === 'rewind') send({ type: 'listRewindPoints' });
  }

  function loadSession(sessionId: string): void {
    // Don't reload the session that's already open — only close the panel.
    if (sessionId === status.sessionId) {
      panel = 'none';
      return;
    }
    send({ type: 'loadSession', sessionId });
    panel = 'none';
  }

  function rewind(pointId: string): void {
    send({ type: 'rewind', pointId });
    panel = 'none';
  }

  /**
   * Only `create` takes the name box; the other actions pick their target from a native
   * QuickPick raised by the host, so the panel closes and gets out of the way.
   */
  function worktree(action: WorktreeAction): void {
    const name = worktreeName.trim();
    send({ type: 'worktree', action, name: action === 'create' && name ? name : undefined });
    if (action === 'create') worktreeName = '';
    panel = 'none';
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

<div class="app">
  <div class="top">
    <Header
      {showThinking}
      isGitRepo={status.isGitRepo}
      onNewSession={() => send({ type: 'newSession' })}
      onToggleHistory={toggleHistory}
      onToggleRewind={toggleRewind}
      onToggleThinking={(show) => {
        showThinking = show;
        send({ type: 'toggleThinking', show });
      }}
      onOpenUserConfig={() => send({ type: 'openUserConfig' })}
      onShowLog={() => send({ type: 'showLog' })}
      onRestart={() => send({ type: 'restartAgent' })}
      onAbout={() => (panel = panel === 'about' ? 'none' : 'about')}
    />

    <StatusLine {status} />

    <!--
      History, rewind and about hang below the header as a dropdown rather than sitting in the
      column. As in-flow sections they shoved the whole conversation down the moment a toolbar
      button was pressed; a chat panel should never move under you to show a menu.
    -->
    {#if panel !== 'none'}
      <div
        class="backdrop"
        role="presentation"
        onclick={() => (panel = 'none')}
        oncontextmenu={() => (panel = 'none')}
      ></div>
      <div class="popover" role="dialog" aria-modal="false">
        {#if panel === 'about'}
          <About agentVersion={status.agentVersion} onClose={() => (panel = 'none')} />
        {:else if panel === 'history'}
          <div class="panel">
            <div class="panel-head gb-kicker">
              <span>Recent sessions in this folder</span>
              <button class="x" onclick={() => (panel = 'none')} aria-label="Close">
                <Icon name="close" size={13} />
              </button>
            </div>
            <div class="search">
              <Icon name="search" size={12} />
              <input
                bind:this={searchInput}
                bind:value={sessionQuery}
                placeholder="Search sessions…"
                spellcheck="false"
              />
              {#if sessionQuery}
                <button class="x" onclick={() => (sessionQuery = '')} aria-label="Clear search">
                  <Icon name="close" size={12} />
                </button>
              {/if}
            </div>

            {#if sessions.length === 0}
              <div class="panel-empty">No sessions yet.</div>
            {:else if visibleSessions.length === 0}
              <div class="panel-empty">Nothing matches “{sessionQuery.trim()}”.</div>
            {:else}
              {#each visibleSessions as session (session.sessionId)}
                {@const arming = pendingDelete === session.sessionId}
                {@const current = session.sessionId === status.sessionId}
                {@const renaming = renamingId === session.sessionId}
                <div class="row" class:arming class:current>
                  {#if renaming}
                    <form
                      class="rename-form"
                      onsubmit={(e) => {
                        e.preventDefault();
                        commitRename();
                      }}
                    >
                      <input
                        bind:this={renameInput}
                        bind:value={renameDraft}
                        class="rename-input"
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
                      <button class="act confirm" type="submit" title="Save name" aria-label="Save name">
                        <Icon name="check" size={13} />
                      </button>
                      <button
                        class="act"
                        type="button"
                        title="Cancel"
                        aria-label="Cancel rename"
                        onclick={cancelRename}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </form>
                  {:else}
                    <button class="item" onclick={() => loadSession(session.sessionId)}>
                      <span class="item-title">
                        {session.title}
                        {#if current}<span class="current-pill gb-tag">current</span>{/if}
                      </span>
                      <span class="item-meta gb-meta">{when(session.updatedAt)}</span>
                    </button>
                    <button
                      class="act"
                      title="Rename session"
                      aria-label="Rename session"
                      onclick={() => startRename(session)}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <!--
                      Delete arms in place: the trash icon becomes a confirm/cancel pair on the same
                      row, so a misclick costs one more click rather than a saved conversation.
                      The open session cannot be deleted from history.
                    -->
                    {#if current}
                      <!-- open session stays put -->
                    {:else if arming}
                      <button
                        class="act confirm"
                        title="Delete this session for good"
                        aria-label="Confirm delete"
                        onclick={() => deleteSession(session.sessionId)}
                      >
                        <Icon name="check" size={13} />
                      </button>
                      <button
                        class="act"
                        title="Keep it"
                        aria-label="Cancel delete"
                        onclick={() => (pendingDelete = null)}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    {:else}
                      <button
                        class="act"
                        title="Delete this session"
                        aria-label="Delete session"
                        onclick={() => (pendingDelete = session.sessionId)}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    {/if}
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        {:else if panel === 'rewind'}
          <div class="panel">
            <div class="panel-head gb-kicker">
              <span>Rewind to a checkpoint</span>
              <button class="x" onclick={() => (panel = 'none')} aria-label="Close">
                <Icon name="close" size={13} />
              </button>
            </div>
            {#if rewindPoints.length === 0}
              <div class="panel-empty">No checkpoints in this session yet.</div>
            {:else}
              {#each rewindPoints as point (point.id)}
                <button class="item" onclick={() => rewind(point.id)}>
                  <span class="item-title">{point.label}</span>
                  <span class="item-meta gb-meta">{when(point.ts)}</span>
                </button>
              {/each}
              <div class="panel-note">
                Rewinding drops everything after that prompt — from the transcript and from the
                agent's own history.
              </div>
            {/if}
            <div class="panel-head worktree-head gb-kicker"><span>Worktrees</span></div>
            <div class="worktree">
              <input
                bind:value={worktreeName}
                placeholder="worktree name (optional)"
                disabled={noGit}
                onkeydown={(e) => {
                  if (e.key === 'Enter' && !noGit) worktree('create');
                }}
              />
              <button
                class="gb-btn"
                onclick={() => worktree('create')}
                disabled={noGit}
                title="Copy this repo into a fresh sandbox"
              >
                Create
              </button>
            </div>
            <div class="worktree">
              <button
                class="gb-btn"
                onclick={() => worktree('resume')}
                disabled={noGit}
                title="Create a sandbox and continue this chat inside it"
              >
                Move session
              </button>
              <button class="gb-btn" onclick={() => worktree('list')} disabled={noGit}>Open…</button>
              <button
                class="gb-btn"
                onclick={() => worktree('apply')}
                disabled={noGit}
                title="Bring a sandbox's changes back here"
              >
                Apply…
              </button>
              <button class="gb-btn danger" onclick={() => worktree('remove')} disabled={noGit}
                >Remove…</button
              >
            </div>
            {#if noGit}
              <div class="panel-note">Worktrees need this folder to be a git repository.</div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!--
    Stream (messages + Latest) and Plan are stacked, not overlaid:
    - Plan is in-flow under the transcript so it never covers chat text
    - Latest floats only inside the stream pane (above Plan, never on top of it)
  -->
  <div class="chat">
    <div class="chat-stream">
      <Transcript
        {blocks}
        {showThinking}
        {autoExpandThinking}
        cwd={status.cwd}
        {revision}
        agentState={status.agentState}
        loadingHistory={status.loadingHistory}
        bind:jumpVisible
        onJumpReady={(api) => {
          scrollTranscriptToBottom = api.scrollToBottom;
        }}
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
      {#if jumpVisible}
        <button
          class="chat-jump"
          type="button"
          title="Jump to latest"
          aria-label="Jump to latest"
          onclick={() => scrollTranscriptToBottom()}
        >
          <Icon name="arrowDown" size={14} />
          <span>Latest</span>
        </button>
      {/if}
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
  /*
   * The token layer for the whole webview.
   *
   * esbuild-svelte is configured with `css: 'injected'`, so a standalone stylesheet would never
   * be linked — the shared tokens have to live in a component, and the root is the one component
   * guaranteed to be mounted.
   *
   * The design is Modernist: zero radius, 2px section rules, uppercase 800-weight kickers, flush
   * left labels, monospace metadata. Its geometry is kept verbatim; its palette is not. A fixed
   * light-red-on-white scheme would fight every dark and high-contrast theme the sidebar can be
   * dropped into, so every colour resolves from `var(--vscode-*)` and red is reserved for its
   * conventional editor meaning — deletions, danger and errors.
   */
  :global(:root) {
    --gb-radius: 0px;
    --gb-gap: 6px;

    --gb-rule: var(--vscode-widget-border, rgba(128, 128, 128, 0.28));
    --gb-rule-strong: var(--vscode-panel-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.45)));

    --gb-surface: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    --gb-surface-sunken: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.1));
    --gb-dim: var(--vscode-descriptionForeground);

    --gb-accent: var(--vscode-textLink-foreground);
    --gb-danger: var(--vscode-errorForeground);
    --gb-warn: var(--vscode-editorWarning-foreground, var(--vscode-charts-yellow, #c9a227));
    --gb-ok: var(--vscode-charts-green, #4caf50);
    --gb-plan: var(--vscode-charts-blue, #4a9eff);
    --gb-think: var(--vscode-charts-purple, #b180d7);

    --gb-heading: var(--vscode-font-family);
    --gb-mono: var(--vscode-editor-font-family, ui-monospace, monospace);
    --gb-kicker-size: 11px;
    --gb-meta-size: 11px;

    --gb-shadow: 0 4px 14px rgba(0, 0, 0, 0.36);
  }

  /* The webview host gives us theme variables but no base styling, so set it once here. */
  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    overflow: hidden;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  /* Never a browser default ring — the design asks for a 2px offset outline everywhere. */
  :global(:focus-visible) {
    outline: 2px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }

  :global(::selection) {
    background: var(--vscode-editor-selectionBackground);
  }

  :global(::-webkit-scrollbar) {
    width: 9px;
    height: 9px;
  }

  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(::-webkit-scrollbar-thumb) {
    background: var(--vscode-scrollbarSlider-background);
  }

  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--vscode-scrollbarSlider-hoverBackground);
  }

  /* Small caps section label — the one piece of type that carries the design's voice. */
  :global(.gb-kicker) {
    font-family: var(--gb-heading);
    font-weight: 800;
    font-size: var(--gb-kicker-size);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  :global(.gb-tag) {
    font-family: var(--gb-mono);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 1px 5px;
    border-radius: var(--gb-radius);
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }

  :global(.gb-meta) {
    font-family: var(--gb-mono);
    font-size: var(--gb-meta-size);
    color: var(--gb-dim);
  }

  /* Buttons: flush-left labels, square corners, themed hover — never the browser's chrome. */
  :global(.gb-btn) {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    text-align: left;
    font: inherit;
    font-size: 0.9em;
    font-weight: 700;
    padding: 4px 10px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: var(--gb-radius);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    cursor: pointer;
  }

  :global(.gb-btn:hover:not(:disabled)) {
    background: var(--vscode-button-secondaryHoverBackground);
  }

  :global(.gb-btn.primary) {
    font-weight: 800;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  :global(.gb-btn.primary:hover:not(:disabled)) {
    background: var(--vscode-button-hoverBackground);
  }

  :global(.gb-btn.ghost) {
    background: none;
    border-color: var(--gb-rule);
  }

  :global(.gb-btn.ghost:hover:not(:disabled)) {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
  }

  :global(.gb-btn:disabled) {
    opacity: 0.45;
    cursor: default;
  }

  /* The streaming caret, shared by assistant text and any other live surface. */
  :global(.gb-caret::after) {
    content: '▍';
    color: var(--gb-accent);
    animation: gb-blink 1s step-start infinite;
  }

  /* `-global-` keeps the name unhashed, so components other than this one can use the class. */
  @keyframes -global-gb-blink {
    50% {
      opacity: 0;
    }
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    min-height: 0;
  }

  /* Column: message stream (flex) + plan strip (auto). No overlays on message text. */
  .chat {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Only this pane hosts the Latest chip — never stacked over the plan bar. */
  .chat-stream {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .chat-jump {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px;
    border: 1px solid color-mix(in srgb, var(--gb-accent) 40%, var(--gb-rule));
    border-radius: 999px;
    background: color-mix(
      in srgb,
      var(--vscode-button-background, var(--gb-accent)) 94%,
      var(--vscode-editor-background)
    );
    color: var(--vscode-button-foreground, var(--vscode-foreground));
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    box-shadow: var(--gb-shadow);
    cursor: pointer;
  }

  .chat-jump:hover {
    border-color: var(--gb-accent);
    filter: brightness(1.08);
  }

  /*
   * The header block is the anchor for every dropdown, so it owns a stacking context and sits
   * above the transcript. Without the z-index the popover would render behind the conversation.
   */
  .top {
    position: relative;
    flex: 0 0 auto;
    z-index: 30;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 19;
  }

  /*
   * Anchored under the header and inset from both edges, so it reads as a panel dropped from the
   * toolbar. It scrolls internally: a long session list must not grow past the sidebar.
   */
  .popover {
    position: absolute;
    top: 100%;
    left: 6px;
    right: 6px;
    z-index: 20;
    max-height: 65vh;
    overflow-y: auto;
    background: var(--vscode-menu-background, var(--gb-surface));
    border: 1px solid var(--vscode-menu-border, var(--gb-rule-strong));
    border-radius: var(--gb-radius);
    box-shadow: var(--gb-shadow);
  }

  .panel {
    padding: 7px 8px 8px;
  }

  .panel-head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--gb-dim);
    margin-bottom: 4px;
  }

  .panel-head span {
    flex: 1 1 auto;
  }

  .panel-empty,
  .panel-note {
    font-size: 0.85em;
    color: var(--gb-dim);
    padding: 4px 0;
  }

  .item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 4px 5px;
    border: none;
    border-radius: var(--gb-radius);
    background: none;
    color: var(--vscode-foreground);
    font: inherit;
    font-size: 0.9em;
    cursor: pointer;
  }

  .item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  /* A history entry is a row, not a button: the title opens the session, the tail renames/deletes. */
  .row {
    display: flex;
    align-items: center;
  }

  .row:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .row.current {
    background: color-mix(in srgb, var(--gb-accent) 10%, transparent);
  }

  .row .item {
    width: auto;
    flex: 1 1 auto;
    min-width: 0;
  }

  .current-pill {
    margin-left: 6px;
    vertical-align: middle;
  }

  .rename-form {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    padding: 2px 0;
  }

  .rename-input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 3px 6px;
    border: 1px solid var(--vscode-focusBorder, var(--gb-accent));
    border-radius: var(--gb-radius);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    font: inherit;
    font-size: 0.9em;
  }

  .rename-input:focus {
    outline: none;
  }

  /* Armed rows are tinted so the two icons read as a question about *this* row. */
  .row.arming {
    background: color-mix(in srgb, var(--gb-danger) 14%, transparent);
  }

  .act {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    padding: 3px 5px;
    border: none;
    border-radius: var(--gb-radius);
    background: none;
    color: var(--gb-dim);
    cursor: pointer;
    /* Present but quiet, so the list still reads as titles — full strength on hover or when armed. */
    opacity: 0.5;
  }

  .row:hover .act,
  .row.arming .act,
  .act:focus-visible {
    opacity: 1;
  }

  .act:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
    color: var(--vscode-foreground);
  }

  .act.confirm {
    color: var(--gb-danger);
  }

  /* Filter box: same input treatment as the worktree name, with the glyph inside the field. */
  .search {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 5px;
    padding: 0 5px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--gb-rule));
    border-radius: var(--gb-radius);
    color: var(--gb-dim);
  }

  .search:focus-within {
    border-color: var(--vscode-focusBorder);
  }

  .search input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 3px 0;
    border: none;
    background: none;
    color: var(--vscode-input-foreground);
    font: inherit;
    font-size: 0.9em;
  }

  .search input:focus {
    outline: none;
  }

  .item-title {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-meta {
    flex: 0 0 auto;
  }

  .worktree {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 5px;
  }

  .worktree-head {
    margin-top: 9px;
    border-top: 1px solid var(--gb-rule);
    padding-top: 7px;
  }

  .worktree input {
    flex: 1 1 8em;
    min-width: 0;
    padding: 3px 5px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--gb-rule));
    border-radius: var(--gb-radius);
    font: inherit;
    font-size: 0.9em;
  }

  .worktree input:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .panel button.x {
    border: none;
    border-radius: var(--gb-radius);
    background: none;
    color: var(--gb-dim);
    display: flex;
    align-items: center;
    padding: 2px;
    cursor: pointer;
  }

  .panel button.x:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
  }

  .danger {
    color: var(--gb-danger);
  }
</style>
