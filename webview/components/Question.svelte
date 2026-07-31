<script lang="ts">
  import type { QuestionAnnotation, QuestionBlock, QuestionResponse } from '../../src/shared/protocol';
  import Icon from './Icon.svelte';

  interface Props {
    block: QuestionBlock;
    onAnswer: (requestId: string, response: QuestionResponse) => void;
  }

  let { block, onAnswer }: Props = $props();

  const questions = $derived(block.questions);
  const total = $derived(questions.length);

  let step = $state(0);
  let picks = $state<Record<number, string[]>>({});
  let notes = $state<Record<number, string>>({});
  let otherOpen = $state<Record<number, boolean>>({});
  let otherInput = $state<HTMLInputElement | null>(null);

  const current = $derived(questions[Math.min(step, Math.max(total - 1, 0))]);
  const chosen = $derived(picks[step] ?? []);

  function isAnswered(index: number): boolean {
    return (picks[index]?.length ?? 0) > 0 || (notes[index] ?? '').trim().length > 0;
  }

  const canAdvance = $derived(isAnswered(step));
  const complete = $derived(questions.every((_, i) => isAnswered(i)));
  const onLast = $derived(step >= total - 1);

  function toggle(label: string) {
    const list = picks[step] ?? [];
    if (current?.multiSelect) {
      picks[step] = list.includes(label) ? list.filter((l) => l !== label) : [...list, label];
    } else {
      picks[step] = list.includes(label) ? [] : [label];
      if (picks[step].length > 0 && !onLast) step += 1;
    }
  }

  function openOther() {
    otherOpen[step] = !otherOpen[step];
    if (otherOpen[step]) queueMicrotask(() => otherInput?.focus());
  }

  const selectedPreview = $derived(
    current?.multiSelect ? undefined : current?.options.find((o) => chosen.includes(o.label))?.preview,
  );

  function submit() {
    const answers: Record<string, string | string[]> = {};
    const annotations: Record<string, QuestionAnnotation> = {};

    questions.forEach((q, i) => {
      const list = [...(picks[i] ?? [])];
      const extra = (notes[i] ?? '').trim();
      if (list.length === 0 && extra) list.push(extra);
      answers[q.question] = q.multiSelect ? list : (list[0] ?? '');

      const preview = q.multiSelect ? undefined : q.options.find((o) => list.includes(o.label))?.preview;
      const note = list.length > 1 || (picks[i]?.length ?? 0) > 0 ? extra : '';
      if (note || preview) annotations[q.question] = { ...(note ? { notes: note } : {}), ...(preview ? { preview } : {}) };
    });

    onAnswer(block.requestId, { outcome: 'accepted', answers, annotations });
  }

  function skip() {
    onAnswer(block.requestId, { outcome: 'skip_interview' });
  }
</script>

