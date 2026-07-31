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

<div class="status">
  <div class="status-left">
    <span class="state-dot {status.agentState}"></span>
    <span class="label-slot">
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

    {#if folder}
      <span class="sep sep-folder">·</span>
      <span class="folder" title={status.cwd}>{folder}</span>
    {/if}
  </div>

  <div class="status-right">
    {#if contextPct !== undefined}
      <button
        type="button"
        class="ctx-badge"
        class:warn={contextTone === 'warn'}
        class:hot={contextTone === 'hot'}
        title="Context {contextPct}% — {status.lastTurnTotalTokens} / {status.contextTokens} tokens. Click for details."
        onclick={onCtxClick}
      >
        <span>ctx {contextPct}%</span>
        <div class="ctx-meter">
          <div class="ctx-fill" style="width: {contextPct}%;"></div>
        </div>
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
      <span class="sep sep-tokens">·</span>
      <span class="tokens-val" title="Session tokens (in + out); {compact(status.totals.cachedReadTokens)} cached reads">
        {compact(totalTokens)} tok
      </span>
    {/if}

    {#if status.totals.costUsd > 0}
      <span class="sep sep-cost">·</span>
      <span class="cost-val" title="{status.totals.turns} turns">${status.totals.costUsd.toFixed(3)}</span>
    {/if}

    {#if status.agentVersion}
      <span class="sep sep-ver">·</span>
      <span class="ver-val" title="Grok Build CLI">{status.agentVersion}</span>
    {/if}
  </div>
</div>

{#if status.error && !status.setupHint}
  <div class="error" title={status.error}>{status.error}</div>
{:else if status.setupHint}
  <div class="error soft" title={status.setupHint.detail}>{status.setupHint.title} — see setup below</div>
{/if}

<style>
  .status {
    height: 24px;
    background-color: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: 0 var(--space-3);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11.5px;
    line-height: 1.3;
    color: var(--text-muted);
    font-family: var(--font-ui);
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    flex-wrap: nowrap;
  }

  .status-left,
  .status-right {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    white-space: nowrap;
    min-width: 0;
  }

  .status-left {
    flex-shrink: 1;
  }

  .status-right {
    flex-shrink: 0;
  }

  .state-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .state-dot.idle {
    background-color: var(--success);
  }

  .state-dot.thinking {
    background-color: var(--accent);
    animation: pulse 1.5s infinite ease-in-out;
  }

  .state-dot.awaitingApproval {
    background-color: var(--warning);
  }

  .state-dot.starting {
    background-color: var(--accent);
  }

  .state-dot.stopped {
    background-color: var(--text-faint);
  }

  @keyframes pulse {
    0% { opacity: 0.4; transform: scale(0.9); }
    50% { opacity: 1; transform: scale(1.1); }
    100% { opacity: 0.4; transform: scale(0.9); }
  }

  .label-slot {
    font-weight: 500;
    color: var(--text-muted);
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
  }

  .ellipsis {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    width: 1.1em;
    margin-left: 1px;
    flex-shrink: 0;
  }

  .ellipsis i {
    display: block;
    width: 2px;
    height: 2px;
    border-radius: 50%;
    background-color: currentColor;
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
    0%, 80%, 100% { opacity: 0.25; }
    40% { opacity: 1; }
  }

  .sep {
    color: var(--text-faint);
    flex-shrink: 0;
  }

  .session {
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 110px;
    min-width: 0;
    flex-shrink: 1;
  }

  .session.dim {
    color: var(--text-faint);
    font-style: italic;
  }

  .folder {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 90px;
    min-width: 0;
    flex-shrink: 1;
  }

  .ctx-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: 11.5px;
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
  }

  .ctx-badge:hover {
    color: var(--text);
  }

  .ctx-meter {
    width: 24px;
    height: 3px;
    background-color: var(--border-strong);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .ctx-fill {
    height: 100%;
    background-color: var(--accent);
  }

  .ctx-badge.warn .ctx-fill {
    background-color: var(--warning);
  }

  .ctx-badge.hot .ctx-fill {
    background-color: var(--danger);
  }

  .compact-btn {
    background: transparent;
    border: none;
    font-family: var(--font-ui);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    padding: 0 4px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }

  .compact-btn.warn {
    color: var(--warning);
  }

  .compact-btn.hot {
    color: var(--danger);
  }

  .compact-btn:hover:not(:disabled) {
    background-color: var(--bg-hover);
  }

  .compact-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .tokens-val,
  .cost-val,
  .ver-val {
    white-space: nowrap;
    flex-shrink: 0;
  }

  @container (max-width: 650px) {
    .ver-val, .sep-ver { display: none !important; }
  }

  @container (max-width: 520px) {
    .cost-val, .sep-cost { display: none !important; }
  }

  @container (max-width: 380px) {
    .tokens-val, .sep-tokens { display: none !important; }
  }

  @container (max-width: 320px) {
    .folder, .sep-folder { display: none !important; }
  }

  @media (max-width: 650px) {
    .ver-val, .sep-ver { display: none; }
  }

  @media (max-width: 520px) {
    .cost-val, .sep-cost { display: none; }
  }

  @media (max-width: 380px) {
    .tokens-val, .sep-tokens { display: none; }
  }

  @media (max-width: 320px) {
    .folder, .sep-folder { display: none; }
  }

  .error {
    flex: 0 0 auto;
    padding: 4px var(--space-3);
    border-bottom: 1px solid var(--border);
    background-color: var(--bg-inset);
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--danger);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error.soft {
    color: var(--text-muted);
  }
</style>
