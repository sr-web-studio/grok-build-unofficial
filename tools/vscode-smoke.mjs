/**
 * Launcher for tools/vscode-smoke.cjs.
 *
 * Boots a real VS Code with the smoke module as the test entry point, in an isolated
 * user-data/extensions dir so it cannot disturb the editor you are actually working in. VS Code
 * exits on its own when the test module resolves.
 *
 *   node tools/vscode-smoke.mjs           # this repo, loaded as an extension under development
 *   node tools/vscode-smoke.mjs --vsix    # the packaged .vsix, installed like a user would
 *
 * The two modes test different bundles: development loads dist/ as esbuild left it, --vsix loads
 * the minified production build out of the artifact that actually ships. Run `npm run package`
 * before --vsix; it picks the newest .vsix in the repo root.
 *
 * No @vscode/test-electron: `--extensionTestsPath` is a flag on the shipped binary, and the one
 * thing that package adds on top — downloading a VS Code build — is not wanted here. The point is
 * to test against the editor Salim actually runs.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fromVsix = process.argv.includes('--vsix');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const codeExe = findCodeExe();
const scratch = mkdtempSync(join(tmpdir(), 'grok-smoke-'));
const workspace = join(scratch, 'workspace');
const extensions = join(scratch, 'extensions');
const reportPath = join(scratch, 'report.txt');

mkdirSync(join(workspace, 'src'), { recursive: true });
writeFileSync(
  join(workspace, 'src', 'cost.js'),
  ['export function formatCost(ticks) {', "  return '$' + (ticks / 1e9).toFixed(4);", '}', ''].join('\n'),
);

console.log(`code:      ${codeExe}`);
console.log(`mode:      ${fromVsix ? 'installed .vsix' : 'extension development path'}`);
console.log(`workspace: ${workspace}\n`);

// In --vsix mode the vsix is installed into the scratch extensions dir first and the development
// path is aimed at the unpacked result, so the host loads exactly the bundle that ships.
// --extensionTestsPath is only honoured in extension-development mode, so the path has to be there
// either way; pointing it at the installed folder is what keeps the two modes testing different
// bundles rather than both testing the repo.
const developmentPath = fromVsix ? installVsix() : repo;

const args = [
  `--extensionDevelopmentPath=${developmentPath}`,
  `--extensionTestsPath=${join(repo, 'tools', 'vscode-smoke.cjs')}`,
  `--user-data-dir=${join(scratch, 'user-data')}`,
  `--extensions-dir=${extensions}`,
  '--disable-workspace-trust',
  '--skip-welcome',
  '--skip-release-notes',
  '--no-cached-data',
  workspace,
];

const child = spawn(codeExe, args, {
  stdio: 'inherit',
  env: { ...cleanEnv(), GROK_SMOKE_OUT: reportPath },
});

const exitCode = await new Promise((done) => child.on('close', done));

if (existsSync(reportPath)) {
  console.log(readFileSync(reportPath, 'utf8'));
} else {
  console.log('the test module wrote no report — VS Code failed before it ran');
}
console.log(`\nvscode exit code ${exitCode}`);

// Only clean up a good run; a failed one leaves the workspace and logs behind to look at.
if (exitCode === 0) await removeScratch();
else console.log(`left ${scratch} behind`);

process.exit(exitCode === 0 ? 0 : 1);

/**
 * Windows releases the handles of an exited process lazily, and grok's cwd is inside the scratch
 * tree — the first rm right after VS Code closes usually hits EPERM. Retry briefly, then give up:
 * a leftover temp directory is not worth failing a green run over.
 */
async function removeScratch() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(scratch, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.log(`could not remove ${scratch} — still locked, delete it later`);
}

/**
 * A terminal inside VS Code inherits ELECTRON_RUN_AS_NODE=1 and a pile of VSCODE_* variables from
 * the extension host. Passing those on makes the new Code.exe start as a bare Node process, which
 * rejects every VS Code flag with "bad option" — and leaks the parent's IPC hook besides.
 */
function cleanEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) delete env[key];
  }
  return env;
}

/**
 * Install the newest .vsix in the repo root into the scratch extensions dir, and return the folder
 * it unpacked into.
 *
 * Code.exe with CLI arguments detaches a helper and returns 0 immediately, so the install would
 * still be running when the host starts. Going through the CLI entry point in Node mode — exactly
 * what bin/code.cmd does — keeps it in the foreground and gives us real output.
 */
function installVsix() {
  const vsix = globSync('*.vsix', { cwd: repo })
    .map((f) => join(repo, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!vsix) throw new Error('no .vsix in the repo root — run `npm run package` first');
  console.log(`vsix:      ${vsix}`);

  const result = spawnSync(
    codeExe,
    [findCodeCli(), '--extensions-dir', extensions, '--user-data-dir', join(scratch, 'user-data'), '--install-extension', vsix, '--force'],
    { encoding: 'utf8', env: { ...cleanEnv(), ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' } },
  );
  if (result.status !== 0) {
    throw new Error(`installing the vsix failed (exit ${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  console.log(result.stdout.trim());

  // The folder name is publisher.name-version, but reading it off disk survives a version bump.
  const { publisher, name } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const unpacked = globSync(`${publisher}.${name}-*/`, { cwd: extensions })[0];
  if (!unpacked) throw new Error(`the vsix installed but nothing matching ${publisher}.${name}-* appeared in ${extensions}`);
  return join(extensions, unpacked);
}

/**
 * The CLI entry point lives under a build-hash directory that changes with every VS Code update,
 * and one level up from the binary on macOS (Contents/MacOS/Electron vs Contents/Resources/...).
 */
function findCodeCli() {
  for (const base of [dirname(codeExe), resolve(dirname(codeExe), '..')]) {
    const found = globSync('**/resources/app/out/cli.js', { cwd: base })[0];
    if (found) return join(base, found);
  }
  throw new Error(`could not find cli.js near ${codeExe}`);
}

/** Resolve Code.exe from the `code` shim on PATH — the shim itself detaches and never blocks. */
function findCodeExe() {
  const candidates = [
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
    join(process.env.ProgramFiles ?? '', 'Microsoft VS Code', 'Code.exe'),
    '/usr/share/code/code',
    '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  ];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) throw new Error(`could not find the VS Code binary; looked in:\n  ${candidates.join('\n  ')}`);
  return found;
}