<div class="gb-question-card" class:answered={block.answered}>
  <div class="gb-wizard-header">
    <span>Question {step + 1} of {total}{current?.multiSelect ? ' (Multi-Select)' : ''}</span>
    {#if total > 1}
      <div class="gb-wizard-meter">
        <div class="gb-wizard-fill" style="width: {((step + 1) / total) * 100}%;"></div>
      </div>
      <span class="dots" role="tablist" aria-label="Questions">
        {#each questions as _q, i (i)}
          <button
            class="dot"
            class:on={i === step}
            class:done={isAnswered(i)}
            role="tab"
            aria-selected={i === step}
            aria-label={`Question ${i + 1}`}
            disabled={block.answered}
            onclick={() => (step = i)}
          ></button>
        {/each}
      </span>
    {/if}
    {#if block.answered}
      <span class="gb-verdict-line">Answered</span>
    {/if}
  </div>

  {#if block.answered}
    <div class="gb-question-title">{current?.question}</div>
    <div class="gb-hint">
      {block.response?.outcome === 'skip_interview' ? 'Skipped — Grok continued on its own.' : 'Sent to Grok.'}
    </div>
  {:else if current}
    <div class="gb-question-title">{current.question}</div>

    <div class="gb-option-list" role={current.multiSelect ? 'group' : 'radiogroup'}>
      {#each current.options as option, oi (oi)}
        {@const on = chosen.includes(option.label)}
        <button
          class="gb-option-row"
          class:selected={on}
          role={current.multiSelect ? 'checkbox' : 'radio'}
          aria-checked={on}
          title={option.description}
          onclick={() => toggle(option.label)}
        >
          {#if current.multiSelect}
            <div class="gb-checkbox" class:selected={on}>
              {#if on}<Icon name="check" size={10} />{/if}
            </div>
          {:else}
            <div class="gb-radio" class:selected={on}></div>
          {/if}
          <div class="gb-option-body">
            <span class="gb-option-label">{option.label}</span>
            {#if option.description}<span class="gb-option-desc">{option.description}</span>{/if}
          </div>
        </button>
      {/each}

      <button
        class="gb-option-row gb-option-other"
        class:selected={otherOpen[step]}
        role={current.multiSelect ? 'checkbox' : 'radio'}
        aria-checked={otherOpen[step]}
        onclick={openOther}
      >
        {#if current.multiSelect}
          <div class="gb-checkbox" class:selected={otherOpen[step]}>
            {#if otherOpen[step]}<Icon name="check" size={10} />{/if}
          </div>
        {:else}
          <div class="gb-radio" class:selected={otherOpen[step]}></div>
        {/if}
        <div class="gb-option-body">
          <span class="gb-option-label">Other…</span>
        </div>
      </button>
    </div>

    {#if otherOpen[step]}
      <input
        bind:this={otherInput}
        type="text"
        class="gb-question-input"
        bind:value={notes[step]}
        placeholder={chosen.length > 0 ? 'Add a note…' : 'Type your own answer…'}
        onkeydown={(e) => {
          if (e.key === 'Enter' && complete) submit();
        }}
      />
    {/if}

    {#if selectedPreview}
      <pre class="gb-preview-box">{selectedPreview}</pre>
    {/if}

    <div class="gb-action-group">
      <button class="gb-btn-ghost" title="Let Grok continue without answers" onclick={skip}>Skip</button>
      <div class="gb-right-actions">
        {#if step > 0}
          <button class="gb-btn-secondary" onclick={() => (step -= 1)}>Back</button>
        {/if}
        {#if !onLast}
          <button class="gb-btn-primary" disabled={!canAdvance} onclick={() => (step += 1)}>Next</button>
        {/if}
        {#if onLast}
          <button class="gb-btn-primary" disabled={!complete} onclick={submit}>Submit</button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Question Card Wizard (Level 1 — Raised, no 2px purple frame) */
  .gb-question-card {
    width: 100%;
    box-sizing: border-box;
    margin: 0;
    background-color: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .gb-question-card.answered {
    opacity: 1;
  }

  .gb-wizard-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11.5px;
    color: var(--text-muted);
  }

  .gb-wizard-meter {
    flex: 1;
    height: 2px;
    background-color: var(--border);
    margin: 0 var(--space-3);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .gb-wizard-fill {
    height: 100%;
    background-color: var(--accent);
  }

  .dots {
    display: flex;
    gap: 3px;
    flex: 0 0 auto;
  }

  .dot {
    width: 12px;
    height: 3px;
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: var(--border-strong);
    cursor: pointer;
  }

  .dot.done {
    background: var(--text-muted);
  }

  .dot.on {
    background: var(--accent);
  }

  .gb-verdict-line {
    font-size: 11.5px;
    color: var(--text-muted);
  }

  .gb-question-title {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--text);
    line-height: 1.4;
  }

  .gb-option-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .gb-option-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background-color: var(--bg);
    cursor: pointer;
    user-select: none;
    text-align: left;
    width: 100%;
    font-family: var(--font-ui);
    transition: background-color var(--dur-fast) var(--ease-standard);
  }

  .gb-option-row:hover {
    background-color: var(--bg-hover);
  }

  .gb-option-row.selected {
    background-color: var(--accent-subtle);
    border-color: var(--accent);
  }

  /* List row focus treatment (§1): --bg-hover background + 2px --focus left edge, no ring */
  .gb-option-row:focus-visible {
    outline: none;
    background-color: var(--bg-hover);
    border-left: 2px solid var(--focus);
  }

  .gb-radio,
  .gb-checkbox {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .gb-checkbox {
    border-radius: var(--radius-sm);
  }

  .gb-radio.selected {
    border-color: var(--accent);
  }

  .gb-radio.selected::after {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--accent);
  }

  .gb-checkbox.selected {
    background-color: var(--accent);
    border-color: var(--accent);
    color: var(--accent-fg);
  }

  /*
   * Label above description, both allowed to wrap. Side by side they fit only the widest
   * sidebar: at 380px the description was ellipsised away, and the description is what the
   * choice is actually made on.
   */
  .gb-option-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .gb-option-label {
    font-size: 12.5px;
    color: var(--text);
    font-weight: 500;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .gb-option-desc {
    font-size: 11.5px;
    color: var(--text-muted);
    font-weight: 400;
    line-height: 1.45;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  /* Inputs (§1 focus rule): border to --focus at 1px + single outline offset 0. No double ring. */
  .gb-question-input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background-color: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12.5px;
    margin-top: 4px;
    box-sizing: border-box;
  }

  .gb-question-input:focus-visible {
    border-color: var(--focus);
    outline: 1px solid var(--focus);
    outline-offset: 0;
  }

  .gb-preview-box {
    margin: 0;
    max-height: 140px;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-inset);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    color: var(--text);
  }

  .gb-action-group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .gb-right-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }









  .gb-hint {
    font-size: 11.5px;
    color: var(--text-muted);
  }
</style>
