/**
 * Scenarios for the webview harness.
 *
 * Each one drives the panel with the exact `HostMessage` shapes `src/host/session.ts` emits, so
 * what you see here is what the extension renders — no approximation. Timed scenarios use
 * `sleep` to reproduce streaming.
 */

const CWD = 'e:/projects/grok-build-unofficial';

let seq = 0;
const id = (prefix) => `${prefix}-${++seq}`;

export function baseStatus(overrides = {}) {
  return {
    agentState: 'idle',
    agentVersion: '0.2.112',
    sessionId: 'c0ffee00-1111-2222-3333-444455556666',
    cwd: CWD,
    isGitRepo: true,
    permissionMode: 'default',
    currentModelId: 'grok-4.5',
    reasoningEffort: 'high',
    models: [
      // Efforts are ACP modes (`{ id, label }`), not bare strings — a plain array of strings
      // keys the <select> on `undefined` twice and Svelte aborts the whole render.
      {
        modelId: 'grok-4.5',
        name: 'Grok 4.5',
        contextTokens: 2000000,
        supportsReasoningEffort: true,
        reasoningEfforts: [
          { id: 'low', label: 'Low', description: 'Answer quickly, think little' },
          { id: 'medium', label: 'Medium', description: 'Balance speed and depth' },
          { id: 'high', label: 'High', description: 'Think longer before answering' },
        ],
      },
      { modelId: 'grok-code-fast-1', name: 'Grok Code Fast 1', contextTokens: 256000 },
    ],
    availableCommands: [
      { name: 'compact', description: 'Summarise the conversation so far' },
      { name: 'clear', description: 'Start a fresh session' },
      { name: 'review', description: 'Review the working tree', input: { hint: 'optional path' } },
    ],
    totals: { inputTokens: 60273, outputTokens: 1313, cachedReadTokens: 41210, reasoningTokens: 840, costUsd: 0.45394, turns: 3 },
    contextTokens: 2000000,
    lastTurnTotalTokens: 61586,
    queuedCount: 0,
    ...overrides,
  };
}

const usage = {
  inputTokens: 21044,
  outputTokens: 402,
  totalTokens: 21446,
  cachedReadTokens: 18990,
  reasoningTokens: 260,
  modelCalls: 3,
  apiDurationMs: 11840,
  costUsdTicks: 151_300_000,
};

const OLD_FILE = `export function formatCost(ticks) {
  return '$' + (ticks / 1e9).toFixed(4);
}
`;

const NEW_FILE = `export function formatCost(ticks) {
  if (!Number.isFinite(ticks)) return '—';
  const usd = ticks / 1e9;
  return usd < 0.01 ? '<$0.01' : '$' + usd.toFixed(2);
}
`;

function textBlock(role, text, extra = {}) {
  return { id: id('t'), ts: Date.now(), kind: 'text', role, text, streaming: false, ...extra };
}

function toolBlock(overrides) {
  return {
    id: id('tool'),
    ts: Date.now(),
    kind: 'tool',
    toolCallId: id('call'),
    name: 'read_file',
    label: 'Read',
    toolKind: 'read',
    title: 'Read a file',
    status: 'completed',
    readOnly: true,
    input: {},
    locations: [],
    contents: [],
    waiting: false,
    ...overrides,
  };
}

