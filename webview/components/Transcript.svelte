<script lang="ts">
  import type {
    AgentState,
    ApprovalDecision,
    PromptImage,
    QuestionResponse,
    SetupHint,
    TranscriptBlock,
  } from '../../src/shared/protocol';
  import Approval from './Approval.svelte';
  import Icon from './Icon.svelte';
  import Markdown from './Markdown.svelte';
  import Notice from './Notice.svelte';
  import PlanProposal from './PlanProposal.svelte';
  import Question from './Question.svelte';
  import SetupCard from './SetupCard.svelte';
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
    /** Missing CLI / auth — show recovery instead of the empty prompt. */
    setupHint?: SetupHint;
    /** Host is replaying a long session — show a shell, no scroll thrash. */
    loadingHistory?: boolean;
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
    setupHint = undefined,
    loadingHistory = false,
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
  /** Message-level copy confirmation timers by block id. */
  let copiedIds = $state<Record<string, boolean>>({});

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
   * Group leading thought blocks with the following assistant message so thinking sits
   * above the prose (ACP still streams thought first; this is display order only).
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

  /** Pill visibility. This component owns the pill; it is positioned against the scroller. */
  let showScrollPill = $state(false);

  function onScroll() {
    if (!scroller) return;
    const slack = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    stuck = slack < 48;
    showScrollPill = !stuck && visible.length > 0;

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
    showScrollPill = false;
  }

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

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    }
  }

  async function copyMessage(id: string, text: string, event: MouseEvent) {
    // Nested code-block copy must not fire the message-level copy.
    const t = event.target;
    if (t instanceof Element && t.closest('[data-md-copy]')) return;
    event.stopPropagation();
    if (!text) return;
    await copyText(text);
    copiedIds = { ...copiedIds, [id]: true };
    window.setTimeout(() => {
      copiedIds = { ...copiedIds, [id]: false };
    }, 1200);
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
        {#if stickyUserBlock.wasQueued}
          <span class="queue-label">queued</span>
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
    {#if setupHint && !statusLoading}
      <SetupCard hint={setupHint} />
    {:else if visible.length === 0 && !statusLoading}
      <div class="empty">
        <div class="empty-brand">
          <span class="wordmark">◆ GROK BUILD</span>
          <span class="unofficial">Unofficial</span>
        </div>
        <p class="empty-line">Ask anything about this workspace.</p>
        <p class="empty-hint">
          <kbd>Enter</kbd> sends · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · <kbd>Esc</kbd> stops
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
        class:is-tool={row.kind === 'single' && block.kind === 'tool'}
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
          <div class="assistant" class:streaming={row.text.streaming}>
            {#each row.thoughts as thought (thought.id)}
              <div class="nested-think">
                <Thinking block={thought} autoExpand={autoExpandThinking} />
              </div>
            {/each}
            {#if row.text.text}
              <div class="prose" class:caret={row.text.streaming}>
                <Markdown text={row.text.text} streaming={row.text.streaming} />
              </div>
              <div class="msg-actions">
                <button
                  type="button"
                  class="msg-copy-btn"
                  class:copied={copiedIds[row.text.id]}
                  title="Copy markdown"
                  aria-label={copiedIds[row.text.id] ? 'Copied' : 'Copy markdown'}
                  onclick={(e) => copyMessage(row.text.id, row.text.text, e)}
                >
                  <Icon name={copiedIds[row.text.id] ? 'check' : 'copy'} size={12} />
                  <span aria-live="polite">{copiedIds[row.text.id] ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            {/if}
          </div>
        {:else if block.kind === 'text'}
          {#if block.role === 'user'}
            {@const long = isLong(block.text)}
            {@const open = expandedUsers[block.id] ?? false}
            <div class="user" class:was-queued={block.wasQueued} class:collapsed={long && !open}>
              {#if block.wasQueued}
                <span class="queue-label" title="This was sent from the queue">queued</span>
              {/if}
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
                <div class="user-text">{open || !long ? block.text : previewText(block.text)}</div>
              {/if}
              {#if long}
                <button
                  class="show-more"
                  type="button"
                  onclick={() => toggleExpand(block.id)}
                >
                  {open ? 'show less' : 'show more'}
                </button>
              {/if}
              <div class="msg-actions">
                <button
                  type="button"
                  class="msg-copy-btn"
                  class:copied={copiedIds[block.id]}
                  title="Copy message"
                  aria-label={copiedIds[block.id] ? 'Copied' : 'Copy message'}
                  onclick={(e) => copyMessage(block.id, block.text, e)}
                >
                  <Icon name={copiedIds[block.id] ? 'check' : 'copy'} size={12} />
                  <span aria-live="polite">{copiedIds[block.id] ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          {:else}
            <div class="assistant" class:streaming={block.streaming}>
              <div class="prose" class:caret={block.streaming}>
                <Markdown text={block.text} streaming={block.streaming} />
              </div>
              <div class="msg-actions">
                <button
                  type="button"
                  class="msg-copy-btn"
                  class:copied={copiedIds[block.id]}
                  title="Copy markdown"
                  aria-label={copiedIds[block.id] ? 'Copied' : 'Copy markdown'}
                  onclick={(e) => copyMessage(block.id, block.text, e)}
                >
                  <Icon name={copiedIds[block.id] ? 'check' : 'copy'} size={12} />
                  <span aria-live="polite">{copiedIds[block.id] ? 'Copied' : 'Copy'}</span>
                </button>
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
          <Approval {block} {cwd} {onOpenPath} onDecide={onApprove} />
        {:else if block.kind === 'notice'}
          <Notice {block} {onShowLog} />
        {:else if block.kind === 'turn'}
          <TurnFooter {block} />
        {/if}
      </div>
    {/each}

    {#if showScrollPill}
      <button
        type="button"
        class="scroll-pill"
        title="Jump to latest"
        aria-label="Jump to latest"
        onclick={scrollToBottom}
      >
        <Icon name="arrowDown" size={12} />
        <span>Latest</span>
      </button>
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
    gap: var(--space-3);
    padding: var(--space-5);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    text-align: center;
  }

  .loading-spinner {
    width: 28px;
    height: 28px;
    border: 2.5px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-top-color: var(--accent);
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
    gap: var(--space-1);
    max-width: 22em;
    font-size: 0.92em;
    color: var(--text-muted);
  }

  .loading-copy strong {
    color: var(--text);
    font-size: 1.05em;
  }

  /*
   * Rhythm is a margin on the child, never a flex gap. A gap applies to every sibling pair and
   * cannot be overridden for one pair — that is what made a run of tool rows look uneven.
   */
  .scroller {
    flex: 1 1 auto;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: 0;
    position: relative;
    background-color: var(--bg);
  }

  .scroller.dimmed {
    opacity: 0.25;
    pointer-events: none;
    overflow: hidden;
  }

  /* Default rhythm between transcript blocks. Scroll pill is an overlay — excluded. */
  .scroller > *:not(.scroll-pill) + *:not(.scroll-pill) {
    margin-top: var(--space-3);
  }

  /*
   * Adjacent tool blocks sit at gap 0 — a tool run is one ruled list.
   * Class is set on the .row wrapper (Svelte scoping would break :has(.tool-row) across
   * component boundaries; the mock uses :has because its markup is flat).
   */
  .scroller > .row.is-tool + .row.is-tool {
    margin-top: 0;
  }

  /* Measure cap for flow content in a wide panel; never size the scroll pill. */
  .scroller > *:not(.scroll-pill):not(.empty) {
    width: 100%;
    max-width: 72ch;
    margin-left: auto;
    margin-right: auto;
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
    gap: var(--space-2);
    padding: 6px var(--space-3);
    border-bottom: 1px solid var(--border);
    background: var(--bg-raised);
    box-shadow: var(--shadow-overlay);
    pointer-events: auto;
  }

  .sticky-user.was-queued {
    border-bottom-color: color-mix(in srgb, var(--warning) 50%, var(--border));
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
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-inset);
  }

  .sticky-text {
    flex: 1 1 8em;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--text-muted);
  }

  .row {
    position: relative;
    z-index: 0;
    min-width: 0;
  }

  /* You↔Grok turn boundary — slightly larger step when assistant follows user. */
  .scroller > .row.after-user,
  .scroller > .row.msg-assistant + .row.msg-user {
    margin-top: var(--space-4);
  }

  .nested-think {
    margin: 0 0 var(--space-2);
  }

  .nested-think:last-of-type {
    margin-bottom: var(--space-3);
  }

  /* User message — raised bubble, no accent border, right-shifted. */
  .user {
    position: relative;
    background-color: var(--bg-raised);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    font-size: 13.5px;
    line-height: 1.7;
    color: var(--text);
    align-self: flex-end;
    max-width: 90%;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-left: auto;
  }

  .user.collapsed .user-text {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .user-text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .queue-label {
    font-size: 11px;
    color: var(--warning);
    font-weight: 500;
  }

  .show-more {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: 11.5px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    align-self: flex-start;
  }

  .show-more:hover {
    color: var(--text);
    background-color: var(--bg-hover);
  }

  .imgs {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-2);
  }

  .img {
    display: block;
    flex: 0 0 auto;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    object-fit: cover;
    background: var(--bg-inset);
  }

  .img-fallback {
    display: inline-flex;
    align-items: center;
    padding: 6px 10px;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    font-size: 11px;
    color: var(--text-muted);
  }

  /* Assistant — no container; prose flows on --bg. */
  .assistant {
    min-width: 0;
  }

  .prose {
    font-size: 13.5px;
    line-height: 1.7;
    color: var(--text);
  }

  /* Streaming caret: 2px × 1.1em --text at 60% opacity, 1s blink — no color. */
  .prose.caret::after {
    content: '';
    display: inline-block;
    width: 2px;
    height: 1.1em;
    background-color: var(--text);
    opacity: 0.6;
    vertical-align: middle;
    margin-left: 2px;
    animation: caret-blink 1s infinite step-start;
  }

  @keyframes caret-blink {
    50% {
      opacity: 0;
    }
  }

  .msg-actions {
    display: flex;
    align-items: center;
    margin-top: var(--space-2);
  }

  .msg-copy-btn {
    height: 20px;
    padding: 2px 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-faint);
    font-family: var(--font-ui);
    font-size: 11.5px;
    cursor: pointer;
    transition:
      color var(--dur-fast) var(--ease-standard),
      background-color var(--dur-fast) var(--ease-standard);
  }

  .msg-copy-btn:hover {
    color: var(--text);
    background-color: var(--bg-hover);
  }

  .msg-copy-btn.copied {
    color: var(--success);
  }

  /* First-run: logo + one centred line. Unofficial tag kept. */
  .empty {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--space-5) var(--space-3);
    min-height: 12rem;
    max-width: none;
  }

  .empty-brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin-bottom: var(--space-5);
  }

  .wordmark {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text);
  }

  .unofficial {
    font-size: 10px;
    color: var(--text-faint);
  }

  .empty-line {
    margin: 0 0 var(--space-4);
    font-size: 13.5px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .empty-hint {
    margin: 0;
    font-size: 11.5px;
    color: var(--text-faint);
    line-height: 1.5;
  }

  kbd {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-inset);
  }

  /*
   * Scroll-to-latest: overlay, content-width (~72px), 12px from scroller bottom-right.
   * Chrome stretches absolute flex children across the cross axis — pin width to content.
   */
  .scroll-pill {
    position: absolute;
    bottom: 12px;
    right: 12px;
    width: max-content;
    align-self: flex-start;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    background-color: var(--bg-raised);
    box-shadow: var(--shadow-overlay);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 11.5px;
    cursor: pointer;
  }

  .scroll-pill:hover {
    background-color: var(--bg-hover);
  }
</style>
