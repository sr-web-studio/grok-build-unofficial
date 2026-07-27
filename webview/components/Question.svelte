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

  /**
   * One question at a time. Grok asks up to four at once and stacking them turned the card into a
   * full screen of scrolling; a stepper keeps it the size of a single prompt.
   */
  let step = $state(0);
  let picks = $state<Record<number, string[]>>({});
  let notes = $state<Record<number, string>>({});
  let otherOpen = $state<Record<number, boolean>>({});
  let otherInput = $state<HTMLInputElement | null>(null);

  const current = $derived(questions[Math.min(step, Math.max(total - 1, 0))]);
  const chosen = $derived(picks[step] ?? []);

  /** Answered means picked something, or typed an answer into "Other". */
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
      // A single-select pick is a complete answer, so step forward rather than making the user
      // hunt for Next — the same rhythm as clicking through a wizard.
      if (picks[step].length > 0 && !onLast) step += 1;
    }
  }

  function openOther() {
    otherOpen[step] = !otherOpen[step];
    if (otherOpen[step]) queueMicrotask(() => otherInput?.focus());
  }

  /** The preview of the selected option, which grok echoes back so it knows what the user saw. */
  const selectedPreview = $derived(
    current?.multiSelect ? undefined : current?.options.find((o) => chosen.includes(o.label))?.preview,
  );

  function submit() {
    const answers: Record<string, string | string[]> = {};
    const annotations: Record<string, QuestionAnnotation> = {};

    questions.forEach((q, i) => {
      const list = [...(picks[i] ?? [])];
      const extra = (notes[i] ?? '').trim();
      // With nothing picked, the typed text *is* the answer ("Other"); alongside picks it is a note.
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

<div class="qa" class:answered={block.answered}>
  <div class="bar">
    <span class="mark"><Icon name="sparkles" size={13} /></span>
    <span class="kicker gb-kicker">{current?.header || 'Grok asks'}</span>
    {#if total > 1}
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
    {#if block.answered}<span class="verdict gb-meta">Answered</span>{/if}
  </div>

  {#if block.answered}
    <div class="text">{current?.question}</div>
    <div class="hint gb-meta">
      {block.response?.outcome === 'skip_interview' ? 'Skipped — Grok continued on its own.' : 'Sent to Grok.'}
    </div>
  {:else if current}
    <div class="text">{current.question}</div>

    <div class="options" role={current.multiSelect ? 'group' : 'radiogroup'}>
      {#each current.options as option, oi (oi)}
        {@const on = chosen.includes(option.label)}
        <button
          class="option"
          class:picked={on}
          role={current.multiSelect ? 'checkbox' : 'radio'}
          aria-checked={on}
          title={option.description}
          onclick={() => toggle(option.label)}
        >
          <span class="box" class:multi={current.multiSelect} class:on>
            {#if on && current.multiSelect}<Icon name="check" size={10} />{/if}
          </span>
          <span class="body">
            <span class="label">{option.label}</span>
            {#if option.description}<span class="desc">{option.description}</span>{/if}
          </span>
        </button>
      {/each}

      <button class="option other" class:picked={otherOpen[step]} onclick={openOther}>
        <span class="box" class:multi={current.multiSelect} class:on={otherOpen[step]}>
          {#if otherOpen[step] && current.multiSelect}<Icon name="check" size={10} />{/if}
        </span>
        <span class="body"><span class="label">Other…</span></span>
      </button>
    </div>

    {#if otherOpen[step]}
      <input
        bind:this={otherInput}
        type="text"
        bind:value={notes[step]}
        placeholder={chosen.length > 0 ? 'Add a note…' : 'Type your own answer…'}
        onkeydown={(e) => {
          if (e.key === 'Enter' && complete) submit();
        }}
      />
    {/if}

    {#if selectedPreview}
      <pre class="preview">{selectedPreview}</pre>
    {/if}

    <div class="actions">
      {#if step > 0}
        <button class="gb-btn ghost" onclick={() => (step -= 1)}>Back</button>
      {/if}
      {#if !onLast}
        <button class="gb-btn primary" disabled={!canAdvance} onclick={() => (step += 1)}>Next</button>
      {/if}
      <button class="gb-btn" class:primary={onLast} disabled={!complete} onclick={submit}>Send</button>
      <span class="spacer"></span>
      <button class="gb-btn ghost" title="Let Grok continue without answers" onclick={skip}>Skip</button>
    </div>
  {/if}
</div>

<style>
  .qa {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 9px;
    border: 2px solid var(--gb-think);
    border-radius: var(--gb-radius);
    background: color-mix(in srgb, var(--gb-think) 8%, var(--gb-surface));
  }

  .qa.answered {
    border-color: var(--gb-rule);
    background: var(--gb-surface);
    opacity: 0.8;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mark {
    display: flex;
    color: var(--gb-think);
  }

  .kicker {
    flex: 1 1 auto;
    color: var(--gb-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .verdict {
    flex: 0 0 auto;
  }

  /* Progress reads as a row of ticks rather than "Question 2 of 4" — it costs one line less. */
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
    background: var(--gb-rule-strong);
    cursor: pointer;
  }

  .dot.done {
    background: var(--gb-think);
  }

  .dot.on {
    background: var(--gb-accent);
  }

  .text {
    font-weight: 600;
    font-size: 12.5px;
    line-height: 1.4;
  }

  .options {
    display: flex;
    flex-direction: column;
  }

  .option {
    display: flex;
    align-items: baseline;
    gap: 7px;
    text-align: left;
    width: 100%;
    padding: 4px 7px;
    border: 1px solid var(--gb-rule);
    border-bottom: none;
    border-radius: var(--gb-radius);
    background: none;
    color: var(--vscode-foreground);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .option:last-child {
    border-bottom: 1px solid var(--gb-rule);
  }

  .option:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .option.picked {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  /*
   * The control has to look like a control *before* it is clicked. An unfilled hairline square on
   * the card's own background read as decoration, so it borrows the theme's checkbox border and
   * fill — and the shape carries the mode: a square is pick-many, a circle is pick-one.
   */
  /*
   * The ring is drawn from the text colour, not from `--vscode-checkbox-border`. That token is
   * near-invisible in the default dark theme, which is what made these read as bullets rather
   * than as something to click.
   */
  .box {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    align-self: center;
    border: 1px solid color-mix(in srgb, var(--vscode-foreground) 55%, transparent);
    background: var(--vscode-checkbox-background, var(--vscode-input-background));
    color: var(--vscode-checkbox-foreground, var(--vscode-foreground));
  }

  .box:not(.multi) {
    border-radius: 50%;
  }

  .box.on {
    border-color: var(--gb-accent);
    background: var(--gb-accent);
    color: var(--vscode-button-foreground, var(--vscode-editor-background));
  }

  /* Single-select fills with a dot rather than a tick — the usual radio reading. */
  .box:not(.multi).on::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .option:hover .box {
    border-color: var(--gb-accent);
  }

  .body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .label {
    flex: 0 1 auto;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The description rides on the same line and truncates; the full text is in the tooltip. */
  .desc {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--gb-meta-size);
    font-weight: 400;
    color: var(--gb-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .option.picked .desc {
    color: inherit;
    opacity: 0.85;
  }

  .other .label {
    color: var(--gb-dim);
  }

  .option.other.picked .label {
    color: inherit;
  }

  input {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 7px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--gb-rule));
    border-radius: var(--gb-radius);
    font: inherit;
    font-size: 12px;
  }

  .preview {
    margin: 0;
    max-height: 140px;
    overflow: auto;
    padding: 6px 8px;
    background: var(--gb-surface-sunken);
    border-radius: var(--gb-radius);
    font-family: var(--gb-mono);
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .spacer {
    flex: 1 1 auto;
  }

  .hint {
    color: var(--gb-dim);
  }
</style>
