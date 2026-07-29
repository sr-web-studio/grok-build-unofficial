<script lang="ts">
  import type { UiStatus } from '../../src/shared/protocol';
  import { send } from '../ipc';

  interface Props {
    status: UiStatus;
  }

  let { status }: Props = $props();

  const stateLabel: Record<UiStatus['agentState'], string> = {
    stopped: 'stopped',
    starting: 'starting…',
    idle: 'ready',
    thinking: 'working',
    awaitingApproval: 'waiting for you',
  };

  const busy = $derived(status.agentState === 'thinking');

  const folder = $derived(status.cwd ? (status.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '') : '');

  /** Context pressure — live session/info preferred (host updates lastTurnTotalTokens). */
  const contextPct = $derived.by(() => {
    const window = status.contextTokens;
    const used = status.lastTurnTotalTokens;
    if (!window || used == null || used < 0) return undefined;
    return Math.min(100, Math.round((used / window) * 100));
  });

  const contextTone = $derived.by((): 'ok' | 'warn' | 'hot' | undefined => {
    if (contextPct == null) return undefined;
    if (contextPct >= 90) return 'hot';
    if (contextPct >= 70) return 'warn';
    return 'ok';
  });

  const totalTokens = $derived(status.totals.inputTokens + status.totals.outputTokens);

  function compact(n: number): string {
    if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
    if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
    return String(n);
  }

  function onCtxClick() {
    send({ type: 'slashCommand', text: '/context' });
  }

  function onCompact() {
    send({ type: 'compactContext' });
  }
</script>

