<script lang="ts">
  import type { PlanBlock } from '../../src/shared/protocol';
  import Icon from './Icon.svelte';

  interface Props {
    block: PlanBlock;
  }

  let { block }: Props = $props();

  const done = $derived(block.entries.filter((e) => e.status === 'completed').length);
  const total = $derived(block.entries.length);
</script>

<div class="todos">
  <div class="head">
    <span class="gb-kicker">Plan</span>
    <span class="count gb-meta">{done}/{total}</span>
    <!-- A bar rather than a percentage: at sidebar width the number would cost more room than it earns. -->
    <span class="bar"><span class="fill" style="width: {total ? (done / total) * 100 : 0}%"></span></span>
  </div>
  <ul>
    {#each block.entries as entry, i (i)}
      <li class={entry.status ?? 'pending'}>
        <span class="box">
          {#if entry.status === 'completed'}
            <Icon name="check" size={11} />
          {:else if entry.status === 'in_progress'}
            <span class="dot"></span>
          {/if}
        </span>
        <span class="text">{entry.content}</span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .todos {
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    background: var(--gb-surface);
    padding: 8px 10px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 6px;
  }

  .count {
    flex: 0 0 auto;
  }

  .bar {
    flex: 1 1 auto;
    height: 2px;
    background: var(--gb-rule);
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--gb-accent);
    transition: width 0.15s ease;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  li {
    display: flex;
    gap: 7px;
    align-items: flex-start;
    font-size: 12.5px;
    line-height: 1.5;
  }

  /* A square, not a circle — the system never rounds a corner. */
  .box {
    flex: 0 0 13px;
    height: 13px;
    margin-top: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--gb-rule);
    color: var(--gb-dim);
  }

  .dot {
    width: 5px;
    height: 5px;
    background: currentColor;
  }

  li.completed .box {
    border-color: var(--gb-ok);
    color: var(--gb-ok);
  }

  li.completed .text {
    text-decoration: line-through;
    color: var(--gb-dim);
  }

  li.in_progress .box {
    border-color: var(--gb-accent);
    color: var(--gb-accent);
  }

  li.in_progress .text {
    font-weight: 700;
  }
</style>
