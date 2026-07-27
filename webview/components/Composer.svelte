<script lang="ts">
  import type { AvailableCommand } from '../../src/acp/types';
  import type { AgentState } from '../../src/shared/protocol';

  interface Props {
    text: string;
    agentState: AgentState;
    commands: AvailableCommand[];
    queuedCount: number;
    /** Bumped by App when the host asks for focus. */
    focusSignal: number;
    onSend: (text: string) => void;
    onCancel: () => void;
    onClearQueue: () => void;
  }

  let {
    text = $bindable(),
    agentState,
    commands,
    queuedCount,
    focusSignal,
    onSend,
    onCancel,
    onClearQueue,
  }: Props = $props();

  /** The box grows with the text up to this, then scrolls. */
  const MAX_HEIGHT = 220;

  let input = $state<HTMLTextAreaElement | null>(null);
  let picked = $state(0);

  const busy = $derived(agentState === 'thinking' || agentState === 'awaitingApproval');
  const stopped = $derived(agentState === 'stopped');

  /** Only offer commands while the first word is still being typed. */
  const matches = $derived.by(() => {
    const m = /^\/([\w:-]*)$/.exec(text);
    if (!m) return [];
    const prefix = m[1].toLowerCase();
    return commands.filter((c) => c.name.toLowerCase().startsWith(prefix)).slice(0, 8);
  });

  $effect(() => {
    focusSignal;
    input?.focus();
  });

  $effect(() => {
    // Keep the highlighted row inside the (re-filtered) list.
    if (picked >= matches.length) picked = 0;
  });

  function autogrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    // Scroll only once the text really is taller than the cap. Left on `auto`, a one-row box
    // whose placeholder wraps to two lines paints a scrollbar over an empty input.
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }

  function accept(name: string) {
    text = `/${name} `;
    picked = 0;
    input?.focus();
    if (input) autogrow(input);
  }

  function submit() {
    const value = text.trim();
    if (!value) return;
    onSend(value);
    text = '';
    if (input) {
      input.style.height = 'auto';
      input.style.overflowY = 'hidden';
      input.focus();
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        picked = (picked + 1) % matches.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        picked = (picked - 1 + matches.length) % matches.length;
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        accept(matches[picked].name);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }

    if (event.key === 'Escape' && busy) {
      event.preventDefault();
      onCancel();
    }
  }
</script>

<div class="composer">
  {#if matches.length > 0}
    <div class="commands">
      {#each matches as command, i (command.name)}
        <button class="command" class:picked={i === picked} onclick={() => accept(command.name)}>
          <span class="name">/{command.name}</span>
          {#if command.description}<span class="desc">{command.description}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Text on its own row above the buttons, so a one-line prompt starts at the top of the box
       instead of floating at the bottom next to a two-line-tall Send button. -->
  <div class="box">
    <textarea
      bind:this={input}
      bind:value={text}
      rows="1"
      placeholder={busy ? 'Queue a follow-up…' : 'Ask, or / for commands…'}
      onkeydown={onKeydown}
      oninput={(e) => autogrow(e.currentTarget)}
    ></textarea>
    <div class="buttons">
      {#if busy}
        <button class="stop" onclick={onCancel} title="Stop the current turn (Esc)">Stop</button>
      {/if}
      <button class="send" onclick={submit} disabled={!text.trim()}>
        {busy ? 'Queue' : stopped ? 'Start' : 'Send'}
      </button>
    </div>
  </div>

  {#if queuedCount > 0}
    <div class="queued">
      <span>
        {queuedCount} message{queuedCount === 1 ? '' : 's'} waiting — {queuedCount === 1 ? 'it goes' : 'they go'}
        to Grok when this turn ends
      </span>
      <button class="link" onclick={onClearQueue}>Clear</button>
    </div>
  {/if}
</div>

<style>
  /* The mode bar directly above owns the section rule now — a second one here would double it. */
  .composer {
    flex: 0 0 auto;
    padding: 4px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .commands {
    display: flex;
    flex-direction: column;
    max-height: 150px;
    overflow-y: auto;
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    background: var(--gb-surface);
  }

  .command {
    display: flex;
    gap: 8px;
    align-items: baseline;
    text-align: left;
    padding: 5px 8px;
    border: none;
    border-bottom: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    background: none;
    color: var(--vscode-foreground);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .command:last-child {
    border-bottom: none;
  }

  .command.picked,
  .command:hover {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  .name {
    font-family: var(--gb-mono);
    font-weight: 700;
    color: var(--gb-accent);
    flex: 0 0 auto;
  }

  .command.picked .name {
    color: inherit;
  }

  .desc {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--gb-dim);
  }

  .command.picked .desc {
    color: inherit;
    opacity: 0.85;
  }

  .box {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    border: 1px solid var(--vscode-input-border, var(--gb-rule));
    border-radius: var(--gb-radius);
    background: var(--vscode-input-background);
    padding: 7px 8px;
  }

  .box:focus-within {
    border-color: var(--vscode-focusBorder);
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    min-height: 1.5em;
    resize: none;
    overflow-y: hidden;
    max-height: 220px;
    border: none;
    background: none;
    color: var(--vscode-input-foreground);
    font: inherit;
    font-size: 13px;
    line-height: 1.5;
    padding: 0;
  }

  textarea:focus {
    outline: none;
  }

  .buttons {
    flex: 0 0 auto;
    display: flex;
    justify-content: flex-end;
    gap: 5px;
  }

  button.send,
  button.stop {
    padding: 4px 14px;
    border: 1px solid transparent;
    border-radius: var(--gb-radius);
    font: inherit;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  /* Stop is an outline, not a second solid button — one filled action per row. */
  button.stop {
    background: none;
    border-color: var(--gb-warn);
    color: var(--gb-warn);
  }

  button.send:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .queued {
    display: flex;
    align-items: baseline;
    gap: 7px;
    font-size: var(--gb-meta-size);
    color: var(--gb-dim);
  }

  .queued span {
    flex: 1 1 auto;
  }

  button.link {
    flex: 0 0 auto;
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    font-weight: 700;
    text-decoration: underline;
    color: var(--gb-accent);
    cursor: pointer;
  }
</style>