/** Every block kind the transcript can render, in one screen. */
function showcaseBlocks() {
  return [
    textBlock('user', 'Make the cost display in the status line readable — four decimals is noise.'),
    {
      id: id('think'),
      ts: Date.now(),
      kind: 'thinking',
      text: 'The status line formats `costUsdTicks / 1e9` with four decimals. For sub-cent turns that is\nnoise; for real turns two decimals is plenty. I should also guard against a missing value,\nwhich currently renders as `$NaN`.',
      streaming: false,
      durationMs: 4200,
    },
    toolBlock({
      name: 'grep',
      label: 'Search',
      toolKind: 'search',
      input: { pattern: 'costUsdTicks', path: 'webview' },
      contents: [{ type: 'text', text: 'webview/components/StatusLine.svelte:41\nwebview/components/TurnFooter.svelte:23' }],
    }),
    toolBlock({
      input: { path: `${CWD}/webview/components/StatusLine.svelte` },
      locations: [{ path: `${CWD}/webview/components/StatusLine.svelte`, line: 41 }],
      contents: [{ type: 'text', text: OLD_FILE }],
    }),
    toolBlock({
      name: 'search_replace',
      label: 'Edit',
      toolKind: 'edit',
      readOnly: false,
      input: { path: `${CWD}/webview/components/StatusLine.svelte` },
      locations: [{ path: `${CWD}/webview/components/StatusLine.svelte`, line: 41 }],
      contents: [{ type: 'diff', path: `${CWD}/webview/components/StatusLine.svelte`, oldText: OLD_FILE, newText: NEW_FILE }],
    }),
    toolBlock({
      name: 'run_terminal_command',
      label: 'Run Command',
      toolKind: 'execute',
      readOnly: false,
      input: { command: 'npm run typecheck' },
      contents: [{ type: 'text', text: '> tsc --noEmit -p tsconfig.json\n\n====================================\nsvelte-check found 0 errors and 0 warnings' }],
    }),
    toolBlock({
      name: 'run_terminal_command',
      label: 'Run Command',
      toolKind: 'execute',
      readOnly: false,
      status: 'failed',
      input: { command: 'npm test' },
      error: 'exit code 1',
      contents: [{ type: 'text', text: 'npm error Missing script: "test"' }],
    }),
    {
      id: id('plan'),
      ts: Date.now(),
      kind: 'plan',
      entries: [
        { content: 'Find every place the cost is formatted', status: 'completed', priority: 'high' },
        { content: 'Round to two decimals and guard NaN', status: 'in_progress', priority: 'high' },
        { content: 'Typecheck and rebuild', status: 'pending', priority: 'medium' },
      ],
    },
    textBlock(
      'assistant',
      'Done — `formatCost` now clamps to two decimals and shows `<$0.01` for sub-cent turns.\n\n' +
        'Two places used the old helper:\n\n' +
        '1. `StatusLine.svelte` — the session total\n' +
        '2. `TurnFooter.svelte` — the per-turn footer\n\n' +
        'Both read from the same helper now:\n\n' +
        '```ts\nconst usd = ticks / 1e9;\nreturn usd < 0.01 ? \'<$0.01\' : `$${usd.toFixed(2)}`;\n```\n\n' +
        // A table is the widest thing grok emits, so the showcase carries one — it is how the
        // sidebar's horizontal-scroll rule gets checked at 300px.
        '| Input | Before | After |\n' +
        '| --- | --- | --- |\n' +
        '| `0` | `$0.00` | `$0.00` |\n' +
        '| `4_500_000` | `$0.0045` | `<$0.01` |\n' +
        '| `1_234_500_000` | `$1.2345` | `$1.23` |\n' +
        '| `NaN` | `$NaN` | `—` |\n\n' +
        'Typecheck is clean. Anything with `NaN` renders as `—` instead of `$NaN`.',
    ),
    { id: id('notice'), ts: Date.now(), kind: 'notice', level: 'info', text: 'Applied 1 file edit through the workspace edit API — undo with Ctrl+Z.' },
    { id: id('notice'), ts: Date.now(), kind: 'notice', level: 'warn', text: 'Plan mode refused a write to package.json.' },
    { id: id('notice'), ts: Date.now(), kind: 'notice', level: 'error', text: 'grok exited with code 1 while starting the session.' },
    { id: id('turn'), ts: Date.now(), kind: 'turn', stopReason: 'end_turn', usage },
  ];
}

function approvalBlocks() {
  return [
    textBlock('user', 'Rewrite the cost formatter and run the typecheck.'),
    {
      id: id('appr'),
      ts: Date.now(),
      kind: 'approval',
      request: {
        requestId: 'req-write-1',
        kind: 'write',
        title: 'Write webview/components/StatusLine.svelte',
        path: `${CWD}/webview/components/StatusLine.svelte`,
        oldText: OLD_FILE,
        newText: NEW_FILE,
        alwaysScope: 'Write(webview/**)',
      },
    },
    {
      id: id('appr'),
      ts: Date.now(),
      kind: 'approval',
      request: {
        requestId: 'req-cmd-1',
        kind: 'command',
        title: 'Run npm run typecheck',
        command: 'npm run typecheck',
        cwd: CWD,
        alwaysScope: 'Bash(npm run typecheck:*)',
      },
    },
    {
      id: id('appr'),
      ts: Date.now(),
      kind: 'approval',
      decision: 'once',
      request: {
        requestId: 'req-cmd-0',
        kind: 'command',
        title: 'Run git status --porcelain',
        command: 'git status --porcelain',
        cwd: CWD,
      },
    },
  ];
}

