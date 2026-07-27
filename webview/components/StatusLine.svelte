<script lang="ts">
  import type { UiStatus } from '../../src/shared/protocol';

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

  /** Context window pressure, based on the last turn's total tokens. */
  const contextPct = $derived.by(() => {
    const window = status.contextTokens;
    const used = status.lastTurnTotalTokens;
    if (!window || !used) return undefined;
    return Math.min(100, Math.round((used / window) * 100));
  });

  const totalTokens = $derived(status.totals.inputTokens + status.totals.outputTokens);

  function compact(n: number): string {
    if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
    if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
    return String(n);
  }
</script>

<div class="status" class:busy>
  <span class="state {status.agentState}">●</span>
  <span class="label">
    {stateLabel[status.agentState]}{#if busy}<span class="ellipsis" aria-hidden="true"></span>{/if}
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
    <span title="Last turn used {status.lastTurnTotalTokens} of {status.contextTokens} context tokens">
      ctx {contextPct}%
    </span>
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

{#if status.error}
  <div class="error" title={status.error}>{status.error}</div>
{/if}

<style>
  /* Sits directly under the header, so it owns the rule that separates it from the transcript. */
  .status {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
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

  .status.busy .label {
    color: var(--gb-accent);
    font-weight: 700;
  }

  /* Animated "…" so the top bar also reads as live during quiet model pauses. */
  .ellipsis::after {
    content: '';
    animation: ellipsis-steps 1.2s steps(4, end) infinite;
  }

  @keyframes ellipsis-steps {
    0% {
      content: '';
    }
    25% {
      content: '.';
    }
    50% {
      content: '..';
    }
    75%,
    100% {
      content: '...';
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
</style>
