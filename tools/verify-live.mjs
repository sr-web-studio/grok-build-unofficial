#!/usr/bin/env node
/**
 * Live smoke test for every protocol assumption the extension depends on.
 *
 * Unlike `acp-probe.mjs` (which records whatever happens) this asserts. Run it after a grok
 * upgrade: if xAI renames a method or changes a payload shape, a check here goes RED instead of
 * the extension quietly losing a feature.
 *
 *   node tools/verify-live.mjs [--model grok-4.5] [--keep] [--no-prompt]
 *
 * It spawns a private backend (`--no-leader`) in a scratch git repo, so it never touches the
 * sessions you use in the TUI. One short prompt is sent — a few cents of tokens — unless you pass
 * `--no-prompt`, which keeps the run free and skips only the turn-dependent checks.
 *
 * Method names come from `tools/probe-methods.mjs`; this file only re-checks the ones the
 * extension actually calls, plus the four it must *not* call (they exist in grok but only on the
 * private leader channel, so an ACP client gets -32601).
 */

import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const argv = process.argv.slice(2);
const opts = { model: null, keep: false, prompt: true };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--model') opts.model = argv[++i];
  else if (argv[i] === '--keep') opts.keep = true;
  else if (argv[i] === '--no-prompt') opts.prompt = false;
  else throw new Error(`unknown flag ${argv[i]}`);
}

/** Windows keeps the scratch dir locked for a moment after grok exits. */
function safeRm(dir) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},300)']);
    }
  }
  return false;
}

// A real git repo: the worktree family refuses to work anywhere else.
const cwd = join(projectRoot, 'recordings', 'verify-cwd');
safeRm(cwd);
mkdirSync(cwd, { recursive: true });
writeFileSync(join(cwd, 'README.md'), '# verify repo\n', 'utf8');
{
  const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'verify@example.com');
  git('config', 'user.name', 'verify');
  git('add', '.');
  git('commit', '-qm', 'init');
}

// Never let a live key reach stdout or the report; grok echoes MCP config in some payloads.
const SECRET_PATTERNS = [/\b(rpa_[A-Za-z0-9_-]{10,})\b/g, /\b(xai-[A-Za-z0-9_-]{10,})\b/g, /\b(sk-[A-Za-z0-9_-]{10,})\b/g];
const redact = (text) => SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, 'REDACTED'), text);

/** grok reports repo paths with mixed separators and drive-letter case, so compare loosely. */
function samePath(a, b) {
  if (typeof a !== 'string') return false;
  const norm = (p) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

/** Several extension results are wrapped a second time: `{"result": {...}}` inside `result`. */
function unwrap(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'result' in value) {
    return value.result;
  }
  return value;
}

