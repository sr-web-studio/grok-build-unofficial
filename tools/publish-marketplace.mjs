/**
 * Publish the current package to the VS Code Marketplace.
 *
 * Loads `VSCE_PAT` from `.env` (gitignored) and never prints the token.
 *
 *   node tools/publish-marketplace.mjs
 *
 * PAT: Azure DevOps → Personal access tokens → Marketplace (Manage),
 * organization = All accessible organizations. Publisher id must match
 * package.json `publisher` and the identity that owns that publisher.
 *
 * See docs/PUBLISHING.md.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, '.env')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const id = `${pkg.publisher}.${pkg.name}`

function loadPat() {
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env — add VSCE_PAT=… (see docs/PUBLISHING.md)')
    process.exit(1)
  }
  const m = fs.readFileSync(envPath, 'utf8').match(/^\s*VSCE_PAT\s*=\s*(.+)$/m)
  if (!m) {
    console.error('VSCE_PAT not found in .env')
    process.exit(1)
  }
  const pat = m[1].trim().replace(/^["']|["']$/g, '')
  if (pat.length < 20) {
    console.error('VSCE_PAT looks empty or too short')
    process.exit(1)
  }
  return pat
}

const pat = loadPat()
const scrub = (s) => (s || '').split(pat).join('***')

console.log(`Publishing ${id}@${pkg.version}…`)

const r = spawnSync(
  'npx',
  ['@vscode/vsce', 'publish', '-p', pat, '--no-dependencies'],
  {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, VSCE_PAT: pat },
    maxBuffer: 20 * 1024 * 1024,
  },
)

if (r.stdout) process.stdout.write(scrub(r.stdout))
if (r.stderr) process.stderr.write(scrub(r.stderr))
process.exit(r.status ?? 1)
