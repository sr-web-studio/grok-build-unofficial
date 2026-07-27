<script lang="ts">
  import type {
    AgentState,
    ApprovalDecision,
    PromptImage,
    QuestionResponse,
    TranscriptBlock,
  } from '../../src/shared/protocol';
  import Approval from './Approval.svelte';
  import Markdown from './Markdown.svelte';
  import Notice from './Notice.svelte';
  import PlanProposal from './PlanProposal.svelte';
  import Question from './Question.svelte';
  import Thinking from './Thinking.svelte';
  import ToolCard from './ToolCard.svelte';
  import TurnFooter from './TurnFooter.svelte';

  interface Props {
    blocks: TranscriptBlock[];
    showThinking: boolean;
    autoExpandThinking: boolean;
    cwd?: string;
    revision: number;
    /** When `thinking`, show a live "still working" cue between sparse tool bursts. */
    agentState: AgentState;
    /** Host is replaying a long session — show a shell, no scroll thrash. */
    loadingHistory?: boolean;
    /** Bound by App so the chat-layer Latest button can sit above Plan / other overlays. */
    jumpVisible?: boolean;
    onJumpReady?: (api: { scrollToBottom: () => void }) => void;
    onApprove: (requestId: string, decision: ApprovalDecision) => void;
    onPlanDecision: (requestId: string, approve: boolean, feedback?: string) => void;
    onAnswerQuestion: (requestId: string, response: QuestionResponse) => void;
    onOpenPath: (path: string, line?: number) => void;
    onOpenDiff: (blockId: string) => void;
    onShowLog: () => void;
  }

  let {
    blocks,
    showThinking,
    autoExpandThinking,
    cwd,
    revision,
    agentState,
    loadingHistory = false,
    jumpVisible = $bindable(false),
    onJumpReady,
    onApprove,
    onPlanDecision,
    onAnswerQuestion,
    onOpenPath,
    onOpenDiff,
    onShowLog,
  }: Props = $props();

  let scroller = $state<HTMLDivElement | null>(null);
  let stuck = $state(true);
  /** Wall-clock seconds the current turn has been open (for the working line). */
  let busySeconds = $state(0);
  /** Which user message is currently pinned (scroll-aware — not only the chronologically last). */
  let stickyUserId = $state<string | null>(null);
  /** Expanded long user messages by block id. */
  let expandedUsers = $state<Record<string, boolean>>({});
  /** Sticky bar's own expand toggle when the pinned message is long. */
  let stickyExpanded = $state(false);

  /** Collapse long user text in-chat and in the sticky bar (≈3 lines / 160 chars). */
  const COLLAPSE_AT = 160;

  // Plan cards live above the composer now; skip them (and never-used queued previews) in chat.
  const visible = $derived(
    blocks.filter((b) => {
      if (b.kind === 'plan') return false;
      if (b.kind === 'thinking' && !showThinking) return false;
      if (b.kind === 'text' && b.queued) return false;
      return true;
    }),
  );

  /**
   * Group leading thought blocks with the following assistant message so the "Grok" label sits
   * above thinking (ACP still streams thought first; this is display order only).
   */
  type Row =
    | { kind: 'grok'; thoughts: Extract<TranscriptBlock, { kind: 'thinking' }>[]; text: Extract<TranscriptBlock, { kind: 'text' }> }
    | { kind: 'single'; block: TranscriptBlock };

  const rows = $derived.by((): Row[] => {
    const out: Row[] = [];
    let i = 0;
    const list = visible;
    while (i < list.length) {
      const b = list[i];
      if (b.kind === 'thinking') {
        const thoughts: Extract<TranscriptBlock, { kind: 'thinking' }>[] = [];
        while (i < list.length && list[i].kind === 'thinking') {
          thoughts.push(list[i] as Extract<TranscriptBlock, { kind: 'thinking' }>);
          i += 1;
        }
        const next = list[i];
        if (next && next.kind === 'text' && next.role === 'assistant') {
          out.push({
            kind: 'grok',
            thoughts,
            text: next,
          });
          i += 1;
        } else {
          for (const t of thoughts) out.push({ kind: 'single', block: t });
        }
        continue;
      }
      out.push({ kind: 'single', block: b });
      i += 1;
    }
    return out;
  });

  /** Pinned user bubble — updates as you scroll past earlier turns (Claude Code-style). */
  const stickyUserBlock = $derived.by(() => {
    if (!stickyUserId) return undefined;
    const b = visible.find((x) => x.kind === 'text' && x.role === 'user' && x.id === stickyUserId);
    return b?.kind === 'text' ? b : undefined;
  });

  function onScroll() {
    if (!scroller) return;
    const slack = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    stuck = slack < 48;
    jumpVisible = !stuck && visible.length > 0;

    // Among every user row, pick the last one that has fully scrolled above the top edge.
    // Scrolling further up promotes earlier messages into the sticky bar.
    const sRect = scroller.getBoundingClientRect();
    const nodes = scroller.querySelectorAll<HTMLElement>('[data-user-id]');
    let pinned: string | null = null;
    for (const el of nodes) {
      const id = el.getAttribute('data-user-id');
      if (!id) continue;
      const eRect = el.getBoundingClientRect();
      if (eRect.bottom < sRect.top + 4) pinned = id;
    }
    if (pinned !== stickyUserId) {
      stickyUserId = pinned;
      stickyExpanded = false;
    }
  }

  function scrollToBottom() {
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    stuck = true;
    stickyUserId = null;
    jumpVisible = false;
  }

  $effect(() => {
    onJumpReady?.({ scrollToBottom });
  });

  function scrollToStickyUser() {
    if (!scroller || !stickyUserId) return;
    const el = scroller.querySelector(
      `[data-user-id="${CSS.escape(stickyUserId)}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  $effect(() => {
    revision;
    // During history load the host mutes per-block posts and flushes once — still, never
    // auto-scroll while starting/loading or the view thrashingly jumps for 15s.
    if (
      stuck &&
      scroller &&
      agentState !== 'starting' &&
      !statusLoading
    ) {
      scroller.scrollTop = scroller.scrollHeight;
    }
    queueMicrotask(() => onScroll());
  });

  function isLong(text: string): boolean {
    return text.length > COLLAPSE_AT || text.split('\n').length > 3;
  }

  function previewText(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat.length <= COLLAPSE_AT) return text;
    return `${flat.slice(0, COLLAPSE_AT - 1)}…`;
  }

  function toggleExpand(id: string) {
    expandedUsers = { ...expandedUsers, [id]: !expandedUsers[id] };
  }

  const busy = $derived(agentState === 'thinking');
  const statusLoading = $derived(Boolean(loadingHistory) || agentState === 'starting');

  /** What the sparse gap is most likely doing, based on the last open block. */
  const workingHint = $derived.by(() => {
    if (!busy) return '';
    const last = [...blocks].reverse().find((b) => {
      if (b.kind === 'thinking' && b.streaming) return true;
      if (b.kind === 'text' && b.role === 'assistant' && b.streaming) return true;
      if (b.kind === 'tool' && (b.status === 'pending' || b.status === 'in_progress' || b.waiting))
        return true;
      return false;
    });
    if (last?.kind === 'thinking' && last.streaming) return 'Thinking';
    if (last?.kind === 'text' && last.streaming) return 'Writing';
    if (last?.kind === 'tool') {
      if (last.waiting) return 'Waiting for approval';
      return last.label ? `Running ${last.label}` : 'Running a tool';
    }
    // Quiet stretch between model steps — the pause the user noticed.
    return 'Working';
  });

  $effect(() => {
    if (!busy) {
      busySeconds = 0;
      return;
    }
    busySeconds = 0;
    const started = Date.now();
    const id = setInterval(() => {
      busySeconds = Math.floor((Date.now() - started) / 1000);
    }, 1000);
    return () => clearInterval(id);
  });

  function thumb(img: PromptImage): string {
    return `data:${img.mimeType};base64,${img.data}`;
  }

  function formatBusy(s: number): string {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r.toString().padStart(2, '0')}s`;
  }
</script>

<div class="wrap">
  {#if statusLoading}
    <div class="loading-shell" aria-busy="true" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
      <div class="loading-copy">
        <strong>Loading session…</strong>
        <span>Rebuilding the transcript — this can take a few seconds for long chats.</span>
      </div>
    </div>
  {/if}

  <!-- Overlay (absolute): must not take flex space or the scroller jumps when it appears. -->
  {#if stickyUserBlock && !statusLoading}
    <div class="sticky-user" class:was-queued={stickyUserBlock.wasQueued}>
      <button class="sticky-main" type="button" title="Jump to this message" onclick={scrollToStickyUser}>
        <span class="role gb-kicker">You</span>
        {#if stickyUserBlock.wasQueued}
          <span class="queue-pill">queued</span>
        {/if}
        <span class="sticky-text">
          {#if isLong(stickyUserBlock.text) && !stickyExpanded}
            {previewText(stickyUserBlock.text)}
          {:else}
            {stickyUserBlock.text}
          {/if}
        </span>
      </button>
      {#if isLong(stickyUserBlock.text)}
        <button
          class="sticky-expand"
          type="button"
          onclick={() => (stickyExpanded = !stickyExpanded)}
        >
          {stickyExpanded ? 'Less' : 'More'}
        </button>
      {/if}
    </div>
  {/if}

  <div class="scroller" class:dimmed={statusLoading} bind:this={scroller} onscroll={onScroll}>
    {#if visible.length === 0 && !statusLoading}
      <div class="empty">
        <p>Ask Grok to do something in this workspace.</p>
        <p class="dim">
          Writes and commands wait for your approval. <kbd>Enter</kbd> sends,
          <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line, paste a screenshot, <kbd>Esc</kbd> stops the turn.
        </p>
      </div>
    {/if}

    {#each rows as row, i (row.kind === 'grok' ? row.text.id : row.block.id)}
      {@const prev = rows[i - 1]}
      {@const block = row.kind === 'single' ? row.block : row.text}
      {@const stacked =
        row.kind === 'single' &&
        block.kind === 'tool' &&
        prev?.kind === 'single' &&
        prev.block.kind === 'tool'}
      <div
        class="row"
        class:tucked={stacked}
        class:msg-user={row.kind === 'single' && block.kind === 'text' && block.role === 'user'}
        class:msg-assistant={row.kind === 'grok' || (row.kind === 'single' && block.kind === 'text' && block.role === 'assistant')}
        class:after-user={
          (row.kind === 'grok' || (row.kind === 'single' && block.kind === 'text' && block.role === 'assistant')) &&
          prev?.kind === 'single' &&
          prev.block.kind === 'text' &&
          prev.block.role === 'user'
        }
        data-user-id={row.kind === 'single' && block.kind === 'text' && block.role === 'user' ? block.id : undefined}
      >
        {#if row.kind === 'grok'}
          <div class="bubble assistant" class:gb-caret={row.text.streaming}>
            <div class="role gb-kicker">Grok</div>
            {#each row.thoughts as thought (thought.id)}
              <div class="nested-think">
                <Thinking block={thought} autoExpand={autoExpandThinking} />
              </div>
            {/each}
            {#if row.text.text}
              <div class="body">
                <Markdown text={row.text.text} />
              </div>
            {/if}
          </div>
        {:else if block.kind === 'text'}
          {#if block.role === 'user'}
            {@const long = isLong(block.text)}
            {@const open = expandedUsers[block.id] ?? false}
            <div class="bubble user" class:was-queued={block.wasQueued} class:collapsed={long && !open}>
              <div class="role-row">
                <div class="role gb-kicker">You</div>
                {#if block.wasQueued}
                  <span class="queue-pill" title="This was sent from the queue">queued</span>
                {/if}
                {#if long}
                  <button
                    class="expand"
                    type="button"
                    onclick={() => toggleExpand(block.id)}
                  >
                    {open ? 'Collapse' : 'Expand'}
                  </button>
                {/if}
              </div>
              {#if block.images?.length}
                <div class="imgs">
                  {#each block.images as img (img.id)}
                    <img class="img" src={thumb(img)} alt={img.name ?? 'attachment'} title={img.path ?? img.name} />
                  {/each}
                </div>
              {/if}
              {#if block.text}
                <div class="body">{open || !long ? block.text : previewText(block.text)}</div>
              {/if}
            </div>
          {:else}
            <div class="bubble assistant" class:gb-caret={block.streaming}>
              <div class="role gb-kicker">Grok</div>
              <div class="body">
                <Markdown text={block.text} />
              </div>
            </div>
          {/if}
        {:else if block.kind === 'thinking'}
          <Thinking {block} autoExpand={autoExpandThinking} />
        {:else if block.kind === 'tool'}
          <ToolCard {block} {cwd} {onOpenPath} {onOpenDiff} {stacked} />
        {:else if block.kind === 'proposedPlan'}
          <PlanProposal {block} onDecide={onPlanDecision} />
        {:else if block.kind === 'question'}
          <Question {block} onAnswer={onAnswerQuestion} />
        {:else if block.kind === 'approval'}
          <Approval {block} onDecide={onApprove} />
        {:else if block.kind === 'notice'}
          <Notice {block} {onShowLog} />
        {:else if block.kind === 'turn'}
          <TurnFooter {block} />
        {/if}
      </div>
    {/each}

    <!--
      Quiet gaps between thought → tools → more tools are normal (model is still on the wire).
      This row keeps the turn feeling alive so a 5s pause does not look like a hang.
    -->
    {#if busy}
      <div class="working" aria-live="polite" aria-busy="true">
        <span class="pulse-ring" aria-hidden="true"></span>
        <span class="working-copy">
          <span class="working-title">{workingHint}</span>
          <span class="working-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          {#if busySeconds > 0}
            <span class="working-time" title="Time on this turn">{formatBusy(busySeconds)}</span>
          {/if}
        </span>
      </div>
    {/if}
  </div>
</div>

<style>
  .wrap {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .loading-shell {
    position: absolute;
    inset: 0;
    z-index: 8;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    background: color-mix(
      in srgb,
      var(--vscode-sideBar-background, var(--vscode-editor-background)) 92%,
      transparent
    );
    text-align: center;
  }

  .loading-spinner {
    width: 28px;
    height: 28px;
    border: 2.5px solid color-mix(in srgb, var(--gb-accent) 30%, transparent);
    border-top-color: var(--gb-accent);
    border-radius: 50%;
    animation: load-spin 0.7s linear infinite;
  }

  @keyframes load-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 22em;
    font-size: 0.92em;
    color: var(--gb-dim);
  }

  .loading-copy strong {
    color: var(--vscode-foreground);
    font-size: 1.05em;
  }

  .scroller {
    flex: 1 1 auto;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 10px 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .scroller.dimmed {
    opacity: 0.25;
    pointer-events: none;
    overflow: hidden;
  }

  .working {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 2px;
    padding: 8px 10px;
    border: 1px dashed color-mix(in srgb, var(--gb-accent) 45%, var(--gb-rule));
    background: color-mix(in srgb, var(--gb-accent) 8%, transparent);
    color: var(--gb-dim);
    font-size: 0.9em;
  }

  .pulse-ring {
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--gb-accent);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--gb-accent) 55%, transparent);
    animation: live-pulse 1.6s ease-out infinite;
  }

  @keyframes live-pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--gb-accent) 50%, transparent);
      opacity: 1;
    }
    70% {
      box-shadow: 0 0 0 8px transparent;
      opacity: 0.85;
    }
    100% {
      box-shadow: 0 0 0 0 transparent;
      opacity: 1;
    }
  }

  .working-copy {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .working-title {
    color: var(--vscode-foreground);
    font-weight: 700;
    font-size: 0.95em;
  }

  .working-dots {
    display: inline-flex;
    gap: 3px;
    align-items: center;
  }

  .working-dots i {
    display: block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--gb-accent);
    opacity: 0.35;
    animation: dot-bounce 1.2s ease-in-out infinite;
  }

  .working-dots i:nth-child(2) {
    animation-delay: 0.15s;
  }

  .working-dots i:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes dot-bounce {
    0%,
    80%,
    100% {
      opacity: 0.3;
      transform: translateY(0);
    }
    40% {
      opacity: 1;
      transform: translateY(-2px);
    }
  }

  .working-time {
    font-family: var(--gb-mono);
    font-size: 0.85em;
    color: var(--gb-dim);
  }

  /*
   * Absolute overlay on the scroller — never flex-sized. Inserting a flex sibling was
   * shrinking the scrollport and causing a visible jump when sticky engaged.
   */
  .sticky-user {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 5;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--gb-rule);
    background: color-mix(
      in srgb,
      var(--gb-accent) 14%,
      var(--vscode-sideBar-background, var(--vscode-editor-background))
    );
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    pointer-events: auto;
  }

  .sticky-user.was-queued {
    border-bottom-color: color-mix(in srgb, var(--gb-warn) 50%, var(--gb-rule));
  }

  .sticky-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .sticky-text {
    flex: 1 1 8em;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 0.92em;
    max-height: 4.5em;
    overflow: hidden;
  }

  .sticky-expand,
  .expand {
    flex: 0 0 auto;
    margin-left: auto;
    padding: 1px 7px;
    border: 1px solid var(--gb-rule);
    background: color-mix(in srgb, var(--vscode-editor-background) 70%, transparent);
    color: var(--gb-accent);
    font: inherit;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
  }

  .sticky-expand:hover,
  .expand:hover {
    border-color: var(--gb-accent);
  }

  .user.collapsed .body {
    max-height: 4.6em;
    overflow: hidden;
  }

  .role-row .expand {
    margin-left: auto;
  }

  .row {
    position: relative;
    z-index: 0;
    min-width: 0;
  }

  .row.tucked {
    margin-top: -12px;
  }

  .row.msg-user {
    margin-top: 4px;
  }

  /* Clearer turn separation: You → Grok and Grok → You. */
  .row.after-user {
    margin-top: 14px;
  }

  .row.msg-assistant + .row.msg-user {
    margin-top: 14px;
  }

  .nested-think {
    margin: 2px 0 8px;
  }

  .bubble {
    min-width: 0;
  }

  .role {
    margin-bottom: 4px;
    letter-spacing: 0.04em;
  }

  .role-row {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 4px;
  }

  .role-row .role {
    margin-bottom: 0;
  }

  .user .role {
    color: var(--gb-accent);
  }

  .assistant .role {
    color: var(--gb-dim);
  }

  .user {
    padding: 8px 10px;
    border-left: 3px solid var(--gb-accent);
    background: color-mix(
      in srgb,
      var(--gb-accent) 10%,
      var(--vscode-textBlockQuote-background, rgba(128, 128, 128, 0.12))
    );
    border-radius: var(--gb-radius);
  }

  .user .body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--vscode-foreground);
  }

  /* After force-push / auto-flush — in chat, with a permanent badge. */
  .user.was-queued {
    border-left-color: var(--gb-warn);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--gb-warn) 28%, transparent);
  }

  .queue-pill {
    flex: 0 0 auto;
    padding: 1px 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--gb-warn) 85%, transparent);
    color: var(--vscode-editor-background);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .imgs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }

  .img {
    max-width: 100%;
    max-height: 160px;
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    object-fit: contain;
    background: var(--gb-surface-sunken);
  }

  .assistant {
    position: relative;
    z-index: 0;
    padding: 2px 0 2px 2px;
  }

  .empty {
    padding: 18px 4px;
    color: var(--vscode-foreground);
  }

  .empty p {
    margin: 0 0 8px;
  }

  .empty .dim {
    color: var(--gb-dim);
    font-size: 0.9em;
  }

  kbd {
    font-family: var(--gb-mono);
    font-size: 0.9em;
    padding: 0 4px;
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
  }
</style>
