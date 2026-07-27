#!/usr/bin/env node
/**
 * Proves the `_x.ai/ask_user_question` *answer* contract end to end.
 *
 * The tool failed in the extension with "missing field `outcome`", because grok deserialises the
 * reply into `AskUserQuestionExtResponse` — a serde enum tagged internally on `outcome`. This
 * script asks grok to raise the tool for real, answers it with exactly the payload the extension
 * now sends, and checks that the tool call ends `completed` and that grok can read the answers
 * back. If xAI ever changes the enum, this goes RED instead of the UI silently breaking again.
 *
 *   node tools/probe-ask-question.mjs [--skip]
 *
 * `--skip` sends `{"outcome":"skip_interview"}` instead, to verify the other variant.
 * Costs one short turn. Uses `--no-leader` and a scratch repo, so your TUI sessions are untouched.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const useSkip = process.argv.includes('--skip');

const cwd = join(projectRoot, 'recordings', 'ask-question-cwd');
try {
  rmSync(cwd, { recursive: true, force: true });
} catch {
  /* Windows can hold the dir briefly; a stale scratch repo is harmless. */
}
mkdirSync(cwd, { recursive: true });
writeFileSync(join(cwd, 'README.md'), '# ask-question probe\n', 'utf8');
{
  const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'probe@example.com');
  git('config', 'user.name', 'probe');
  git('add', '.');
  git('commit', '-qm', 'init');
}

const child = spawn(process.env.GROK_BIN ?? 'grok', ['agent', '--no-leader', 'stdio'], {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});
child.stderr.on('data', (d) => process.stderr.write(`\x1b[90m${d}\x1b[0m`));

let nextId = 1;
const pending = new Map();
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

/** What the tool call ended as, and everything grok said afterwards. */
let askToolCallId = null;
let askStatus = null;
let askError = '';
let asked = null;
let sentReply = null;
let finalText = '';

createInterface({ input: child.stdout }).on('line', (line) => {
  if (!line.trim()) return;
  let frame;
  try {
    frame = JSON.parse(line);
  } catch {
    return;
  }

  if (frame.method === '_x.ai/ask_user_question' && frame.id != null) {
    asked = frame.params;
    console.log('\n\x1b[36m--- grok asked ---\x1b[0m');
    console.log(JSON.stringify(asked, null, 2));

    // Built the same way `Question.svelte` builds it: keyed by question text, arrays for
    // multi-select, and the `outcome` tag that grok's enum requires.
    if (useSkip) {
      sentReply = { outcome: 'skip_interview' };
    } else {
      const answers = {};
      const annotations = {};
      for (const q of asked?.questions ?? []) {
        const first = q.options?.[0];
        const label = first?.label ?? 'yes';
        answers[q.question] = q.multiSelect || q.multi_select ? [label] : label;
        annotations[q.question] = { notes: 'probe note', ...(first?.preview ? { preview: first.preview } : {}) };
      }
      sentReply = { outcome: 'accepted', answers, annotations };
    }

    console.log('\x1b[36m--- client replied ---\x1b[0m');
    console.log(JSON.stringify(sentReply, null, 2));
    send({ jsonrpc: '2.0', id: frame.id, result: sentReply });
    return;
  }

  // Nothing else should reach the client in this probe; refuse rather than hang the agent.
  if (frame.method && frame.id != null) {
    send({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: `not handled: ${frame.method}` } });
    return;
  }

  if (frame.method === 'session/update' || frame.method === '_x.ai/session_notification') {
    const u = frame.params?.update ?? {};
    // Only the opening `tool_call` names the tool; the later status updates carry the id alone,
    // so remember the id and match on that.
    const id = u.toolCallId ?? u.tool_call_id;
    const name = u._meta?.['x.ai/tool']?.name ?? u.name ?? u.title;
    if (id && typeof name === 'string' && name.includes('ask_user_question')) askToolCallId = id;
    if (id && id === askToolCallId && u.status) {
      askStatus = u.status;
      if (u.status === 'failed') askError = JSON.stringify(u.content ?? '');
    }
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.text) finalText += u.content.text;
    return;
  }

  const p = pending.get(frame.id);
  if (p) {
    pending.delete(frame.id);
    frame.error ? p.rej(new Error(frame.error.message ?? JSON.stringify(frame.error))) : p.res(frame.result);
  }
});

const checks = [];
function check(name, ok, detail = '') {
  checks.push(ok);
  console.log(`${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    clientInfo: { name: 'grok-ask-question-probe', version: '0.1.0' },
  });
  const { sessionId } = await request('session/new', { cwd, mcpServers: [] });

  const prompt =
    'Call the ask_user_question tool exactly once, with two questions: ' +
    '(1) "Which colour should the banner be?" single-select, options Red / Green / Blue; ' +
    '(2) "Which extras should ship?" with multiSelect true, options Logo / Tagline / Icon. ' +
    'After you get the answers, reply with one line per question repeating exactly what I picked ' +
    'and any note I left. Do not read, write, or run anything.';

  await request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: prompt }],
  });

  console.log('\n\x1b[36m--- grok said ---\x1b[0m');
  console.log(finalText.trim() || '(nothing)');
  console.log('');

  check('grok raised _x.ai/ask_user_question', asked !== null);
  check('the tool call completed', askStatus === 'completed', `status=${askStatus} ${askError}`);
  if (!useSkip) {
    const echoed = Object.values(sentReply?.answers ?? {})
      .flat()
      .filter((v) => typeof v === 'string');
    check(
      'grok can read the answers back',
      echoed.length > 0 && echoed.every((v) => finalText.includes(v)),
      `looked for ${JSON.stringify(echoed)}`,
    );
  }

  child.kill();
  const failed = checks.filter((c) => !c).length;
  console.log(failed === 0 ? '\n\x1b[32mall checks passed\x1b[0m' : `\n\x1b[31m${failed} check(s) failed\x1b[0m`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\x1b[31m${err?.stack ?? err}\x1b[0m`);
  child.kill();
  process.exit(1);
});
