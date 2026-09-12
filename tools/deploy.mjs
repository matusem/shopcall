// Publishes public/ to the main domain plus the alias domains, so a mistyped or
// old link still lands on the app. Aliases are deployed from a CNAME-free copy —
// surge reads public/CNAME and would otherwise redirect every deploy to the main
// domain.
import { cpSync, rmSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MAIN = 'valorant-shop-call.surge.sh'
const ALIASES = ['shopcall.surge.sh', 'valorantshopcall.surge.sh']

const surge = (dir, domain) => {
  process.stdout.write(`→ ${domain} … `)
  execFileSync('npx', ['-y', 'surge', dir, domain], { stdio: ['ignore', 'ignore', 'inherit'], shell: true })
  console.log('published')
}

surge('public', MAIN)

const tmp = mkdtempSync(join(tmpdir(), 'shopcall-'))
try {
  cpSync('public', tmp, { recursive: true })
  rmSync(join(tmp, 'CNAME'), { force: true })
  for (const domain of ALIASES) surge(tmp, domain)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
