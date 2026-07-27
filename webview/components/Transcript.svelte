<script lang="ts">
  import type { ApprovalDecision, QuestionResponse, TranscriptBlock } from '../../src/shared/protocol';
  import Approval from './Approval.svelte';
  import Markdown from './Markdown.svelte';
  import Notice from './Notice.svelte';
  import PlanProposal from './PlanProposal.svelte';
  import Question from './Question.svelte';
  import Thinking from './Thinking.svelte';
  import TodoList from './TodoList.svelte';
  import ToolCard from './ToolCard.svelte';
  import TurnFooter from './TurnFooter.svelte';

  interface Props {
    blocks: TranscriptBlock[];
    showThinking: boolean;
    autoExpandThinking: boolean;
    cwd?: string;
    /** Bumped by App on every host message, including text appends that do not change length. */
    revision: number;
    onApprove: (requestId: string, decision: ApprovalDecision) => void;
    onPlanDecision: (requestId: string, approve: boolean, feedback?: string) => void;
    onAnswerQuestion: (requestId: string, response: QuestionResponse) => void;
    onOpenPath: (path: string, line?: number) => void;
    onOpenDiff: (blockId: string) => void;
    onShowLog: () => void;
  }

  let {
    blocks,
    showThinking,
    autoExpandThinking,
    cwd,
    revision,
    onApprove,
    onPlanDecision,
    onAnswerQuestion,
    onOpenPath,
    onOpenDiff,
    onShowLog,
  }: Props = $props();

  let scroller = $state<HTMLDivElement | null>(null);
  /** Sticky-bottom: follow the stream until the user scrolls up, then leave them alone. */
  let stuck = $state(true);

  const visible = $derived(blocks.filter((b) => b.kind !== 'thinking' || showThinking));

  function onScroll() {
    if (!scroller) return;
    const slack = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    stuck = slack < 32;
  }

  $effect(() => {
    // Touch `revision` so streaming appends re-run this too.
    revision;
    if (stuck && scroller) scroller.scrollTop = scroller.scrollHeight;
  });
</script>

<div class="scroller" bind:this={scroller} onscroll={onScroll}>
  {#if visible.length === 0}
    <div class="empty">
      <p>Ask Grok to do something in this workspace.</p>
      <p class="dim">
        Writes and commands wait for your approval. <kbd>Enter</kbd> sends,
        <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line, <kbd>Esc</kbd> stops the turn.
      </p>
    </div>
  {/if}

  {#each visible as block, i (block.id)}
    {@const stacked = block.kind === 'tool' && visible[i - 1]?.kind === 'tool'}
    <div class="row" class:tucked={stacked} class:msg-user={block.kind === 'text' && block.role === 'user'} class:msg-assistant={block.kind === 'text' && block.role === 'assistant'}>
      {#if block.kind === 'text'}
        {#if block.role === 'user'}
          <div class="bubble user" class:queued={block.queued}>
            <div class="role gb-kicker">You</div>
            <div class="body">{block.text}{#if block.queued}<span class="tag gb-tag">queued</span>{/if}</div>
          </div>
        {:else}
          <div class="bubble assistant" class:gb-caret={block.streaming}>
            <div class="role gb-kicker">Grok</div>
            <div class="body">
              <Markdown text={block.text} />
            </div>
          </div>
        {/if}
      {:else if block.kind === 'thinking'}
        <Thinking {block} autoExpand={autoExpandThinking} />
      {:else if block.kind === 'tool'}
        <ToolCard {block} {cwd} {onOpenPath} {onOpenDiff} {stacked} />
      {:else if block.kind === 'plan'}
        <TodoList {block} />
      {:else if block.kind === 'proposedPlan'}
        <PlanProposal {block} onDecide={onPlanDecision} />
      {:else if block.kind === 'question'}
        <Question {block} onAnswer={onAnswerQuestion} />
      {:else if block.kind === 'approval'}
        <Approval {block} onDecide={onApprove} />
      {:else if block.kind === 'notice'}
        <Notice {block} {onShowLog} />
      {:else if block.kind === 'turn'}
        <TurnFooter {block} />
      {/if}
    </div>
  {/each}
</div>

<style>
  .scroller {
    flex: 1 1 auto;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 10px 10px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .row {
    min-width: 0;
  }

  /* Cancels the column gap so consecutive tool cards butt up into one stack. */
  .row.tucked {
    margin-top: -12px;
  }

  /* User turns sit slightly apart so the thread reads as a dialogue, not one wall of text. */
  .row.msg-user {
    margin-top: 2px;
  }

  .row.msg-assistant + .row.msg-user {
    margin-top: 4px;
  }

  .bubble {
    min-width: 0;
  }

  .role {
    margin-bottom: 4px;
    letter-spacing: 0.04em;
  }

  .user .role {
    color: var(--gb-accent);
  }

  .assistant .role {
    color: var(--gb-dim);
  }

  .user {
    padding: 8px 10px;
    border-left: 3px solid var(--gb-accent);
    background: color-mix(in srgb, var(--gb-accent) 10%, var(--vscode-textBlockQuote-background, rgba(128, 128, 128, 0.12)));
    border-radius: var(--gb-radius);
  }

  .user .body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--vscode-foreground);
  }

  /* Waiting for the current turn to finish — dimmed so it reads as "not sent yet". */
  .user.queued {
    opacity: 0.7;
    border-left-style: dashed;
  }

  .assistant {
    padding: 2px 0 2px 2px;
  }

  .assistant .body {
    padding-left: 0;
  }

  .tag {
    margin-left: 7px;
    white-space: nowrap;
    vertical-align: middle;
  }

  .empty {
    padding: 18px 4px;
    color: var(--vscode-foreground);
  }

  .empty p {
    margin: 0 0 8px;
  }

  .empty .dim {
    color: var(--gb-dim);
    font-size: 0.9em;
  }

  kbd {
    font-family: var(--gb-mono);
    font-size: 0.9em;
    padding: 0 4px;
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
  }
</style>
