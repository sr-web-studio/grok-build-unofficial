<script lang="ts">
  import type { AvailableCommand } from '../../src/acp/types';
  import type {
    PermissionMode,
    PromptImage,
    QueuedMessage,
    UiStatus,
  } from '../../src/shared/protocol';
  import { send } from '../ipc';
  import Icon from './Icon.svelte';

  interface Props {
    text: string;
    status: UiStatus;
    commands: AvailableCommand[];
    queuedMessages: QueuedMessage[];
    focusSignal: number;
    onCancel: () => void;
    onClearQueue: () => void;
    onPushQueue: (id?: string) => void;
    onSetModel: (modelId: string) => void;
    onSetEffort: (effort: string) => void;
    onSetPermissionMode: (mode: PermissionMode) => void;
    onRestart: () => void;
  }

  let {
    text = $bindable(),
    status,
    commands,
    queuedMessages,
    focusSignal,
    onCancel,
    onClearQueue,
    onPushQueue,
    onSetModel,
    onSetEffort,
    onSetPermissionMode,
    onRestart,
  }: Props = $props();

  /** Two lines at rest (13px × 1.5 line-height × 2). */
  const MIN_HEIGHT = 39;
  const MAX_HEIGHT = 220;
  const MAX_IMAGES = 6;

  let input = $state<HTMLTextAreaElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let picked = $state(0);
  let attachments = $state<PromptImage[]>([]);
  let sending = $state(false);
  let sendError = $state<string | null>(null);

  const agentState = $derived(status.agentState);
  const busy = $derived(agentState === 'thinking' || agentState === 'awaitingApproval');
  const stopped = $derived(agentState === 'stopped');
  const canSubmit = $derived(
    !sending && Boolean(text.trim() || attachments.length),
  );
  const queuedCount = $derived(queuedMessages.length);

  const modes: {
    id: PermissionMode;
    label: string;
    hint: string;
    tone: 'neutral' | 'plan' | 'warn' | 'danger';
  }[] = [
    {
      id: 'default',
      label: 'Ask',
      hint: 'Ask — approve every file write and every command',
      tone: 'neutral',
    },
    {
      id: 'acceptEdits',
      label: 'Accept edits',
      hint: 'Accept edits — writes auto-apply, commands still ask',
      tone: 'warn',
    },
    {
      id: 'plan',
      label: 'Plan',
      hint: 'Plan — read-only until you approve a plan',
      tone: 'plan',
    },
    {
      id: 'bypassPermissions',
      label: 'Bypass',
      hint: 'Bypass — no prompts; agent writes and runs freely',
      tone: 'danger',
    },
  ];

  function optionLabel(m: (typeof modes)[number]): string {
    return m.tone === 'danger' ? `⚠ ${m.label}` : m.tone === 'warn' ? `${m.label} ⚠` : m.label;
  }

  const model = $derived(status.models.find((m) => m.modelId === status.currentModelId));
  const efforts = $derived(model?.reasoningEfforts ?? []);
  const mode = $derived(modes.find((m) => m.id === status.permissionMode) ?? modes[0]);

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
    if (picked >= matches.length) picked = 0;
  });

  /**
   * Grow with content, but never trust `height: auto` alone: in a flex column that can
   * briefly report the remaining viewport as scrollHeight and lock the box at MAX.
   * Always collapse to MIN first, measure content, then clamp.
   */
  function autogrow(el: HTMLTextAreaElement) {
    el.style.height = `${MIN_HEIGHT}px`;
    el.style.overflowY = 'hidden';
    // scrollHeight after the min reset is content-only (not a prior inflated height).
    const content = el.scrollHeight;
    const next = Math.max(MIN_HEIGHT, Math.min(content, MAX_HEIGHT));
    el.style.height = `${next}px`;
    el.style.overflowY = content > MAX_HEIGHT ? 'auto' : 'hidden';
  }

  $effect(() => {
    // Track draft so clear-on-send / insertText re-clamp height.
    void text;
    const el = input;
    if (!el) return;
    // Layout may still be settling right after bind:this / status re-render.
    requestAnimationFrame(() => {
      if (input === el) autogrow(el);
    });
  });

  function accept(name: string) {
    text = `/${name} `;
    picked = 0;
    input?.focus();
    if (input) autogrow(input);
  }

  async function submit() {
    if (sending) return;
    const value = text.trim();
    if (!value && attachments.length === 0) return;
    sendError = null;
    sending = true;
    const snapshot = [...attachments];
    const promptText = value || (snapshot.length ? 'Please look at the attached image(s).' : '');
    try {
      // Pure slash commands → host utility/modal path (no chat pollution).
      if (value && /^\/[\w:-]+(?:\s+\S[\s\S]*)?$/.test(value) && snapshot.length === 0) {
        send({ type: 'slashCommand', text: value });
        text = '';
        if (input) {
          autogrow(input);
          input.focus();
        }
        return;
      }
      // Stage each image as its own message — one big prompt+base64 postMessage is dropped
      // silently by VS Code when the payload is large.
      const stagedIds: string[] = [];
      for (const img of snapshot) {
        const id = img.id || `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        send({
          type: 'stageImage',
          id,
          mimeType: img.mimeType || 'image/jpeg',
          data: img.data,
          preview: img.preview,
          name: img.name,
        });
        stagedIds.push(id);
      }
      send({
        type: 'prompt',
        text: promptText,
        stagedImageIds: stagedIds.length ? stagedIds : undefined,
      });
      text = '';
      attachments = [];
      if (input) {
        autogrow(input);
        input.focus();
      }
    } catch (err) {
      sendError =
        err instanceof Error
          ? err.message
          : 'Could not send (image may be too large). Try a smaller screenshot.';
      // Keep attachments so the user can retry.
    } finally {
      sending = false;
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

  async function addFiles(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    for (const file of list) {
      if (attachments.length >= MAX_IMAGES) break;
      try {
        // Compress before postMessage — large base64 payloads can silently fail IPC.
        const prepared = await prepareImage(file);
        attachments = [
          ...attachments,
          {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            mimeType: prepared.mimeType,
            data: prepared.data,
            preview: prepared.preview,
            name: file.name || prepared.name,
          },
        ];
      } catch {
        // Fall back to raw read if canvas compress fails (e.g. SVG).
        const data = await readAsBase64(file);
        attachments = [
          ...attachments,
          {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            mimeType: file.type || 'image/png',
            data,
            preview: data.length < 40_000 ? data : undefined,
            name: file.name,
          },
        ];
      }
    }
  }

  function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Downscale large screenshots so host↔webview messages stay under VS Code IPC limits
   * and the agent can still see the picture.
   */
  function prepareImage(
    file: File,
  ): Promise<{ data: string; preview: string; mimeType: string; name: string }> {
    const MAX_EDGE = 1280;
    const PREVIEW_EDGE = 96;
    const JPEG_QUALITY = 0.72;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('no canvas'));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          // Always JPEG after resize — screenshots as PNG explode IPC size.
          const mimeType = 'image/jpeg';
          const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          const comma = dataUrl.indexOf(',');
          const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;

          // Tiny thumb for the chat bubble after host strips full `data`.
          const pScale = Math.min(1, PREVIEW_EDGE / Math.max(width, height));
          const pw = Math.max(1, Math.round(width * pScale));
          const ph = Math.max(1, Math.round(height * pScale));
          const pCanvas = document.createElement('canvas');
          pCanvas.width = pw;
          pCanvas.height = ph;
          const pCtx = pCanvas.getContext('2d');
          if (!pCtx) {
            reject(new Error('no canvas'));
            return;
          }
          pCtx.drawImage(canvas, 0, 0, pw, ph);
          const pUrl = pCanvas.toDataURL('image/jpeg', 0.7);
          const pComma = pUrl.indexOf(',');
          const preview = pComma >= 0 ? pUrl.slice(pComma + 1) : pUrl;

          resolve({
            data,
            preview,
            mimeType,
            name: file.name || 'paste.jpg',
          });
        } catch (err) {
          reject(err);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image load failed'));
      };
      img.src = url;
    });
  }

  function onPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) images.push(file);
      }
    }
    if (images.length === 0) return;
    event.preventDefault();
    void addFiles(images);
  }

  function removeAttachment(id: string) {
    attachments = attachments.filter((a) => a.id !== id);
  }

  function thumb(img: PromptImage): string {
    if (img.preview) return `data:image/jpeg;base64,${img.preview}`;
    if (img.data) return `data:${img.mimeType};base64,${img.data}`;
    if (img.webviewUri) return img.webviewUri;
    return '';
  }

  function preview(t: string): string {
    const s = t.trim() || '(image)';
    return s.length > 90 ? `${s.slice(0, 87)}…` : s;
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

  {#if queuedCount > 0}
    <div class="queue">
      <div class="queue-head">
        <span class="queue-badge">{queuedCount}</span>
        <span class="queue-title">Waiting to send</span>
        <button class="link strong" type="button" onclick={() => onPushQueue()}>Send all now</button>
        <button class="link" type="button" onclick={onClearQueue}>Clear</button>
      </div>
      <ul class="queue-list">
        {#each queuedMessages as item (item.id)}
          <li>
            <span class="q-text" title={item.text}>{preview(item.text)}</span>
            {#if item.images?.length}
              <span class="q-meta">{item.images.length} img</span>
            {/if}
            <button class="link strong tiny" type="button" onclick={() => onPushQueue(item.id)}>Send</button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="box">
    {#if attachments.length > 0}
      {@const maxShow = 4}
      {@const shown = attachments.slice(0, maxShow)}
      {@const extra = attachments.length - shown.length}
      <div class="thumbs">
        {#each shown as img (img.id)}
          <div class="thumb">
            <img src={thumb(img)} alt={img.name ?? 'attachment'} />
            <button class="rm" type="button" title="Remove" aria-label="Remove attachment" onclick={() => removeAttachment(img.id)}>
              <Icon name="close" size={10} />
            </button>
          </div>
        {/each}
        {#if extra > 0}
          <button
            class="thumb more"
            type="button"
            title="{extra} more — click to remove the oldest hidden one"
            onclick={() => {
              // Drop the first hidden attachment so the user can clear overflow without a full clear.
              const hidden = attachments[maxShow];
              if (hidden) removeAttachment(hidden.id);
            }}
          >
            +{extra}
          </button>
        {/if}
      </div>
    {/if}
    <textarea
      bind:this={input}
      bind:value={text}
      rows="2"
      placeholder={busy ? 'Queue a follow-up…' : 'Ask, paste a screenshot, or / for commands…'}
      onkeydown={onKeydown}
      onpaste={onPaste}
      oninput={(e) => autogrow(e.currentTarget)}
    ></textarea>
  </div>

  {#if sendError}
    <div class="send-error" role="alert">{sendError}</div>
  {/if}

  <div class="toolbar" class:warn={mode.tone === 'warn'} class:danger={mode.tone === 'danger'}>
    <input
      bind:this={fileInput}
      type="file"
      accept="image/*"
      multiple
      class="file"
      onchange={(e) => {
        const files = e.currentTarget.files;
        if (files?.length) void addFiles(files);
        e.currentTarget.value = '';
      }}
    />
    <button
      class="icon-btn"
      type="button"
      title="Attach image"
      aria-label="Attach image"
      onclick={() => fileInput?.click()}
    >
      <Icon name="image" size={14} />
    </button>

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
        <option value="">{stopped ? 'not started' : 'loading…'}</option>
      {/if}
      {#each status.models as m (m.modelId)}
        <option value={m.modelId}>{m.name}</option>
      {/each}
    </select>

    {#if efforts.length > 0}
      <select
        title="Reasoning effort"
        value={status.reasoningEffort ?? ''}
        onchange={(e) => onSetEffort(e.currentTarget.value)}
      >
        {#each efforts as effort (effort.id)}
          <option value={effort.id} title={effort.description}>{effort.label}</option>
        {/each}
      </select>
    {/if}

    <span class="spacer"></span>

    {#if stopped}
      <button class="restart" type="button" title="Restart the agent" onclick={onRestart}>Restart</button>
    {/if}
    {#if busy}
      <button class="stop" type="button" onclick={onCancel} title="Stop the current turn (Esc)">Stop</button>
    {/if}
    <button class="send" type="button" onclick={() => void submit()} disabled={!canSubmit}>
      {sending ? 'Sending…' : busy ? 'Queue' : stopped ? 'Start' : 'Send'}
    </button>
  </div>
</div>

<style>
  .composer {
    flex: 0 0 auto;
    padding: 8px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
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
    padding: 7px 10px;
    border: none;
    border-bottom: 1px solid var(--gb-rule);
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

  .queue {
    border: 1px solid color-mix(in srgb, var(--gb-warn) 55%, var(--gb-rule));
    border-left: 3px solid var(--gb-warn);
    border-radius: var(--gb-radius);
    background: color-mix(in srgb, var(--gb-warn) 12%, var(--vscode-editor-background));
    overflow: hidden;
  }

  .queue-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--gb-warn) 30%, transparent);
  }

  .queue-badge {
    flex: 0 0 auto;
    min-width: 1.4em;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--gb-warn);
    color: var(--vscode-editor-background);
    font-family: var(--gb-mono);
    font-weight: 800;
    font-size: 11px;
    text-align: center;
  }

  .queue-title {
    flex: 1 1 auto;
    font-size: var(--gb-meta-size);
    font-weight: 700;
  }

  .queue-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 9em;
    overflow: auto;
  }

  .queue-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    font-size: 12px;
  }

  .q-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .q-meta {
    flex: 0 0 auto;
    color: var(--gb-dim);
    font-size: 11px;
  }

  .box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid var(--vscode-input-border, var(--gb-rule));
    border-radius: var(--gb-radius-lg);
    background: var(--vscode-input-background);
    padding: 10px 12px;
  }

  .box:focus-within {
    border-color: var(--vscode-focusBorder);
  }

  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .thumb {
    position: relative;
    width: 36px;
    height: 36px;
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius-sm);
    overflow: hidden;
    background: var(--gb-surface-sunken);
    flex: 0 0 auto;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .thumb.more {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--gb-rule);
    background: color-mix(in srgb, var(--gb-accent) 10%, var(--gb-surface-sunken));
    color: var(--gb-dim);
    font: inherit;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
  }

  .thumb.more:hover {
    color: var(--vscode-foreground);
    border-color: var(--gb-accent);
  }

  .rm {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    padding: 0;
    border: none;
    background: color-mix(in srgb, var(--vscode-editor-background) 85%, transparent);
    color: var(--vscode-foreground);
    cursor: pointer;
    line-height: 1;
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    min-height: 39px; /* 2 × 13px × 1.5 */
    height: 39px;
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

  .send-error {
    padding: 5px 8px;
    border-left: 3px solid var(--gb-danger);
    background: color-mix(in srgb, var(--gb-danger) 12%, transparent);
    color: var(--gb-danger);
    font-size: 11px;
  }

  .file {
    display: none;
  }

  /* First control on the picker row — same height as the selects. */
  .icon-btn {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--vscode-dropdown-border, var(--gb-rule));
    border-radius: var(--gb-radius-sm);
    background: var(--vscode-dropdown-background);
    color: var(--gb-dim);
    cursor: pointer;
  }

  .icon-btn:hover {
    color: var(--vscode-foreground);
    border-color: var(--vscode-focusBorder, var(--gb-accent));
  }

  /* Permission + model + effort + Send on one row under the text box. */
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    row-gap: 6px;
    padding: 4px 0 0;
    border-top: 1px solid var(--gb-rule);
    padding-top: 10px;
  }

  .toolbar.warn {
    border-top-color: var(--gb-warn);
  }

  .toolbar.danger {
    border-top-color: var(--gb-danger);
  }

  .spacer {
    flex: 1 1 auto;
  }

  select {
    max-width: 10.5em;
    min-width: 0;
    appearance: none;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, var(--gb-rule));
    border-radius: var(--gb-radius-sm);
    font: inherit;
    font-size: var(--gb-kicker-size);
    font-weight: 700;
    padding: 5px 9px;
    cursor: pointer;
  }

  select:disabled {
    cursor: default;
    opacity: 0.6;
  }

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

  button.send,
  button.stop,
  button.restart {
    padding: 5px 14px;
    border: 1px solid transparent;
    border-radius: var(--gb-radius-sm);
    font: inherit;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  button.send {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  button.send:disabled {
    opacity: 0.5;
    cursor: default;
  }

  button.stop {
    background: none;
    border-color: var(--gb-warn);
    color: var(--gb-warn);
  }

  button.restart {
    background: var(--vscode-button-secondaryBackground, transparent);
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border-color: var(--gb-rule);
  }

  button.link {
    flex: 0 0 auto;
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    text-decoration: underline;
    color: var(--gb-accent);
    cursor: pointer;
  }

  button.link.strong {
    text-decoration: none;
    padding: 2px 8px;
    border: 1px solid var(--gb-accent);
    background: color-mix(in srgb, var(--gb-accent) 16%, transparent);
  }

  button.link.tiny {
    padding: 1px 6px;
    font-size: 10px;
  }
</style>
