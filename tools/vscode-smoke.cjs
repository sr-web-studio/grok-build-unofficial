/**
 * Smoke test that runs *inside* a real VS Code extension host.
 *
 * Everything else in tools/ verifies the protocol against the live CLI, or the UI against a stubbed
 * host. This is the only check that exercises the seam between them: does the extension activate
 * under a real `vscode` API, are the contributed commands actually registered, does revealing the
 * view resolve the webview, and does that really spawn a grok process.
 *
 * Run it with VS Code's own test runner — no test framework, no extra dependency:
 *
 *   node tools/vscode-smoke.mjs
 *
 * It stops short of a prompt on purpose: a turn costs money and needs a human to approve the
 * write/command gates. Those paths are covered by tools/verify-live.mjs and the webview harness.
 */

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const vscode = require('vscode');

const EXTENSION_ID = 'srwebstudio.grok-build-unofficial';

const EXPECTED_COMMANDS = [
  'grokBuild.focusChat',
  'grokBuild.newSession',
  'grokBuild.restartAgent',
  'grokBuild.showLog',
  'grokBuild.addSelectionToChat',
];

exports.run = async function run() {
  const results = [];
  const check = (name, fn) => {
    try {
      const detail = fn();
      results.push(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
    } catch (err) {
      results.push(`FAIL  ${name} — ${err && err.message}`);
      throw err;
    }
  };

  try {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    check('extension is present in the host', () => {
      assert.ok(extension, `${EXTENSION_ID} not found`);
      return extension.extensionPath;
    });

    // activationEvents is empty and the view is lazy, so it should still be dormant here.
    check('extension has not activated yet (lazy view activation)', () => {
      assert.strictEqual(extension.isActive, false);
    });

    await extension.activate();
    check('activate() resolved without throwing', () => {
      assert.strictEqual(extension.isActive, true);
    });

    const commands = await vscode.commands.getCommands(true);
    for (const id of EXPECTED_COMMANDS) {
      check(`command registered: ${id}`, () => {
        assert.ok(commands.includes(id), 'missing from the command registry');
      });
    }

    const grokBefore = grokChildPids();
    check('no grok process before the view is revealed', () => {
      assert.deepStrictEqual(grokBefore, []);
    });

    // Revealing runs resolveWebviewView: builds the HTML/CSP, wires the message channel, and
    // starts the agent. A throw anywhere in there surfaces as a rejected executeCommand.
    await vscode.commands.executeCommand('grokBuild.focusChat');
    check('grokBuild.focusChat revealed the view', () => {});

    const pids = await waitFor(() => {
      const found = grokChildPids();
      return found.length > 0 ? found : undefined;
    }, 30_000);
    check('revealing the view spawned a grok process', () => {
      assert.ok(pids, 'no grok child process appeared within 30s');
      return `pid ${pids.join(', ')}`;
    });

    // If the spawn arguments were wrong, grok exits within a second or two. Staying alive past the
    // handshake window is the cheap proxy for "initialize and session/new went through".
    await delay(6000);
    check('the grok process is still alive after the handshake window', () => {
      const still = grokChildPids();
      assert.ok(still.length > 0, 'grok exited — check the Grok Build output channel for the reason');
      return `pid ${still.join(', ')}`;
    });

    // addSelectionToChat reads the active editor and posts into the webview; the assertion is only
    // that the real editor path does not throw (the resulting text is checked in the UI harness).
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'src', 'cost.js'),
    );
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(1, 0, 2, 0);
    await vscode.commands.executeCommand('grokBuild.addSelectionToChat');
    check('grokBuild.addSelectionToChat ran against a real editor selection', () => {});

    await vscode.commands.executeCommand('grokBuild.showLog');
    check('grokBuild.showLog opened the output channel', () => {});

    report(results, null);
  } catch (err) {
    report(results, err);
    throw err;
  }
};

/**
 * Electron on Windows is a GUI subsystem binary, so nothing written to stdout reaches the parent
 * shell. The runner reads this file instead.
 */
function report(results, err) {
  const failed = err ? 1 : 0;
  const lines = [...results];
  if (err) lines.push(`ERROR ${err.stack || err}`);
  lines.push('', `${results.filter((r) => r.startsWith('PASS')).length} passed, ${failed} failed`);
  const text = lines.join('\n');
  console.log(`\n${text}\n`);
  if (process.env.GROK_SMOKE_OUT) {
    try {
      writeFileSync(process.env.GROK_SMOKE_OUT, text, 'utf8');
    } catch {
      // Nothing useful to do here; the exit code still tells the runner what happened.
    }
  }
}

/**
 * grok processes descended from this extension host.
 *
 * The session spawns through a shell, so the child is a grandchild as often as a child — walking
 * the parent chain is more reliable than looking one level down.
 */
function grokChildPids() {
  const script = `
    $ours = @(${process.pid})
    $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
    $added = $true
    while ($added) {
      $added = $false
      foreach ($p in $all) {
        if (($ours -contains $p.ParentProcessId) -and ($ours -notcontains $p.ProcessId)) {
          $ours += $p.ProcessId
          $added = $true
        }
      }
    }
    $all | Where-Object { ($ours -contains $_.ProcessId) -and ($_.Name -like 'grok*') } |
      ForEach-Object { $_.ProcessId }
  `;
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8' },
  );
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(Number);
}

async function waitFor(probe, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== undefined) return value;
    await delay(250);
  }
  return undefined;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
