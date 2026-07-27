<script lang="ts">
  import type { TurnBlock } from '../../src/shared/protocol';

  interface Props {
    block: TurnBlock;
  }

  let { block }: Props = $props();

  const usage = $derived(block.usage);
  const cost = $derived(
    usage?.costUsdTicks !== undefined ? usage.costUsdTicks / 1e9 : undefined,
  );
  const duration = $derived(
    usage?.apiDurationMs !== undefined ? Math.round(usage.apiDurationMs / 100) / 10 : undefined,
  );

  /** Anything other than a clean end deserves a visible reason. */
  const abnormal = $derived(
    block.stopReason !== undefined && block.stopReason !== 'end_turn' ? block.stopReason : undefined,
  );

  function tokens(n?: number): string | undefined {
    if (n === undefined) return undefined;
    return n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
  }
</script>

<div class="turn">
  {#if abnormal}<span class="stop">{abnormal.replace(/_/g, ' ')}</span>{/if}
  {#if usage}
    {#if usage.inputTokens !== undefined}<span>↑ {tokens(usage.inputTokens)}</span>{/if}
    {#if usage.outputTokens !== undefined}<span>↓ {tokens(usage.outputTokens)}</span>{/if}
    {#if usage.cachedReadTokens}<span>cache {tokens(usage.cachedReadTokens)}</span>{/if}
    {#if usage.reasoningTokens}<span>reasoning {tokens(usage.reasoningTokens)}</span>{/if}
    {#if duration !== undefined}<span>{duration}s</span>{/if}
    {#if cost !== undefined}<span class="cost">${cost.toFixed(4)}</span>{/if}
  {/if}
</div>

<style>
  .turn {
    display: flex;
    flex-wrap: wrap;
    gap: 11px;
    padding-top: 6px;
    border-top: 1px solid var(--gb-rule);
    font-size: var(--gb-meta-size);
    color: var(--gb-dim);
    font-family: var(--gb-mono);
  }

  .cost {
    font-weight: 700;
  }

  .stop {
    color: var(--gb-warn);
  }
</style>
