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
    {#if usage.inputTokens !== undefined}<span>↑{tokens(usage.inputTokens)}</span>{/if}
    {#if usage.outputTokens !== undefined}<span>↓{tokens(usage.outputTokens)}</span>{/if}
    {#if usage.cachedReadTokens}<span>cache {tokens(usage.cachedReadTokens)}</span>{/if}
    {#if usage.reasoningTokens}<span>reasoning {tokens(usage.reasoningTokens)}</span>{/if}
    {#if duration !== undefined}<span>{duration}s</span>{/if}
    {#if cost !== undefined}<span class="cost">${cost.toFixed(4)}</span>{/if}
  {/if}
</div>

<style>
  .turn {
    border-top: 1px solid var(--border);
    padding-top: var(--space-2);
    font-size: 11.5px;
    line-height: 1.3;
    color: var(--text-faint);
    font-family: var(--font-ui);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .turn span {
    white-space: nowrap;
  }

  .cost {
    color: var(--text-muted);
  }

  .stop {
    color: var(--warning);
  }
</style>
