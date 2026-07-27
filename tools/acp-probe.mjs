#!/usr/bin/env node
/**
 * ACP protocol probe / recorder for the Grok Build CLI.
 *
 * Spawns `grok agent stdio`, acts as a minimal but *complete* ACP client
 * (fs + terminal + permission callbacks), drives one or more prompts, and
 * records every JSON-RPC frame on the wire.
 *
 * The point is to learn the exact payload shapes before designing the UI, so
 * this deliberately logs raw frames instead of normalising them.
 *
 * Usage:
 *   node tools/acp-probe.mjs --cwd <dir> [--model <id>] [--auto-approve]
 *                            [--label <name>] "prompt one" "prompt two"
 *
 * Output (recordings/<label>/):
 *   wire.jsonl        every frame, one JSON per line, with direction + timestamp
 *   transcript.md     human-readable walkthrough
 *   summary.json      distinct method / sessionUpdate / tool kinds observed
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const opts = { cwd: process.cwd(), model: null, effort: null, autoApprove: false, label: null, prompts: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--cwd') opts.cwd = resolve(argv[++i]);
  else if (a === '--model') opts.model = argv[++i];
  else if (a === '--effort') opts.effort = argv[++i];
  else if (a === '--permission-mode') opts.permissionMode = argv[++i];
  else if (a === '--auto-approve') opts.autoApprove = true;
  // Keep the shared leader process (default is `--no-leader`) — the released
  // VS Code extension spawns without it, so this reproduces its exact backend.
  else if (a === '--leader') opts.leader = true;
  else if (a === '--deny') (opts.deny ??= []).push(argv[++i]);
  else if (a === '--allow') (opts.allow ??= []).push(argv[++i]);
  else if (a === '--label') opts.label = argv[++i];
  else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
  else opts.prompts.push(a);
}
if (opts.prompts.length === 0) opts.prompts = ['Say hello in one short sentence.'];

const label = opts.label ?? new Date().toISOString().replace(/[:.]/g, '-');
const outDir = join(projectRoot, 'recordings', label);
mkdirSync(outDir, { recursive: true });
mkdirSync(opts.cwd, { recursive: true });

const wirePath = join(outDir, 'wire.jsonl');
writeFileSync(wirePath, '');

// ---------------------------------------------------------------- recording

const observed = {
  agentMethods: new Set(), // methods the agent called on us
  clientMethods: new Set(), // methods we called on the agent
  sessionUpdates: new Set(),
  toolTitles: new Set(),
  toolKinds: new Set(),
  toolNames: new Set(),
  toolContentTypes: new Set(),
  permissionOptionKinds: new Set(),
  stopReasons: new Set(),
};

const transcript = [];
let frameNo = 0;

// grok's initialize / session updates echo the user's MCP server config, which on a
// real machine carries live API keys — never let one land in a recording on disk.
const SECRET_PATTERNS = [
  /\b(?:rpa|xai|sk|ghp|gho|ghu|ghs|glpat|hf|pat)_[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /Bearer\s+[A-Za-z0-9._-]{20,}/g,
];

function redact(text) {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m) => m.slice(0, 4) + 'REDACTED');
  return out;
}

/** direction: 'out' = client→agent, 'in' = agent→client */
function record(direction, frame) {
  frameNo++;
  appendFileSync(
    wirePath,
    redact(JSON.stringify({ n: frameNo, t: Date.now(), direction, frame })) + '\n',
  );

  const kind = frame.method ? 'notification/request' : 'response';
  if (direction === 'in' && frame.method) observed.agentMethods.add(frame.method);
  if (direction === 'out' && frame.method) observed.clientMethods.add(frame.method);

  const u = frame.params?.update;
  if (u?.sessionUpdate) {
    observed.sessionUpdates.add(u.sessionUpdate);
    if (u.title) observed.toolTitles.add(String(u.title).slice(0, 60));
    if (u.kind) observed.toolKinds.add(u.kind);
    const meta = u._meta?.['x.ai/tool'];
    if (meta?.name) observed.toolNames.add(`${meta.name} (kind=${meta.kind}, ro=${meta.read_only})`);
    for (const c of Array.isArray(u.content) ? u.content : u.content ? [u.content] : []) {
      if (c?.type) observed.toolContentTypes.add(c.type);
    }
  }
  if (frame.method === 'session/request_permission') {
    for (const o of frame.params?.options ?? []) observed.permissionOptionKinds.add(o.optionKind ?? o.kind ?? '?');
  }
  if (frame.result?.stopReason) observed.stopReasons.add(frame.result.stopReason);

  transcript.push({ n: frameNo, direction, kind, frame });
  logLive(direction, frame);
}

