<script lang="ts">
  import type { ApprovalBlock, ApprovalDecision } from '../../src/shared/protocol';
  import DiffView from './DiffView.svelte';
  import Icon from './Icon.svelte';
  import { middleEllipsis, shortenPath } from '../paths';

  interface Props {
    block: ApprovalBlock;
    /** Workspace root, so the target reads like an editor tab instead of an absolute path. */
    cwd?: string;
    /**
     * The tool row this approval belongs to is already on screen. Then the command, the file and
     * the diff are all rendered directly above, and repeating them here turns one tool call into
     * a wall of text — so the card shrinks to its title and its buttons.
     */
    compact?: boolean;
    onOpenPath: (path: string, line?: number) => void;
    onDecide: (requestId: string, decision: ApprovalDecision) => void;
  }

  let { block, cwd, compact = false, onOpenPath, onDecide }: Props = $props();

  const request = $derived(block.request);
  /**
   * Local latch: the host confirms with a `decision` patch, but the buttons must go dead on the
   * first press. Otherwise an impatient second click on a moving card sends a second, possibly
   * contradictory answer for a request that is already resolved.
   */
  let sent = $state<ApprovalDecision | undefined>(undefined);
  const answered = $derived(block.decision !== undefined || sent !== undefined);
  /** What to report: the host's answer once it lands, the pressed button until then. */
  const verdict = $derived(block.decision ?? sent);
  const allowed = $derived(verdict === 'once' || verdict === 'always');
  const isNew = $derived(request.kind === 'write' && request.oldText === undefined);
  /* Same shortening as the transcript's tool rows — one file, one way of writing it. */
  const writePath = $derived(request.kind === 'write' ? request.path : undefined);
  const shortPath = $derived(writePath ? shortenPath(writePath, cwd) : undefined);

  const decisionLabel: Record<ApprovalDecision, string> = {
    once: 'Allowed once',
    always: 'Allowed for the session',
    reject: 'Rejected',
    rejectAlways: 'Rejected for the session',
  };

  function decide(decision: ApprovalDecision) {
    if (answered) return;
    sent = decision;
    onDecide(request.requestId, decision);
  }
</script>

<div
  class="gb-approval-card"
  class:answered
  class:compact
  class:rejected={verdict === 'reject' || verdict === 'rejectAlways'}
>
  <div class="gb-approval-title">
    {#if answered && allowed}
      <Icon name="check" size={16} />
    {:else}
      <Icon name="warning" size={16} />
    {/if}
    <span>{request.title}</span>
    {#if verdict}
      <span class="gb-verdict-line">{decisionLabel[verdict]}</span>
    {/if}
  </div>

  {#if compact}
    <!-- Nothing repeated: the tool row above already shows the command, the file and the diff. -->
  {:else if request.kind === 'command'}
    <div class="gb-approval-target">$ {request.command}</div>
    {#if request.cwd}<div class="gb-approval-meta">cwd: {request.cwd}</div>{/if}
  {:else if request.kind === 'write'}
    {#if writePath && shortPath}
      <div class="gb-approval-target is-path">
        {#if isNew}
          <!-- Nothing to open yet: the file only exists once the write is approved. -->
          <span class="gb-approval-path is-static" title={writePath}>{middleEllipsis(shortPath)}</span>
          <span class="gb-approval-flag">new file</span>
        {:else}
          <button
            type="button"
            class="gb-approval-path"
            title={writePath}
            onclick={() => onOpenPath(writePath)}
          >
            {middleEllipsis(shortPath)}
          </button>
        {/if}
      </div>
    {/if}
    <DiffView oldText={request.oldText ?? null} newText={request.newText ?? ''} maxRows={24} />
  {:else if request.agentOptions?.length}
    <div class="gb-approval-target">The agent asked for permission.</div>
  {/if}

  {#if !answered}
    <div class="gb-action-group">
      <button class="gb-btn-primary" onclick={() => decide('once')}>
        {request.kind === 'command' ? 'Run' : 'Apply'}
      </button>
      <button class="gb-btn-secondary" onclick={() => decide('always')} title={request.alwaysScope}>
        {request.kind === 'command' ? 'Always allow' : 'Accept all edits'}
      </button>
      <button class="gb-btn-ghost" onclick={() => decide('reject')}>Reject</button>
      {#if request.kind === 'command'}
        <button class="gb-btn-ghost-danger" onclick={() => decide('rejectAlways')} title={request.alwaysScope}>
          Never
        </button>
      {/if}
    </div>
    {#if request.alwaysScope && !compact}
      <div class="gb-approval-meta">“Always” remembers <code>{request.alwaysScope}</code> until the agent restarts.</div>
    {/if}
  {/if}
</div>

<style>
  /* Level 2 — Interrupt: 2px left border in --warning or --danger, 1px --border on other sides */
  .gb-approval-card {
    background-color: var(--bg-raised);
    border-left: 2px solid var(--warning);
    border-top: 1px solid var(--border);
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  /*
   * Compact: the decision only. It sits directly under its tool row, so it is one line of title
   * and one row of buttons — the same footprint as the row it answers for.
   */
  .gb-approval-card.compact {
    padding: var(--space-2) var(--space-3);
    gap: var(--space-2);
  }

  .gb-approval-card.answered {
    border-left-color: var(--border);
    opacity: 1;
  }

  .gb-approval-card.rejected {
    border-left-color: var(--danger);
  }

  .gb-approval-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
  }

  .gb-approval-title :global(svg) {
    color: var(--warning);
    flex-shrink: 0;
  }

  .gb-approval-card.answered .gb-approval-title :global(svg) {
    color: var(--success);
  }

  .gb-approval-card.rejected .gb-approval-title :global(svg) {
    color: var(--danger);
  }

  .gb-approval-title span:nth-child(2) {
    flex: 1 1 auto;
  }

  .gb-verdict-line {
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 400;
  }

  .gb-approval-target {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--accent);
    overflow-wrap: anywhere;
  }

  /* Only the file row is a single line; a command still wraps as many lines as it needs. */
  .gb-approval-target.is-path {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  /*
   * The file, written the way the transcript's tool rows write it: workspace-relative and
   * middle-ellipsised on one line. It used to be the raw absolute path, which repeated the title
   * and wrapped to three lines at 380px. Clicking it opens the file, same affordance as a tool row.
   */
  .gb-approval-path {
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: var(--accent);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    cursor: pointer;
  }

  .gb-approval-path.is-static {
    cursor: default;
  }

  .gb-approval-path:not(.is-static):hover {
    text-decoration: underline;
  }

  .gb-approval-flag {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--text-faint);
  }

  .gb-approval-meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-faint);
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

  code {
    font-family: var(--font-mono);
  }
</style>
