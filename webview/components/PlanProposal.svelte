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

<div class="gb-proposed-plan" class:answered class:rejected={block.decision === 'rejected'}>
  <div class="gb-card-header">
    <Icon name="layers" size={14} />
    <span class="gb-card-kicker">PLAN PROPOSAL</span>
    {#if answered}
      <div class="gb-verdict-line">
        {#if block.decision === 'approved'}
          <Icon name="check" size={14} />
          <span>Approved &amp; started</span>
        {:else}
          <Icon name="close" size={14} />
          <span>Rejected</span>
        {/if}
      </div>
    {/if}
  </div>

  <div class="gb-prose-content"><Markdown text={block.content} /></div>

  {#if !answered}
    {#if showFeedback}
      <textarea
        bind:value={feedback}
        class="gb-feedback-input"
        placeholder="What should change? This is sent back to the agent."
        rows="3"
      ></textarea>
    {/if}
    <div class="gb-action-group">
      <button class="gb-btn-primary" onclick={() => onDecide(block.requestId, true)}>
        Approve &amp; start
      </button>
      {#if showFeedback}
        <button class="gb-btn-ghost-danger" onclick={() => onDecide(block.requestId, false, feedback)}>
          Send feedback
        </button>
      {:else}
        <button class="gb-btn-secondary" onclick={() => (showFeedback = true)}>Request changes</button>
        <button class="gb-btn-ghost-danger" onclick={() => onDecide(block.requestId, false)}>Reject</button>
      {/if}
    </div>
    <div class="gb-hint">
      Approving leaves plan mode, so writes and commands start asking for approval again.
    </div>
  {/if}
</div>

<style>
  /* Proposed Plan Card (Level 1 — Raised, no 2px blue frame) */
  .gb-proposed-plan {
    background-color: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .gb-proposed-plan.answered {
    opacity: 1;
  }

  .gb-card-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .gb-card-header :global(svg) {
    color: var(--text-muted);
  }

  .gb-card-kicker {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
    flex: 1 1 auto;
  }

  .gb-verdict-line {
    font-size: 12px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .gb-verdict-line :global(svg) {
    color: var(--success);
  }

  .gb-proposed-plan.rejected .gb-verdict-line :global(svg) {
    color: var(--danger);
  }

  .gb-prose-content {
    max-height: 30em;
    overflow: auto;
    font-size: 12.5px;
  }

  /* Inputs (§1 focus rule): border to --focus at 1px + single outline offset 0. No double ring. */
  .gb-feedback-input {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-inset);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    font-family: var(--font-ui);
    font-size: 12.5px;
  }

  .gb-feedback-input:focus-visible {
    border-color: var(--focus);
    outline: 1px solid var(--focus);
    outline-offset: 0;
  }

  .gb-action-group {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }







  button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .gb-hint {
    font-size: 11.5px;
    color: var(--text-muted);
  }
</style>
