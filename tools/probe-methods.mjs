#!/usr/bin/env node
/**
 * Method-surface probe: which `_x.ai/*` extension methods can a *client* actually call?
 *
 * Mining grok.exe's string table gives names, but a name can also belong to an agent → client
 * notification (that is why `_x.ai/git/worktree/status` answered `-32601` in verify-live). This
 * script asks the running agent directly and classifies each candidate:
 *
 *   MISSING   -32601 Method not found        → not callable by us
 *   PARAMS    -32602 / app error             → the handler exists, our params are wrong
 *   OK        a result                       → callable, shape printed
 *
 * No prompt is sent, so the run is free. It works in a scratch git repo so the worktree family
 * has something to operate on.
 *
 *   node tools/probe-methods.mjs [--keep] [--cwd <dir>]
 */

import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const argv = process.argv.slice(2);
const opts = { keep: false, cwd: null, leader: false };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--keep') opts.keep = true;
  else if (argv[i] === '--cwd') opts.cwd = resolve(argv[++i]);
  else if (argv[i] === '--leader') opts.leader = true;
  else throw new Error(`unknown flag ${argv[i]}`);
}

const outDir = join(projectRoot, 'recordings', opts.leader ? 'probe-methods-leader' : 'probe-methods');
mkdirSync(outDir, { recursive: true });

// A real repo, because half the candidates are git-aware.
const cwd = opts.cwd ?? join(projectRoot, 'recordings', 'probe-repo');
if (!opts.cwd) {
  safeRm(cwd);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'README.md'), '# probe repo\n', 'utf8');
  const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'probe@example.com');
  git('config', 'user.name', 'probe');
  git('add', '.');
  git('commit', '-qm', 'init');
}

const SECRET_PATTERNS = [/\b(rpa_[A-Za-z0-9_-]{10,})\b/g, /\b(xai-[A-Za-z0-9_-]{10,})\b/g, /\b(sk-[A-Za-z0-9_-]{10,})\b/g];
const redact = (text) => SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, 'REDACTED'), text);

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

const grokBin = process.env.GROK_BIN ?? 'grok';
// `--leader` reuses the shared backend the TUI talks to: some extension methods may only be
// registered there, so the two runs are worth diffing.
const args = ['--permission-mode', 'bypassPermissions', 'agent'];
if (!opts.leader) args.push('--no-leader');
args.push('stdio');
console.log(`spawning: ${grokBin} ${args.join(' ')}\n  cwd=${cwd}\n`);
const child = spawn(grokBin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
const stderrText = [];
child.stderr.on('data', (d) => stderrText.push(d.toString()));

let nextId = 1;
const pending = new Map();
const inboundNotifications = new Map();

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}
function request(method, params) {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

createInterface({ input: child.stdout }).on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let frame;
  try {
    frame = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (frame.method && frame.id != null) {
    // Nothing here needs a real client, but the agent must not be left hanging.
    send({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'not implemented in probe' } });
    return;
  }
  if (frame.method) {
    const seen = inboundNotifications.get(frame.method) ?? { count: 0, samples: [] };
    seen.count += 1;
    // Keep several samples, not one: `git/worktree/status` only reveals its terminal payload in
    // the later notifications, and that payload is what the extension keys its UI off.
    if (seen.samples.length < 8) seen.samples.push(JSON.stringify(frame.params ?? {}).slice(0, 300));
    inboundNotifications.set(frame.method, seen);
    return;
  }
  const p = pending.get(frame.id);
  if (p) {
    pending.delete(frame.id);
    frame.error ? p.rej(frame.error) : p.res(frame.result);
  }
});

/**
 * Every name worth asking about, grouped so the report reads like a map of the surface.
 * `full: true` dumps the whole result to disk — used for the payloads the extension parses.
 */
function candidates(sessionId) {
  const s = { sessionId };
  const wt = `probe-wt-${Date.now().toString(36)}`;
  return [
    ['sessions', '_x.ai/sessions/list', { ...s, cwd }, true],
    ['sessions', '_x.ai/session/list', { ...s, cwd }, true],
    ['sessions', '_x.ai/session/info', s, true],
    ['sessions', '_x.ai/session/search', { ...s, query: 'grok' }],
    ['sessions', '_x.ai/session_summaries/session_list', { ...s, workspace_directory: cwd, limit: 20 }, true],
    ['sessions', '_x.ai/session_summaries/workspace_list_recent', { ...s, limit: 10 }, true],
    ['sessions', '_x.ai/session/rename', { ...s, title: 'probe' }],
    ['sessions', '_x.ai/prompt_history', { ...s, cwd }, true],
    ['rewind', '_x.ai/rewind/points', s, true],
    ['worktree', '_x.ai/git/worktree/status', s],
    ['worktree', '_x.ai/git/worktree/list', s, true],
    ['worktree', '_x.ai/git/worktree/show', { ...s, idOrPath: cwd }],
    ['worktree', '_x.ai/git/worktree/create', { ...s, sourcePath: cwd, name: wt, branch: wt }, true, 'heavy'],
    ['worktree', '_x.ai/git/worktree/db/path', s],
    ['worktree', '_x.ai/git/worktree/resume_session', { ...s, sourceCwd: cwd }, true, 'heavy'],
    ['queue', '_x.ai/queue/interject', { ...s, text: 'probe' }],
    ['queue', '_x.ai/queue/clear', s],
    ['modes', '_x.ai/toggle_plan_mode', { ...s, enabled: false }],
    ['modes', '_x.ai/permissions/reset', s],
    ['info', '_x.ai/commands/list', s, true],
    ['info', '_x.ai/skills/list', { ...s, cwd }],
    ['info', '_x.ai/session/usage', s],
    // Without the ACP `_` prefix, to confirm the prefix really is required.
    ['prefix', 'x.ai/git/worktree/list', s],
  ];
}

