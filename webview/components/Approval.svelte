<script lang="ts">
  import type { ApprovalBlock, ApprovalDecision } from '../../src/shared/protocol';
  import DiffView from './DiffView.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    block: ApprovalBlock;
    onDecide: (requestId: string, decision: ApprovalDecision) => void;
  }

  let { block, onDecide }: Props = $props();

  const request = $derived(block.request);
  const answered = $derived(block.decision !== undefined);
  const isNew = $derived(request.kind === 'write' && request.oldText === undefined);

  const decisionLabel: Record<ApprovalDecision, string> = {
    once: 'Allowed once',
    always: 'Allowed for the session',
    reject: 'Rejected',
    rejectAlways: 'Rejected for the session',
  };

  function decide(decision: ApprovalDecision) {
    if (answered) return;
    onDecide(request.requestId, decision);
  }
</script>

<div class="approval" class:answered class:rejected={block.decision === 'reject' || block.decision === 'rejectAlways'}>
  <div class="head">
    <span class="mark"><Icon name="warning" size={14} /></span>
    <span class="title">{request.title}</span>
    {#if answered}
      <span class="verdict gb-meta">{decisionLabel[block.decision!]}</span>
    {/if}
  </div>

  {#if request.kind === 'command'}
    <pre class="cmd">{request.command}</pre>
    {#if request.cwd}<div class="cwd">in {request.cwd}</div>{/if}
  {:else if request.kind === 'write'}
    <div class="path">{request.path}{isNew ? ' (new file)' : ''}</div>
    <DiffView oldText={request.oldText ?? null} newText={request.newText ?? ''} maxRows={24} />
  {:else if request.agentOptions?.length}
    <div class="path">The agent asked for permission.</div>
  {/if}

  {#if !answered}
    <div class="actions">
      <button class="gb-btn primary" onclick={() => decide('once')}>
        {request.kind === 'command' ? 'Run' : 'Apply'}
      </button>
      <button class="gb-btn ghost" onclick={() => decide('always')} title={request.alwaysScope}>
        {request.kind === 'command' ? 'Always allow' : 'Accept all edits'}
      </button>
      <button class="gb-btn ghost danger" onclick={() => decide('reject')}>Reject</button>
      {#if request.kind === 'command'}
        <button class="gb-btn ghost danger" onclick={() => decide('rejectAlways')} title={request.alwaysScope}>
          Never
        </button>
      {/if}
    </div>
    {#if request.alwaysScope}
      <div class="scope">“Always” remembers <code>{request.alwaysScope}</code> until the agent restarts.</div>
    {/if}
  {/if}
</div>

<style>
  /* The one card that must stop the eye: a 2px frame and a tinted ground, per the design. */
  .approval {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 9px 10px;
    border: 2px solid var(--gb-warn);
    border-radius: var(--gb-radius);
    background: color-mix(in srgb, var(--gb-warn) 8%, var(--gb-surface));
  }

  .approval.answered {
    border-color: var(--gb-rule);
    background: var(--gb-surface);
    opacity: 0.75;
  }

  .approval.rejected {
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
    color: var(--gb-warn);
  }

  .approval.answered .mark {
    color: var(--gb-dim);
  }

  .title {
    flex: 1 1 auto;
    font-weight: 600;
    font-size: 12.5px;
  }

  .verdict {
    flex: 0 0 auto;
  }

  .cmd {
    margin: 0;
    padding: 6px 8px;
    background: var(--gb-surface-sunken);
    border-radius: var(--gb-radius);
    font-family: var(--gb-mono);
    font-size: 11.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .cwd,
  .scope {
    font-family: var(--gb-mono);
    font-size: var(--gb-meta-size);
    color: var(--gb-dim);
  }

  .path {
    font-family: var(--gb-mono);
    font-size: var(--gb-meta-size);
    color: var(--gb-dim);
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .danger {
    color: var(--gb-danger);
  }

  code {
    font-family: var(--gb-mono);
  }
</style>
