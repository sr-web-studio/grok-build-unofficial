/**
 * Publish the packaged .vsix to Open VSX.
 * Loads OVSX_PAT from .env; never prints the token.
 *
 *   npm run package   # if needed
 *   node tools/publish-openvsx.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, '.env')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const id = `${pkg.publisher}.${pkg.name}`
const vsixName = `${pkg.name}-${pkg.version}.vsix`
const vsixPath = path.join(root, vsixName)

function loadPat() {
  if (!fs.existsSync(envPath)) {
    console.error('Missing .env — add OVSX_PAT=…')
    process.exit(1)
  }
  const m = fs.readFileSync(envPath, 'utf8').match(/^\s*OVSX_PAT\s*=\s*(.+)$/m)
  if (!m) {
    console.error('OVSX_PAT not found in .env')
    process.exit(1)
  }
  const pat = m[1].trim().replace(/^["']|["']$/g, '')
  if (pat.length < 10) {
    console.error('OVSX_PAT looks empty or too short')
    process.exit(1)
  }
  return pat
}

const pat = loadPat()
const scrub = (s) => (s || '').split(pat).join('***')

if (!fs.existsSync(vsixPath)) {
  console.log(`No ${vsixName} — running npm run package…`)
  const pack = spawnSync('npm', ['run', 'package'], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (pack.stdout) process.stdout.write(scrub(pack.stdout))
  if (pack.stderr) process.stderr.write(scrub(pack.stderr))
  if (pack.status !== 0) process.exit(pack.status ?? 1)
}

if (!fs.existsSync(vsixPath)) {
  console.error(`Still missing ${vsixPath}`)
  process.exit(1)
}

console.log(`Publishing ${id}@${pkg.version} to Open VSX…`)
console.log(`VSIX: ${vsixName}`)

const r = spawnSync(
  'npx',
  ['ovsx', 'publish', vsixPath, '-p', pat],
  {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, OVSX_PAT: pat },
    maxBuffer: 20 * 1024 * 1024,
  },
)

if (r.stdout) process.stdout.write(scrub(r.stdout))
if (r.stderr) process.stderr.write(scrub(r.stderr))
process.exit(r.status ?? 1)