// ---------------------------------------------------------------- results

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${mark}  ${name}${detail ? ` — ${redact(detail)}` : ''}`);
}
function note(name, detail) {
  results.push({ name, ok: null, detail });
  console.log(`\x1b[90mNOTE  ${name} — ${redact(detail)}\x1b[0m`);
}
function skip(name, why) {
  results.push({ name, ok: null, detail: `skipped — ${why}` });
  console.log(`\x1b[90mSKIP  ${name} — ${why}\x1b[0m`);
}

// ---------------------------------------------------------------- transport

const grokBin = process.env.GROK_BIN ?? 'grok';
// Order is load-bearing: global flags, then `agent`, then agent flags, then `stdio`.
const args = ['--permission-mode', 'bypassPermissions', 'agent'];
if (opts.model) args.push('--model', opts.model);
args.push('--no-leader', 'stdio');

console.log(`spawning: ${grokBin} ${args.join(' ')}\n  cwd=${cwd}\n`);
const child = spawn(grokBin, args, {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});

const stderrText = [];
child.stderr.on('data', (d) => stderrText.push(d.toString()));

let nextId = 1;
const pending = new Map();
const seenMethods = new Set();
const seenUpdates = new Set();
const seenAgentRequests = new Set();
const toolCalls = [];
let turnUsage = null;
let sawPromptIndex = false;
let sawXaiToolMeta = false;

/** `_x.ai/git/worktree/status` is a notification, not a method — this is how we observe it. */
const worktreeStatuses = [];
let worktreeWaiter = null;

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}
function request(method, params) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej, method });
    send({ jsonrpc: '2.0', id, method, params });
  });
}
function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}
function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

const terminals = new Map();

async function handleAgentRequest(frame) {
  const { id, method, params } = frame;
  seenAgentRequests.add(method);
  try {
    switch (method) {
      case 'fs/read_text_file':
        return respond(id, { content: readFileSync(params.path, 'utf8') });
      case 'fs/write_text_file':
        mkdirSync(dirname(params.path), { recursive: true });
        writeFileSync(params.path, params.content, 'utf8');
        return respond(id, {});
      case 'session/request_permission': {
        const options = params.options ?? [];
        return respond(id, {
          outcome: { outcome: 'selected', optionId: options[0]?.optionId ?? options[0]?.id },
        });
      }
      case 'terminal/create': {
        const proc = spawn(params.command, params.args ?? [], { cwd: params.cwd ?? cwd, shell: true });
        const terminalId = `verify-${terminals.size + 1}`;
        const state = { proc, output: '', exit: null, waiters: [] };
        proc.stdout.on('data', (d) => (state.output += d.toString()));
        proc.stderr.on('data', (d) => (state.output += d.toString()));
        proc.on('exit', (code, signal) => {
          state.exit = { exitCode: code, signal };
          state.waiters.forEach((w) => w(state.exit));
          state.waiters = [];
        });
        terminals.set(terminalId, state);
        return respond(id, { terminalId });
      }
      case 'terminal/output': {
        const t = terminals.get(params.terminalId);
        return respond(id, { output: t?.output ?? '', truncated: false, exitStatus: t?.exit ?? null });
      }
      case 'terminal/wait_for_exit': {
        const t = terminals.get(params.terminalId);
        if (!t) return respondError(id, -32602, 'unknown terminal');
        return respond(id, t.exit ?? (await new Promise((r) => t.waiters.push(r))));
      }
      case 'terminal/kill':
        terminals.get(params.terminalId)?.proc.kill();
        return respond(id, {});
      case 'terminal/release':
        terminals.delete(params.terminalId);
        return respond(id, {});
      default:
        // Worth knowing about: the extension routes these explicitly.
        note(`agent → client ${method}`, JSON.stringify(params ?? {}).slice(0, 300));
        return respondError(id, -32601, `method not found: ${method}`);
    }
  } catch (err) {
    return respondError(id, -32603, String(err?.message ?? err));
  }
}

function observeUpdate(params) {
  const update = params?.update ?? params;
  const kind = update?.sessionUpdate;
  if (!kind) return;
  seenUpdates.add(kind);
  if (update._meta?.promptIndex !== undefined) sawPromptIndex = true;
  if (kind === 'tool_call' || kind === 'tool_call_update') {
    const meta = update._meta?.['x.ai/tool'];
    if (meta) sawXaiToolMeta = true;
    toolCalls.push({
      id: update.toolCallId ?? update.tool_call_id,
      status: update.status,
      name: meta?.name,
      kind: meta?.kind,
      readOnly: meta?.read_only,
    });
  }
  if (kind === 'turn_completed') turnUsage = update.usage ?? update;
}

createInterface({ input: child.stdout }).on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let frame;
  try {
    frame = JSON.parse(trimmed);
  } catch {
    console.log(`\x1b[31m[non-JSON stdout] ${redact(trimmed.slice(0, 200))}\x1b[0m`);
    return;
  }

  if (frame.method && frame.id != null) {
    handleAgentRequest(frame);
    return;
  }
  if (frame.method) {
    seenMethods.add(frame.method);
    if (frame.method === 'session/update') observeUpdate(frame.params);
    if (frame.method === '_x.ai/session_notification') observeUpdate(frame.params);
    if (frame.method === '_x.ai/git/worktree/status') {
      worktreeStatuses.push(frame.params ?? {});
      const status = frame.params?.status;
      if (worktreeWaiter && (status === 'created' || status === 'error' || status === 'failed')) {
        worktreeWaiter(frame.params);
        worktreeWaiter = null;
      }
    }
    return;
  }
  const p = pending.get(frame.id);
  if (p) {
    pending.delete(frame.id);
    if (frame.error) {
      const err = new Error(frame.error.message ?? JSON.stringify(frame.error));
      err.rpc = frame.error;
      p.rej(err);
    } else {
      p.res(frame.result);
    }
  }
});

async function tryRequest(method, params) {
  try {
    return { ok: true, result: await request(method, params) };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), code: err?.rpc?.code };
  }
}

/** The extension treats -32601 as "feature unavailable", so the code matters, not just failure. */
async function checkMissing(method, params, why) {
  const r = await tryRequest(method, params);
  check(`${method} is not client-callable (${why})`, r.code === -32601, r.ok ? 'it answered — re-check the code path!' : `code=${r.code}`);
}

// ---------------------------------------------------------------- checks

async function main() {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    clientInfo: { name: 'grok-build-unofficial-verify', version: '0.1.0' },
  });
  check('initialize returns protocolVersion 1', init?.protocolVersion === 1, `got ${init?.protocolVersion}`);
  check('agent advertises loadSession', init?.agentCapabilities?.loadSession === true);
  note('agentInfo', JSON.stringify(init?.agentInfo ?? init?.agent ?? {}));

  const session = await request('session/new', { cwd, mcpServers: [] });
  const sessionId = session?.sessionId;
  check('session/new returns a sessionId', typeof sessionId === 'string' && sessionId.length > 0);

  const models = session?.models?.availableModels ?? session?.models ?? [];
  const currentModelId = session?.models?.currentModelId ?? models[0]?.modelId;
  check('session/new lists models', Array.isArray(models) && models.length > 0, `${models.length} models, current=${currentModelId}`);

  const config = session?._meta?.['x.ai/sessionConfig'];
  const options = config?.options ?? [];
  const modeOptions = options.filter((o) => o.category === 'mode');
  check(
    'x.ai/sessionConfig exposes reasoning efforts as category "mode"',
    modeOptions.length > 0,
    modeOptions.map((o) => `${o.id ?? o.modeId}${o.selected ? '*' : ''}`).join(', '),
  );
  const categories = [...new Set(options.map((o) => o.category))];
  note('sessionConfig categories', categories.join(', ') || '(none)');

  // Setters the header UI depends on.
  if (currentModelId) {
    const r = await tryRequest('session/set_model', { sessionId, modelId: currentModelId });
    check('session/set_model accepted', r.ok, r.error ?? '');
  }
  const selectedMode = modeOptions.find((o) => o.selected) ?? modeOptions[0];
  if (selectedMode) {
    const modeId = selectedMode.id ?? selectedMode.modeId;
    const r = await tryRequest('session/set_mode', { sessionId, modeId });
    check(`session/set_mode accepted (${modeId})`, r.ok, r.error ?? '');
  }
  const gone = await tryRequest('session/set_config_option', { sessionId, key: 'reasoning_effort', value: 'low' });
  check('session/set_config_option is absent (as documented)', !gone.ok, gone.ok ? 'it exists after all!' : '');

  // --------------------------------------------------------- what we must NOT rely on
  //
  // These names exist inside grok, but only on the private leader channel its TUI uses. The
  // extension works around each one; if a grok release ever registers them for ACP clients, these
  // checks flip to FAIL and the workaround can be deleted.
  await checkMissing('_x.ai/queue/interject', { sessionId, text: 'verify' }, 'we queue interjections client-side');
  await checkMissing('_x.ai/toggle_plan_mode', { sessionId, enabled: false }, 'plan mode is gate + prompt preamble');
  await checkMissing('_x.ai/permissions/reset', { sessionId }, 'approvals are entirely ours');
  await checkMissing('_x.ai/git/worktree/status', { sessionId, cwd }, 'status arrives as a notification');
  await checkMissing('x.ai/git/worktree/list', { sessionId }, 'the ACP `_` prefix is mandatory');

  // --------------------------------------------------------- session lists
  const sessionsList = await tryRequest('_x.ai/sessions/list', { sessionId, cwd });
  check(
    '_x.ai/sessions/list is double-wrapped with a `sessions` array',
    sessionsList.ok && Array.isArray(unwrap(sessionsList.result)?.sessions),
    sessionsList.ok ? JSON.stringify(sessionsList.result).slice(0, 160) : sessionsList.error,
  );
  const summaries = await tryRequest('_x.ai/session_summaries/session_list', {
    sessionId,
    workspace_directory: cwd,
    limit: 20,
  });
  check(
    '_x.ai/session_summaries/session_list returns `session_summaries` (not wrapped)',
    summaries.ok && Array.isArray(summaries.result?.session_summaries),
    summaries.ok ? JSON.stringify(summaries.result).slice(0, 160) : summaries.error,
  );

  const rewindBefore = await tryRequest('_x.ai/rewind/points', { sessionId });
  check(
    '_x.ai/rewind/points returns snake_case `rewind_points`',
    rewindBefore.ok && Array.isArray(rewindBefore.result?.rewind_points),
    rewindBefore.ok ? JSON.stringify(rewindBefore.result).slice(0, 200) : rewindBefore.error,
  );

  await verifyWorktrees(sessionId);

  // --------------------------------------------------------- one real turn
  if (!opts.prompt) {
    for (const name of [
      'session/prompt completes',
      'tool_call updates carry _meta["x.ai/tool"]',
      'client callbacks fired (write, terminal, read)',
      'turn_completed reports usage with costUsdTicks',
      '_x.ai/rewind/points exposes prompt_index after a prompt',
    ]) {
      skip(name, '--no-prompt');
    }
  } else {
    const prompt =
      'Do these three steps with tools, no questions: 1) write a file hello.txt containing exactly "hi"; ' +
      '2) run the shell command `node -e "console.log(2+2)"`; 3) read hello.txt back. Then reply in one short sentence.';
    console.log('\n>>> prompting…\n');
    const res = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] });

    check('session/prompt completes', typeof res?.stopReason === 'string', `stopReason=${res?.stopReason}`);
    check('tool_call updates carry _meta["x.ai/tool"]', sawXaiToolMeta, `${toolCalls.length} tool updates`);
    check('updates carry _meta.promptIndex', sawPromptIndex);
    check(
      'client callbacks fired (write, terminal, read)',
      ['fs/write_text_file', 'terminal/create', 'fs/read_text_file'].every((m) => seenAgentRequests.has(m)),
      [...seenAgentRequests].join(', '),
    );
    check(
      'turn_completed reports usage with costUsdTicks',
      turnUsage?.costUsdTicks !== undefined,
      turnUsage
        ? `cost=$${((turnUsage.costUsdTicks ?? 0) / 1e9).toFixed(5)} in=${turnUsage.inputTokens} out=${turnUsage.outputTokens}`
        : 'no turn_completed',
    );

    note('session/update kinds seen', [...seenUpdates].sort().join(', '));
    note(
      'tool calls',
      toolCalls
        .filter((t) => t.name)
        .map((t) => `${t.name}[${t.kind}${t.readOnly ? ',ro' : ''}]`)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(', '),
    );

    // `rewind()` sends `targetPromptIndex`, read out of this snake_case payload — so the field
    // has to be there, and it has to be a number.
    const rewindAfter = await tryRequest('_x.ai/rewind/points', { sessionId });
    const points = rewindAfter.ok ? (rewindAfter.result?.rewind_points ?? []) : [];
    check(
      '_x.ai/rewind/points exposes prompt_index after a prompt',
      points.length > 0 && typeof points[0]?.prompt_index === 'number',
      rewindAfter.ok ? JSON.stringify(points[0] ?? {}).slice(0, 300) : rewindAfter.error,
    );
  }

  note('agent notifications seen', [...seenMethods].sort().join(', '));

  // session/load is what "resume session" relies on.
  const loaded = await tryRequest('session/load', { sessionId, cwd, mcpServers: [] });
  check('session/load accepted for the current session', loaded.ok, loaded.error ?? '');
}

/**
 * The worktree family, end to end: create → `status` notification → list → remove.
 *
 * Cleanup is driven off `list` (filtered to this scratch repo) rather than off the create result,
 * so nothing is left behind in `~/.grok/worktrees.db` even if a check throws.
 */
async function verifyWorktrees(sessionId) {
  const name = `verify-wt-${Date.now().toString(36)}`;
  try {
    const empty = await tryRequest('_x.ai/git/worktree/list', { sessionId });
    check(
      '_x.ai/git/worktree/list is double-wrapped around an array',
      empty.ok && Array.isArray(unwrap(empty.result)),
      empty.ok ? JSON.stringify(empty.result).slice(0, 160) : empty.error,
    );

    const settled = new Promise((r) => {
      worktreeWaiter = r;
      setTimeout(() => r(null), 30000);
    });
    const created = await tryRequest('_x.ai/git/worktree/create', {
      sessionId,
      sourcePath: cwd,
      name,
      branch: name,
    });
    check(
      '_x.ai/git/worktree/create answers {status:"creating", worktreePath}',
      created.ok && unwrap(created.result)?.worktreePath !== undefined,
      created.ok ? JSON.stringify(unwrap(created.result)).slice(0, 200) : created.error,
    );

    const final = await settled;
    check(
      '_x.ai/git/worktree/status notification reaches "created"',
      final?.status === 'created' && typeof final?.worktreePath === 'string',
      JSON.stringify(final ?? {}).slice(0, 240) || 'timed out after 30s',
    );
    note('worktree status sequence', worktreeStatuses.map((s) => s?.status ?? '?').join(' → '));

    const listed = await tryRequest('_x.ai/git/worktree/list', { sessionId });
    const entries = (unwrap(listed.result) ?? []).filter?.((e) => samePath(e?.source_repo, cwd)) ?? [];
    check(
      '_x.ai/git/worktree/list reports the new tree with a matching source_repo',
      entries.length > 0,
      entries.map((e) => `${e.path} (${e.status})`).join(' | ').slice(0, 240),
    );
    check(
      'worktree entries carry the fields the picker shows (path, status, head_commit)',
      entries.length > 0 && entries.every((e) => e.path && e.status && e.head_commit),
      JSON.stringify(entries[0] ?? {}).slice(0, 300),
    );
  } finally {
    const listed = await tryRequest('_x.ai/git/worktree/list', { sessionId });
    const entries = (unwrap(listed.result) ?? []).filter?.((e) => samePath(e?.source_repo, cwd)) ?? [];
    let removedAll = entries.length > 0;
    for (const entry of entries) {
      const worktreePath = entry.path ?? entry.worktreePath;
      if (!worktreePath) continue;
      const r = await tryRequest('_x.ai/git/worktree/remove', { sessionId, worktreePath, force: true });
      const removed = r.ok && unwrap(r.result)?.removed === true;
      if (!removed) removedAll = false;
      console.log(`\x1b[90mcleanup\x1b[0m worktree/remove ${worktreePath} — ${removed ? 'removed' : redact(r.error ?? JSON.stringify(r.result))}`);
    }
    check('_x.ai/git/worktree/remove cleans up every tree it made', removedAll, entries.length === 0 ? 'nothing listed to remove — check ~/.grok/worktrees by hand' : '');
  }
}

main()
  .catch((err) => {
    check('harness ran to completion', false, String(err?.message ?? err));
    if (stderrText.length) console.log(redact(stderrText.join('')).slice(-2000));
  })
  .finally(() => {
    const failed = results.filter((r) => r.ok === false);
    const passed = results.filter((r) => r.ok === true);
    console.log(`\n${passed.length} passed, ${failed.length} failed`);

    const report = [
      '# Live verification',
      '',
      `- when: ${new Date().toISOString()}`,
      `- agent: \`${grokBin} ${args.join(' ')}\``,
      `- prompt turn: ${opts.prompt ? 'yes' : 'no (--no-prompt)'}`,
      '',
      ...results.map((r) => `- ${r.ok === null ? 'note' : r.ok ? 'PASS' : 'FAIL'} — **${r.name}**${r.detail ? `: ${r.detail}` : ''}`),
      '',
    ].join('\n');
    const outDir = join(projectRoot, 'recordings', 'verify-live');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'report.md'), redact(report));
    console.log(`report: ${join(outDir, 'report.md')}`);

    child.kill();
    if (!opts.keep && !safeRm(cwd)) console.log(`(left ${cwd} behind — grok still had it open)`);
    process.exitCode = failed.length > 0 ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 500);
  });
