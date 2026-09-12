// Publishes public/ to every surge domain the game answers on. The surge
// mirrors are a backup: the canonical host is GitHub Pages, because some ISPs,
// mobile carriers and antivirus DNS filters block *.surge.sh wholesale.
//
// There is deliberately no public/CNAME — that file is also read by GitHub
// Pages, where it would be taken for a custom domain.
import { execFileSync } from 'node:child_process'

const DOMAINS = [
  'valorant-shop-call.surge.sh',
  'shopcall.surge.sh',
  'valorantshopcall.surge.sh',
]

for (const domain of DOMAINS) {
  process.stdout.write(`→ ${domain} … `)
  execFileSync('npx', ['-y', 'surge', 'public', domain], { stdio: ['ignore', 'ignore', 'inherit'], shell: true })
  console.log('published')
}