function logLive(direction, frame) {
  const arrow = direction === 'out' ? '→' : '←';
  if (frame.method) {
    const u = frame.params?.update;
    const detail = u?.sessionUpdate
      ? `${u.sessionUpdate}${u.title ? ` "${String(u.title).slice(0, 50)}"` : ''}${u.status ? ` [${u.status}]` : ''}`
      : '';
    console.error(`${arrow} ${frame.method}${detail ? ' :: ' + detail : ''}`);
  } else {
    console.error(`${arrow} response id=${frame.id}${frame.error ? ' ERROR ' + JSON.stringify(frame.error) : ''}`);
  }
}

// ---------------------------------------------------------------- transport

const grokBin = process.env.GROK_BIN ?? 'grok';
// Model / effort / approval flags belong to `grok agent`, *before* the `stdio`
// subcommand — `grok agent stdio` itself only accepts debug + leader flags.
// `--permission-mode` is a *global* grok flag: it must come before `agent`.
// Without it grok falls back to ~/.claude/settings.json permissions, which on
// this machine sets bypassPermissions and silently auto-approves everything.
const agentArgs = [];
if (opts.permissionMode) agentArgs.push('--permission-mode', opts.permissionMode);
for (const r of opts.deny ?? []) agentArgs.push('--deny', r);
for (const r of opts.allow ?? []) agentArgs.push('--allow', r);
agentArgs.push('agent');
if (opts.model) agentArgs.push('--model', opts.model);
if (opts.effort) agentArgs.push('--reasoning-effort', opts.effort);
if (opts.autoApprove) agentArgs.push('--always-approve');
if (!opts.leader) agentArgs.push('--no-leader'); // dedicated backend, so recordings are reproducible
agentArgs.push('stdio');

console.error(`spawning: ${grokBin} ${agentArgs.join(' ')}  (cwd=${opts.cwd})`);
const child = spawn(grokBin, agentArgs, {
  cwd: opts.cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: process.platform === 'win32', // grok is a .cmd shim on Windows installs
});

const stderrChunks = [];
child.stderr.on('data', (d) => {
  stderrChunks.push(d.toString());
  process.stderr.write(`\x1b[90m[grok stderr] ${d.toString().trimEnd()}\x1b[0m\n`);
});
child.on('exit', (code, signal) => {
  console.error(`grok exited code=${code} signal=${signal}`);
});

let nextId = 1;
const pending = new Map();

function send(obj) {
  record('out', obj);
  child.stdin.write(JSON.stringify(obj) + '\n');
}

