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
  /** Which user message is currently pinned (scroll-aware — not only the chronologically last). */
  let stickyUserId = $state<string | null>(null);
  /** Expanded long user messages by block id. */
  let expandedUsers = $state<Record<string, boolean>>({});


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
    if (pinned !== stickyUserId) stickyUserId = pinned;
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

  const statusLoading = $derived(Boolean(loadingHistory) || agentState === 'starting');

  function thumb(img: PromptImage): string {
    // Prefer tiny preview (always kept), then full data, then host webview URI for saved path.
    if (img.preview) return `data:image/jpeg;base64,${img.preview}`;
    if (img.data) return `data:${img.mimeType || 'image/jpeg'};base64,${img.data}`;
    if (img.webviewUri) return img.webviewUri;
    return '';
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
        {#if stickyUserBlock.images?.length}
          {@const src = thumb(stickyUserBlock.images[0])}
          {#if src}
            <img class="sticky-thumb" src={src} alt="" />
          {/if}
        {/if}
        <span class="sticky-text">
          {stickyUserBlock.text || (stickyUserBlock.images?.length ? 'Image' : '')}
        </span>
      </button>
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
                <Markdown text={row.text.text} streaming={row.text.streaming} />
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
                    {@const src = thumb(img)}
                    {#if src}
                      <img class="img" src={src} alt={img.name ?? 'attachment'} title={img.path ?? img.name} />
                    {:else}
                      <span class="img-fallback" title={img.path ?? img.name}>{img.name ?? 'image'}</span>
                    {/if}
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
                <Markdown text={block.text} streaming={block.streaming} />
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
    /* Room for the Latest chip only — Working lives in App chrome under the chat. */
    padding: 10px 10px 48px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .scroller.dimmed {
    opacity: 0.25;
    pointer-events: none;
    overflow: hidden;
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
    align-items: center;
    flex-wrap: nowrap;
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

  .sticky-thumb {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    object-fit: cover;
    border: 1px solid var(--gb-rule);
    background: var(--gb-surface-sunken);
  }

  .sticky-text {
    flex: 1 1 8em;
    min-width: 0;
    /* One line in the pin bar — multi-line pre-wrap made the strip look tall/"stretched". */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.92em;
  }

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
    align-items: flex-start; /* default stretch was warping <img> on the cross axis */
    gap: 6px;
    margin-bottom: 6px;
  }

  .img {
    /* Never force both axes — flex stretch + only max-* made wide screenshots look tall. */
    display: block;
    flex: 0 0 auto;
    width: auto;
    height: auto;
    max-width: min(100%, 280px);
    max-height: 140px;
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    object-fit: contain;
    object-position: left top;
    background: var(--gb-surface-sunken);
  }

  .img-fallback {
    display: inline-flex;
    align-items: center;
    padding: 4px 8px;
    border: 1px dashed var(--gb-rule);
    font-size: 11px;
    color: var(--gb-dim);
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