<div class="status" class:busy>
  <span class="state {status.agentState}">●</span>
  <!--
    State label is a fixed-width slot. The old ''→.→..→… animation changed glyph width every
    frame and shoved session title / folder left-right for the whole turn.
  -->
  <span class="label" data-state={status.agentState}>
    <span class="label-text">{stateLabel[status.agentState]}</span>
    {#if busy}
      <span class="ellipsis" aria-hidden="true"><i></i><i></i><i></i></span>
    {/if}
  </span>

  {#if status.sessionTitle}
    <span class="sep">·</span>
    <span class="session" title={status.sessionTitle}>{status.sessionTitle}</span>
  {:else if status.sessionId}
    <span class="sep">·</span>
    <span class="session dim" title={status.sessionId}>new session</span>
  {/if}

  {#if folder}<span class="sep">·</span><span class="folder" title={status.cwd}>{folder}</span>{/if}

  <span class="spacer"></span>

  {#if contextPct !== undefined}
    <button
      type="button"
      class="ctx"
      class:ok={contextTone === 'ok'}
      class:warn={contextTone === 'warn'}
      class:hot={contextTone === 'hot'}
      title="Context {contextPct}% — {status.lastTurnTotalTokens} / {status.contextTokens} tokens. Click for details."
      onclick={onCtxClick}
    >
      ctx {contextPct}%
    </button>
    {#if contextTone === 'hot'}
      <button
        type="button"
        class="compact-btn hot"
        title="Context is nearly full — compact to free room"
        onclick={onCompact}
        disabled={busy}
      >
        Compact
      </button>
    {:else if contextTone === 'warn'}
      <button
        type="button"
        class="compact-btn warn"
        title="Compact conversation to free context"
        onclick={onCompact}
        disabled={busy}
      >
        Compact
      </button>
    {/if}
  {/if}
  {#if totalTokens > 0}
    <span title="Session tokens (in + out); {compact(status.totals.cachedReadTokens)} cached reads">
      {compact(totalTokens)} tok
    </span>
  {/if}
  {#if status.totals.costUsd > 0}
    <span title="{status.totals.turns} turns">${status.totals.costUsd.toFixed(3)}</span>
  {/if}
  {#if status.agentVersion}<span class="ver" title="Grok Build CLI">{status.agentVersion}</span>{/if}
</div>

{#if status.error && !status.setupHint}
  <!-- When setupHint is set, the Setup card owns the message — avoid a second dump here. -->
  <div class="error" title={status.error}>{status.error}</div>
{:else if status.setupHint}
  <div class="error soft" title={status.setupHint.detail}>{status.setupHint.title} — see setup below</div>
{/if}

<style>
  /* Sits directly under the header, so it owns the rule that separates it from the transcript. */
  .status {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    border-bottom: 1px solid var(--gb-rule);
    font-size: var(--gb-meta-size);
    color: var(--gb-dim);
    font-family: var(--gb-mono);
  }

  /*
   * One line, always. Without this a flex item happily shrinks below its text and wraps
   * internally — "waiting for you" became two rows in a narrow sidebar. The folder and the
   * version are the two that may be ellipsed instead; everything else keeps its full width.
   */
  .status > span {
    white-space: nowrap;
  }

  .spacer {
    flex: 1 1 auto;
  }

  .state {
    font-size: 0.9em;
  }

  .state.idle {
    color: var(--gb-ok);
  }

  .state.thinking {
    color: var(--gb-accent);
    animation: pulse 1.4s ease-in-out infinite;
  }

  .label {
    display: inline-flex;
    align-items: baseline;
    flex: 0 0 auto;
    /* Widest label is "waiting for you" — reserve so state flips do not shove the title. */
    min-width: 12.5ch;
  }

  .status.busy .label {
    color: var(--gb-accent);
    font-weight: 700;
  }

  .label-text {
    flex: 0 0 auto;
  }

  /*
   * Three fixed dots — opacity only. Never change the string width (that was the shove).
   */
  .ellipsis {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    width: 1.1em;
    margin-left: 1px;
    flex: 0 0 auto;
  }

  .ellipsis i {
    display: block;
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.25;
    animation: ellipsis-dot 1.2s ease-in-out infinite;
  }

  .ellipsis i:nth-child(2) {
    animation-delay: 0.15s;
  }

  .ellipsis i:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes ellipsis-dot {
    0%,
    80%,
    100% {
      opacity: 0.25;
    }
    40% {
      opacity: 1;
    }
  }

  .state.awaitingApproval {
    color: var(--gb-warn);
  }

  .state.starting {
    color: var(--gb-plan);
  }

  .state.stopped {
    color: var(--gb-dim);
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  /* Session title is the primary "where am I?" cue — prefer it over folder when space is tight. */
  .session {
    flex: 0 1 auto;
    min-width: 0;
    max-width: 14em;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: 1em;
  }

  .session.dim {
    color: var(--gb-dim);
    font-style: italic;
  }

  .folder,
  .ver {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 10em;
  }

  .error {
    flex: 0 0 auto;
    padding: 5px 10px;
    border-bottom: 1px solid var(--gb-danger);
    background: color-mix(in srgb, var(--gb-danger) 12%, transparent);
    font-family: var(--gb-mono);
    font-size: var(--gb-meta-size);
    color: var(--gb-danger);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error.soft {
    border-bottom-color: var(--gb-warn);
    background: color-mix(in srgb, var(--gb-warn) 12%, transparent);
    color: var(--vscode-foreground);
  }

  .ctx {
    flex: 0 0 auto;
    margin: 0;
    padding: 2px 8px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: none;
    font: inherit;
    font-family: var(--gb-mono);
    font-size: inherit;
    font-weight: 700;
    cursor: pointer;
    color: var(--gb-dim);
  }

  .ctx.ok {
    color: var(--gb-ok);
  }

  .ctx.warn {
    color: var(--gb-warn);
    border-color: color-mix(in srgb, var(--gb-warn) 45%, transparent);
    background: color-mix(in srgb, var(--gb-warn) 12%, transparent);
  }

  .ctx.hot {
    color: var(--gb-danger);
    border-color: color-mix(in srgb, var(--gb-danger) 50%, transparent);
    background: color-mix(in srgb, var(--gb-danger) 14%, transparent);
  }

  .ctx:hover {
    filter: brightness(1.08);
  }

  .compact-btn {
    flex: 0 0 auto;
    margin: 0;
    padding: 2px 9px;
    border: 1px solid var(--gb-rule);
    border-radius: 999px;
    background: none;
    font: inherit;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    cursor: pointer;
    color: var(--vscode-foreground);
  }

  .compact-btn.warn {
    border-color: var(--gb-warn);
    color: var(--gb-warn);
  }

  .compact-btn.hot {
    border-color: var(--gb-danger);
    color: var(--gb-danger);
    background: color-mix(in srgb, var(--gb-danger) 12%, transparent);
  }

  .compact-btn:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  .compact-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