function request(method, params) {
  const id = nextId++;
  return new Promise((resolvePromise, rejectPromise) => {
    pending.set(id, { resolvePromise, rejectPromise, method });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// ---------------------------------------------------------------- client side

const terminals = new Map();

async function handleAgentRequest(frame) {
  const { id, method, params } = frame;
  try {
    switch (method) {
      case 'fs/read_text_file': {
        const text = readFileSync(params.path, 'utf8');
        let content = text;
        if (params.line != null || params.limit != null) {
          const lines = text.split('\n');
          const start = Math.max(0, (params.line ?? 1) - 1);
          const end = params.limit != null ? start + params.limit : lines.length;
          content = lines.slice(start, end).join('\n');
        }
        return respond(id, { content });
      }
      case 'fs/write_text_file': {
        mkdirSync(dirname(params.path), { recursive: true });
        writeFileSync(params.path, params.content, 'utf8');
        return respond(id, {});
      }
      case 'session/request_permission': {
        // Log the full request, then pick the first "allow"-ish option so the
        // probe can keep running unattended.
        const options = params.options ?? [];
        const chosen =
          options.find((o) => (o.optionKind ?? o.kind) === 'allow_once') ??
          options.find((o) => (o.optionKind ?? o.kind) === 'approve') ??
          options[0];
        console.error(
          `\x1b[33m  PERMISSION: ${params.toolCall?.title ?? '?'} → auto-choosing "${chosen?.name ?? chosen?.display ?? chosen?.optionId}"\x1b[0m`,
        );
        return respond(id, {
          outcome: { outcome: 'selected', optionId: chosen?.optionId ?? chosen?.id },
        });
      }
      case 'terminal/create': {
        const term = spawn(params.command, params.args ?? [], {
          cwd: params.cwd ?? opts.cwd,
          shell: true,
          env: { ...process.env, ...Object.fromEntries((params.env ?? []).map((e) => [e.name, e.value])) },
        });
        const terminalId = `probe-term-${terminals.size + 1}`;
        const state = { proc: term, output: '', exit: null, waiters: [] };
        term.stdout.on('data', (d) => (state.output += d.toString()));
        term.stderr.on('data', (d) => (state.output += d.toString()));
        term.on('exit', (code, signal) => {
          state.exit = { exitCode: code, signal };
          state.waiters.forEach((w) => w(state.exit));
          state.waiters = [];
        });
        terminals.set(terminalId, state);
        return respond(id, { terminalId });
      }
      case 'terminal/output': {
        const t = terminals.get(params.terminalId);
        return respond(id, {
          output: t?.output ?? '',
          truncated: false,
          exitStatus: t?.exit ?? null,
        });
      }
      case 'terminal/wait_for_exit': {
        const t = terminals.get(params.terminalId);
        if (!t) return respondError(id, -32602, 'unknown terminal');
        const exit = t.exit ?? (await new Promise((r) => t.waiters.push(r)));
        return respond(id, exit);
      }
      case 'terminal/kill': {
        terminals.get(params.terminalId)?.proc.kill();
        return respond(id, {});
      }
      case 'terminal/release': {
        terminals.delete(params.terminalId);
        return respond(id, {});
      }
      default:
        console.error(`\x1b[31m  UNHANDLED agent→client method: ${method}\x1b[0m`);
        return respondError(id, -32601, `method not found: ${method}`);
    }
  } catch (err) {
    return respondError(id, -32603, String(err?.message ?? err));
  }
}

const rl = createInterface({ input: child.stdout });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let frame;
  try {
    frame = JSON.parse(trimmed);
  } catch {
    console.error(`\x1b[31m[non-JSON stdout] ${trimmed.slice(0, 200)}\x1b[0m`);
    return;
  }
  record('in', frame);

  if (frame.method && frame.id != null) {
    handleAgentRequest(frame);
  } else if (frame.id != null) {
    const p = pending.get(frame.id);
    if (p) {
      pending.delete(frame.id);
      frame.error ? p.rejectPromise(new Error(JSON.stringify(frame.error))) : p.resolvePromise(frame.result);
    }
  }
});

// ---------------------------------------------------------------- drive

function writeArtifacts() {
  const summary = Object.fromEntries(
    Object.entries(observed).map(([k, v]) => [k, [...v].sort()]),
  );
  writeFileSync(join(outDir, 'summary.json'), redact(JSON.stringify(summary, null, 2)));

  const md = [`# ACP probe transcript — ${label}`, ''];
  md.push(`- agent: \`${grokBin} ${agentArgs.join(' ')}\``);
  md.push(`- cwd: \`${opts.cwd}\``);
  md.push(`- prompts: ${opts.prompts.map((p) => JSON.stringify(p)).join(', ')}`);
  md.push('', '## Observed', '', '```json', JSON.stringify(summary, null, 2), '```', '', '## Frames', '');
  for (const e of transcript) {
    const dir = e.direction === 'out' ? 'client → agent' : 'agent → client';
    const head = e.frame.method ?? `response id=${e.frame.id}`;
    md.push(`### ${e.n}. \`${head}\` (${dir})`, '', '```json', JSON.stringify(e.frame, null, 2), '```', '');
  }
  writeFileSync(join(outDir, 'transcript.md'), redact(md.join('\n')));
  console.error(`\nartifacts written to ${outDir}`);
}

async function main() {
  const init = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
    },
    clientInfo: { name: 'grok-build-unofficial-probe', version: '0.0.1' },
  });
  console.error(`\x1b[36mAGENT CAPABILITIES:\x1b[0m ${JSON.stringify(init, null, 2)}`);

  const session = await request('session/new', {
    cwd: opts.cwd,
    mcpServers: [],
  });
  console.error(`\x1b[36mSESSION:\x1b[0m ${JSON.stringify(session, null, 2)}`);
  const sessionId = session.sessionId;

  for (const prompt of opts.prompts) {
    console.error(`\n\x1b[35m>>> PROMPT: ${prompt}\x1b[0m`);
    const res = await request('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: prompt }],
    });
    console.error(`\x1b[35m<<< stopReason: ${res?.stopReason}\x1b[0m`);
  }
}

main()
  .catch((err) => {
    console.error(`\x1b[31mPROBE FAILED: ${err?.message ?? err}\x1b[0m`);
    if (stderrChunks.length) console.error(stderrChunks.join(''));
    process.exitCode = 1;
  })
  .finally(() => {
    writeArtifacts();
    child.kill();
    setTimeout(() => process.exit(process.exitCode ?? 0), 300);
  });
