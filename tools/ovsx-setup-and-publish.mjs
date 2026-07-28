import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const ns = pkg.publisher
const pat = fs
  .readFileSync(path.join(root, '.env'), 'utf8')
  .match(/^\s*OVSX_PAT\s*=\s*(.+)$/m)[1]
  .trim()
  .replace(/^["']|["']$/g, '')
const scrub = (s) => (s || '').split(pat).join('***')

function run(args) {
  console.log('\n>', 'ovsx', args.filter((a) => a !== pat).join(' '))
  const r = spawnSync('npx', ['ovsx', ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, OVSX_PAT: pat },
    maxBuffer: 10e6,
  })
  if (r.stdout) process.stdout.write(scrub(r.stdout))
  if (r.stderr) process.stderr.write(scrub(r.stderr))
  console.log('status', r.status)
  return r.status ?? 1
}

console.log('publisher/namespace:', ns)
console.log('extension:', pkg.name, pkg.version)
console.log('OVSX_PAT length:', pat.length)

// Namespace must exist before first publish
let st = run(['create-namespace', ns, '-p', pat])
// 0 = created; non-zero may mean already exists — continue
run(['verify-pat', ns, '-p', pat])

const vsix = path.join(root, `${pkg.name}-${pkg.version}.vsix`)
if (!fs.existsSync(vsix)) {
  console.log('\nPackaging…')
  const pack = spawnSync('npm', ['run', 'package'], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 20e6,
  })
  if (pack.stdout) process.stdout.write(pack.stdout)
  if (pack.stderr) process.stderr.write(pack.stderr)
  if (pack.status !== 0) process.exit(pack.status ?? 1)
}

st = run(['publish', vsix, '-p', pat])
process.exit(st)
