<script lang="ts">
  import type { ProposedPlanBlock } from '../../src/shared/protocol';
  import Icon from './Icon.svelte';
  import Markdown from './Markdown.svelte';

  interface Props {
    block: ProposedPlanBlock;
    onDecide: (requestId: string, approve: boolean, feedback?: string) => void;
  }

  let { block, onDecide }: Props = $props();

  let feedback = $state('');
  let showFeedback = $state(false);
  const answered = $derived(block.decision !== undefined);
</script>

<div class="plan" class:answered class:rejected={block.decision === 'rejected'}>
  <div class="head">
    <span class="mark"><Icon name="layers" size={14} /></span>
    <span class="title">Plan ready for review</span>
    {#if answered}
      <span class="verdict gb-meta">{block.decision === 'approved' ? 'Approved' : 'Rejected'}</span>
    {/if}
  </div>

  <div class="content"><Markdown text={block.content} /></div>

  {#if !answered}
    {#if showFeedback}
      <textarea
        bind:value={feedback}
        placeholder="What should change? This is sent back to the agent."
        rows="3"
      ></textarea>
    {/if}
    <div class="actions">
      <button class="gb-btn primary" onclick={() => onDecide(block.requestId, true)}>
        Approve &amp; start coding
      </button>
      {#if showFeedback}
        <button class="gb-btn ghost danger" onclick={() => onDecide(block.requestId, false, feedback)}>
          Send feedback
        </button>
      {:else}
        <button class="gb-btn ghost" onclick={() => (showFeedback = true)}>Request changes</button>
        <button class="gb-btn ghost danger" onclick={() => onDecide(block.requestId, false)}>Reject</button>
      {/if}
    </div>
    <div class="hint gb-meta">
      Approving leaves plan mode, so writes and commands start asking for approval again.
    </div>
  {/if}
</div>

<style>
  /* Like the approval card, this one blocks the turn — so it gets the same 2px frame, in the
     plan hue rather than the warning one. */
  .plan {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 9px 10px;
    border: 2px solid var(--gb-plan);
    border-radius: var(--gb-radius);
    background: color-mix(in srgb, var(--gb-plan) 8%, var(--gb-surface));
  }

  .plan.answered {
    border-color: var(--gb-rule);
    background: var(--gb-surface);
    opacity: 0.8;
  }

  .plan.rejected {
    border-color: var(--gb-danger);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .mark {
    display: flex;
    align-items: center;
    color: var(--gb-plan);
  }

  .plan.answered .mark {
    color: var(--gb-dim);
  }

  .title {
    font-weight: 800;
    font-size: 12.5px;
    flex: 1 1 auto;
  }

  .verdict {
    flex: 0 0 auto;
  }

  .content {
    max-height: 30em;
    overflow: auto;
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    padding: 6px 7px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--gb-rule));
    border-radius: var(--gb-radius);
    font: inherit;
    font-size: 13px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .danger {
    color: var(--gb-danger);
  }
</style>