export const scenarios = [
  {
    id: 'showcase',
    label: 'Everything (all block kinds)',
    async run({ post }) {
      post({ type: 'state', state: { status: baseStatus(), blocks: showcaseBlocks(), showThinking: true, autoExpandThinking: false } });
    },
  },

  {
    id: 'stream',
    label: 'Live turn (streaming)',
    async run({ post, sleep, cancelled }) {
      post({ type: 'state', state: { status: baseStatus({ agentState: 'thinking' }), blocks: [], showThinking: true, autoExpandThinking: true } });
      post({ type: 'blockAdd', block: textBlock('user', 'Why does the status line show $NaN after a cancelled turn?') });

      const think = { id: id('think'), ts: Date.now(), kind: 'thinking', text: '', streaming: true };
      post({ type: 'blockAdd', block: think });
      for (const chunk of ['A cancelled turn has no usage payload, ', 'so `costUsdTicks` is undefined. ', 'Dividing undefined by 1e9 gives NaN, ', 'and `toFixed` happily prints it.']) {
        await sleep(280);
        if (cancelled()) return;
        post({ type: 'blockPatch', id: think.id, patch: {}, appendText: chunk });
      }
      post({ type: 'blockPatch', id: think.id, patch: { streaming: false, durationMs: 1120 } });

      const tool = toolBlock({ status: 'in_progress', input: { path: `${CWD}/webview/components/StatusLine.svelte` }, locations: [{ path: `${CWD}/webview/components/StatusLine.svelte`, line: 41 }], contents: [] });
      post({ type: 'blockAdd', block: tool });
      await sleep(700);
      if (cancelled()) return;
      post({ type: 'blockPatch', id: tool.id, patch: { status: 'completed', contents: [{ type: 'text', text: OLD_FILE }] } });

      const cmd = toolBlock({ name: 'run_terminal_command', label: 'Run Command', toolKind: 'execute', readOnly: false, status: 'in_progress', input: { command: 'npm run typecheck' }, liveOutput: '' });
      post({ type: 'blockAdd', block: cmd });
      for (const line of ['> tsc --noEmit -p tsconfig.json\n', '\n', '====================================\n', 'svelte-check found 0 errors and 0 warnings\n']) {
        await sleep(320);
        if (cancelled()) return;
        post({ type: 'blockPatch', id: cmd.id, patch: {}, appendOutput: line });
      }
      post({ type: 'blockPatch', id: cmd.id, patch: { status: 'completed' } });

      const reply = textBlock('assistant', '', { streaming: true });
      post({ type: 'blockAdd', block: reply });
      const words = 'Because a cancelled turn carries no usage, so `costUsdTicks` is `undefined`. The formatter now returns `—` for a non-finite value and `<$0.01` for sub-cent turns.'.split(' ');
      for (const word of words) {
        await sleep(55);
        if (cancelled()) return;
        post({ type: 'blockPatch', id: reply.id, patch: {}, appendText: `${word} ` });
      }
      post({ type: 'blockPatch', id: reply.id, patch: { streaming: false } });
      post({ type: 'blockAdd', block: { id: id('turn'), ts: Date.now(), kind: 'turn', stopReason: 'end_turn', usage } });
      post({ type: 'status', status: baseStatus({ agentState: 'idle' }) });
    },
  },

  {
    id: 'queue',
    label: 'Busy turn + queued messages',
    async run({ post }) {
      const blocks = [
        textBlock('user', 'Refactor the cost formatter.'),
        { id: id('think'), ts: Date.now(), kind: 'thinking', text: 'Locating every caller before touching the helper…', streaming: true },
        textBlock('user', 'Also update the tests while you are in there.', { queued: true }),
        textBlock('user', 'And run the typecheck at the end.', { queued: true }),
      ];
      post({ type: 'state', state: { status: baseStatus({ agentState: 'thinking', queuedCount: 2 }), blocks, showThinking: true, autoExpandThinking: true } });
    },
  },

  {
    id: 'approvals',
    label: 'Approval gates (write + command)',
    async run({ post }) {
      post({ type: 'state', state: { status: baseStatus({ agentState: 'awaitingApproval' }), blocks: approvalBlocks(), showThinking: true, autoExpandThinking: false } });
    },
  },

  {
    id: 'plan',
    label: 'Plan mode + exit_plan_mode',
    async run({ post }) {
      const blocks = [
        textBlock('user', 'Plan the migration of the status line to a shared cost helper.'),
        {
          id: id('plan'),
          ts: Date.now(),
          kind: 'plan',
          entries: [
            { content: 'Inventory the formatting call sites', status: 'completed', priority: 'high' },
            { content: 'Design one helper both callers share', status: 'completed', priority: 'high' },
            { content: 'Write the helper and switch both callers', status: 'pending', priority: 'medium' },
          ],
        },
        {
          id: id('prop'),
          ts: Date.now(),
          kind: 'proposedPlan',
          requestId: 'plan-1',
          content:
            '## Shared cost helper\n\n' +
            '1. Add `webview/format.ts` with `formatCost(ticks?: number): string`\n' +
            '2. Return `—` when the value is missing or non-finite\n' +
            '3. Return `<$0.01` below a cent, otherwise two decimals\n' +
            '4. Switch `StatusLine.svelte` and `TurnFooter.svelte` to it\n' +
            '5. `npm run typecheck && npm run build`\n\n' +
            'No behaviour outside the two components changes.',
        },
      ];
      post({ type: 'state', state: { status: baseStatus({ permissionMode: 'plan', agentState: 'awaitingApproval' }), blocks, showThinking: true, autoExpandThinking: false } });
    },
  },

  {
    id: 'question',
    label: 'Agent asks a question',
    async run({ post }) {
      const blocks = [
        textBlock('user', 'Add persistence to the session list.'),
        {
          id: id('q'),
          ts: Date.now(),
          kind: 'question',
          requestId: 'q-1',
          answered: false,
          questions: [
            {
              header: 'Storage',
              question: 'Where should the session index live?',
              multiSelect: false,
              options: [
                { label: 'workspaceState', description: 'Per-folder, cleared with the workspace' },
                { label: 'globalState', description: 'Follows the user across folders' },
                { label: 'A JSON file in .grok/', description: 'Visible and greppable, but needs gitignoring' },
              ],
            },
            {
              header: 'Retention',
              question: 'Which sessions should be pruned automatically?',
              multiSelect: true,
              options: [
                { label: 'Older than 30 days' },
                { label: 'Empty sessions (no prompts)' },
                { label: 'Sessions from deleted folders' },
              ],
            },
          ],
        },
      ];
      post({ type: 'state', state: { status: baseStatus({ agentState: 'awaitingApproval' }), blocks, showThinking: true, autoExpandThinking: false } });
    },
  },

  {
    id: 'sessions',
    label: 'History + rewind lists',
    async run({ post }) {
      post({ type: 'state', state: { status: baseStatus(), blocks: showcaseBlocks().slice(0, 3), showThinking: true, autoExpandThinking: false } });
      post({
        type: 'sessions',
        sessions: [
          { sessionId: 's1', title: 'Readable cost formatting in the status line', cwd: CWD, updatedAt: Date.now() - 4 * 60000 },
          { sessionId: 's2', title: 'ACP method probe: which _x.ai methods answer', cwd: CWD, updatedAt: Date.now() - 3 * 3600_000 },
          { sessionId: 's3', title: 'Queued interjection lifecycle', cwd: CWD, updatedAt: Date.now() - 26 * 3600_000 },
        ],
      });
      post({
        type: 'rewindPoints',
        points: [
          { id: '0', label: 'Make the cost display readable', ts: Date.now() - 9 * 60000 },
          { id: '1', label: 'Also update the tests', ts: Date.now() - 5 * 60000 },
          { id: '2', label: 'Run the typecheck', ts: Date.now() - 60000 },
        ],
      });
    },
  },

  {
    id: 'nogit',
    label: 'Not a git repo (worktrees disabled)',
    async run({ post }) {
      post({ type: 'state', state: { status: baseStatus({ isGitRepo: false }), blocks: [], showThinking: true, autoExpandThinking: false } });
      post({ type: 'rewindPoints', points: [] });
    },
  },

  {
    id: 'stopped',
    label: 'Agent stopped (error)',
    async run({ post }) {
      post({
        type: 'state',
        state: {
          status: baseStatus({ agentState: 'stopped', models: [], currentModelId: undefined, error: 'grok exited with code 1' }),
          blocks: [{ id: id('notice'), ts: Date.now(), kind: 'notice', level: 'error', text: 'grok exited with code 1. Check the protocol log for the failing frame.' }],
          showThinking: true,
          autoExpandThinking: false,
        },
      });
    },
  },

  {
    id: 'empty',
    label: 'Empty session',
    async run({ post }) {
      post({ type: 'state', state: { status: baseStatus(), blocks: [], showThinking: true, autoExpandThinking: false } });
    },
  },
];
