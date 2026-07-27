<script lang="ts">
  import type { PermissionMode, UiStatus } from '../../src/shared/protocol';

  interface Props {
    status: UiStatus;
    onSetModel: (modelId: string) => void;
    onSetEffort: (effort: string) => void;
    onSetPermissionMode: (mode: PermissionMode) => void;
    onRestart: () => void;
  }

  let { status, onSetModel, onSetEffort, onSetPermissionMode, onRestart }: Props = $props();

  /**
   * `tone` colours the control so the two modes that can act without asking are impossible to
   * leave switched on by accident. The ids are the protocol's — `default`/`bypassPermissions`,
   * not `ask`/`bypass`.
   */
  const modes: {
    id: PermissionMode;
    label: string;
    hint: string;
    tone: 'neutral' | 'plan' | 'warn' | 'danger';
  }[] = [
    {
      id: 'default',
      label: 'Ask',
      hint: 'Ask — approve every file write and every command individually',
      tone: 'neutral',
    },
    {
      id: 'acceptEdits',
      label: 'Accept edits',
      hint: 'Accept edits — writes apply automatically, commands still ask for approval',
      tone: 'warn',
    },
    {
      id: 'plan',
      label: 'Plan',
      hint: 'Plan — read-only: no writes or commands run until you approve a plan',
      tone: 'plan',
    },
    {
      id: 'bypassPermissions',
      label: 'Bypass',
      hint: 'Bypass — nothing is asked; the agent writes files and runs commands freely',
      tone: 'danger',
    },
  ];

  /**
   * The caution sign rides in the option text: the native dropdown cannot be styled, so this is
   * the only way the warning survives once the list is open.
   */
  function optionLabel(m: (typeof modes)[number]): string {
    return m.tone === 'danger' ? `⚠ ${m.label}` : m.tone === 'warn' ? `${m.label} ⚠` : m.label;
  }

  const model = $derived(status.models.find((m) => m.modelId === status.currentModelId));
  const efforts = $derived(model?.reasoningEfforts ?? []);
  const mode = $derived(modes.find((m) => m.id === status.permissionMode) ?? modes[0]);
</script>

<!--
  The three things you change mid-conversation live next to the box you type in, not two rules
  away at the top of the panel. The old separate warning chip is gone: the control itself is
  tinted and signed, and the composer's rule above picks up the same colour — the state is
  visible without a sentence of prose sitting in the layout permanently.
-->
<div class="bar" class:warn={mode.tone === 'warn'} class:danger={mode.tone === 'danger'}>
  <select
    class="mode {mode.tone}"
    title={mode.hint}
    value={status.permissionMode}
    onchange={(e) => onSetPermissionMode(e.currentTarget.value as PermissionMode)}
  >
    {#each modes as m (m.id)}
      <option value={m.id} title={m.hint}>{optionLabel(m)}</option>
    {/each}
  </select>

  <select
    title="Model"
    value={status.currentModelId ?? ''}
    onchange={(e) => onSetModel(e.currentTarget.value)}
    disabled={status.models.length === 0}
  >
    {#if status.models.length === 0}
      <option value="">{status.agentState === 'stopped' ? 'not started' : 'loading…'}</option>
    {/if}
    {#each status.models as m (m.modelId)}
      <option value={m.modelId}>{m.name}</option>
    {/each}
  </select>

  {#if efforts.length > 0}
    <select
      title="Reasoning effort — how long the model thinks before answering"
      value={status.reasoningEffort ?? ''}
      onchange={(e) => onSetEffort(e.currentTarget.value)}
    >
      {#each efforts as effort (effort.id)}
        <option value={effort.id} title={effort.description}>{effort.label}</option>
      {/each}
    </select>
  {/if}

  <span class="spacer"></span>

  {#if status.agentState === 'stopped'}
    <button class="restart" title="Restart the agent" onclick={onRestart}>Restart</button>
  {/if}
</div>

<style>
  .bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    row-gap: 4px;
    padding: 5px 10px;
    border-top: 2px solid var(--gb-rule-strong);
  }

  /* The section rule carries the warning that used to be a chip — same signal, no extra row. */
  .bar.warn {
    border-top-color: var(--gb-warn);
  }

  .bar.danger {
    border-top-color: var(--gb-danger);
    background: color-mix(in srgb, var(--gb-danger) 7%, transparent);
  }

  .spacer {
    flex: 1 1 auto;
  }

  select {
    max-width: 11em;
    min-width: 0;
    appearance: none;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, var(--gb-rule));
    border-radius: var(--gb-radius);
    font: inherit;
    font-size: var(--gb-kicker-size);
    font-weight: 700;
    padding: 3px 6px;
    cursor: pointer;
  }

  select:disabled {
    cursor: default;
    opacity: 0.6;
  }

  /* Tinted from the theme, never a fixed palette, so the reading survives light and
     high-contrast themes. */
  select.mode.plan {
    color: var(--gb-plan);
    border-color: var(--gb-plan);
  }

  select.mode.warn {
    color: var(--gb-warn);
    border-color: var(--gb-warn);
    background: color-mix(in srgb, var(--gb-warn) 14%, var(--vscode-dropdown-background));
  }

  select.mode.danger {
    color: var(--gb-danger);
    border-color: var(--gb-danger);
    background: color-mix(in srgb, var(--gb-danger) 16%, var(--vscode-dropdown-background));
  }

  button.restart {
    border: none;
    border-radius: var(--gb-radius);
    font-family: var(--gb-heading);
    font-weight: 800;
    font-size: var(--gb-kicker-size);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    padding: 3px 9px;
    cursor: pointer;
  }
</style>