/** grok reports repo paths with mixed separators and drive-letter case, so compare loosely. */
function samePath(a, b) {
  if (typeof a !== 'string') return false;
  const norm = (p) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

function classify(err) {
  if (err?.code === -32601) return 'MISSING';
  if (err?.code === -32602) return 'PARAMS';
  return 'ERROR';
}

async function main() {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    clientInfo: { name: 'grok-build-unofficial-probe', version: '0.1.0' },
  });
  console.log(`agent: ${init?.agentInfo?.name ?? '?'} ${init?.agentInfo?.version ?? ''}\n`);

  const session = await request('session/new', { cwd, mcpServers: [] });
  const sessionId = session?.sessionId;
  console.log(`sessionId: ${sessionId}\n`);
  const dumps = { 'initialize': init, 'session_new': session };

  const rows = [];
  let createdWorktree = null;
  for (const [group, method, params, full, heavy] of candidates(sessionId)) {
    // Against the shared leader, skip anything that would leave real worktrees behind.
    if (heavy && opts.leader) continue;
    let row;
    try {
      const result = await request(method, params);
      row = { group, method, status: 'OK', detail: JSON.stringify(result ?? null).slice(0, 400) };
      if (full) dumps[method.replace(/[^\w]+/g, '_')] = result;
      if (method.endsWith('worktree/create')) createdWorktree = result;
    } catch (err) {
      row = { group, method, status: classify(err), detail: JSON.stringify(err).slice(0, 400) };
    }
    rows.push(row);
    const colour = { OK: 32, PARAMS: 33, ERROR: 33, MISSING: 90 }[row.status];
    console.log(`\x1b[${colour}m${row.status.padEnd(7)}\x1b[0m ${method} — ${redact(row.detail)}`);
  }

  // Worktree creation is async, so list again once it has had a moment: this is the only place a
  // *populated* list entry (and its `status` value) can be observed.
  if (createdWorktree) {
    await new Promise((r) => setTimeout(r, 4000));
    const after = await request('_x.ai/git/worktree/list', { sessionId }).catch((e) => ({ error: e }));
    dumps['worktree_list_after_create'] = after;
    console.log(`\x1b[36mafter\x1b[0m worktree/list — ${redact(JSON.stringify(after).slice(0, 600))}`);
  }

  // Anything the probe created is the probe's to clean up, including the worktrees.db rows.
  // Driven off `list` rather than off the create result, because `resume_session` makes one too.
  if (createdWorktree) {
    const listed = await request('_x.ai/git/worktree/list', { sessionId }).catch(() => null);
    const entries = (listed?.result ?? listed ?? []).filter?.((e) => samePath(e?.source_repo, cwd)) ?? [];
    for (const entry of entries) {
      const worktreePath = entry.path ?? entry.worktreePath;
      if (!worktreePath) continue;
      const removed = await request('_x.ai/git/worktree/remove', { sessionId, worktreePath, force: true })
        .then((r) => JSON.stringify(r).slice(0, 200))
        .catch((e) => `failed: ${JSON.stringify(e).slice(0, 200)}`);
      console.log(`\x1b[90mcleanup\x1b[0m worktree/remove ${worktreePath} — ${redact(removed)}`);
    }
    if (entries.length === 0) console.log('\x1b[33mcleanup\x1b[0m no worktrees matched the scratch repo — check by hand');
  }

  writeFileSync(join(outDir, 'payloads.json'), redact(JSON.stringify(dumps, null, 2)), 'utf8');

  // Give any late notifications (worktree progress, fs index) a moment to land.
  await new Promise((r) => setTimeout(r, 1500));

  const md = [
    '# grok ACP extension-method probe',
    '',
    `- agent: \`${init?.agentInfo?.name ?? '?'} ${init?.agentInfo?.version ?? ''}\``,
    `- cwd: scratch git repo`,
    `- generated: ${new Date().toISOString()}`,
    '',
    '`MISSING` = `-32601`, i.e. not a client-callable method. `PARAMS` = handler exists but rejected',
    'our arguments. `OK` = returned a result.',
    '',
    '| group | method | status | detail |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.group} | \`${r.method}\` | ${r.status} | \`${r.detail.replace(/\|/g, '\\|')}\` |`),
    '',
    '## Notifications received while probing',
    '',
    ...(inboundNotifications.size === 0
      ? ['(none)']
      : [...inboundNotifications].flatMap(([m, v]) => [
          `- \`${m}\` ×${v.count}`,
          ...v.samples.map((s) => `  - \`${s.replace(/\|/g, '\\|')}\``),
        ])),
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'report.md'), redact(md), 'utf8');
  console.log(`\nreport: ${join(outDir, 'report.md')}`);
}

main()
  .catch((err) => {
    console.error('probe failed:', redact(String(err?.message ?? JSON.stringify(err))));
    if (stderrText.length) console.error(redact(stderrText.join('')).slice(-2000));
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
    if (!opts.keep && !opts.cwd && !safeRm(cwd)) {
      console.log(`(left ${cwd} behind — grok still had it open)`);
    }
  });
