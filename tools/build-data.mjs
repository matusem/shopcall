// Builds public/skins.json: every weapon skin that can be bought for VP.
//
// Source: valorant-api.com — the same Riot game assets the VALORANT Wiki
// (https://valorant.fandom.com/wiki/VALORANT_Wiki) renders its skin pages from.
//
// Rule: a skin is in when it has a content tier (Select / Deluxe / Premium /
// Ultra / Exclusive = it carries a VP price) and cannot be earned another way.
// Excluded:
//   - Battle Pass / agent contract rewards (exact: matched against /v1/contracts)
//   - Standard + "Random Favorite Skin" placeholders (no content tier)
//   - Champions / VCT esports capsules: limited-time drops
//
// Melee is included as its own category. Note that knives only ever show up in
// bundles and the Night Market — never in the four daily-shop slots.
import { writeFileSync, mkdirSync } from 'node:fs'

const TIERS = {
  '12683d76-48d7-84a3-4e09-6985794f0445': { name: 'Select',    vp: 875,  color: '#5a9fe2' },
  '0cebb8be-46d7-c12a-d306-e9907bfc5a25': { name: 'Deluxe',    vp: 1275, color: '#009587' },
  '60bca009-4182-7998-dee7-b8a2558dc369': { name: 'Premium',   vp: 1775, color: '#d1548d' },
  '411e4a55-4e59-7757-41f0-86a53f101bb5': { name: 'Ultra',     vp: 2475, color: '#fad663' },
  'e046854e-406c-37f4-6607-19a9ba8426fc': { name: 'Exclusive', vp: 2175, color: '#f59563' },
}
const ESPORTS = /champions\s*20|\bvct\b|lock\s*\/\/\s*in|esports/i

const cleanName = (skin, weapon) => {
  const n = skin.replace(/\s+/g, ' ').trim()
  const suffix = ' ' + weapon
  return (n.endsWith(suffix) ? n.slice(0, -suffix.length).trim() : n) || n
}

const get = async (p) => (await (await fetch('https://valorant-api.com/v1' + p)).json()).data

const [weapons, themes, contracts] = await Promise.all([
  get('/weapons'), get('/themes'), get('/contracts'),
])

const contractRewards = new Set()
for (const c of contracts)
  for (const ch of c.content.chapters)
    for (const lv of ch.levels)
      if (lv.reward?.type === 'EquippableSkinLevel') contractRewards.add(lv.reward.uuid)

const themeName = Object.fromEntries(themes.map((t) => [t.uuid, t.displayName]))

const CATEGORY_ORDER = ['Sidearms', 'SMGs', 'Shotguns', 'Rifles', 'Sniper Rifles', 'Heavies', 'Melee']
const CATEGORY_LABEL = {
  'Sidearms': 'Sidearms', 'SMGs': 'SMGs', 'Shotguns': 'Shotguns',
  'Assault Rifles': 'Rifles', 'Sniper Rifles': 'Sniper Rifles', 'Heavy Weapons': 'Heavies',
}

const out = { generated: new Date().toISOString(), tiers: {}, categories: [], weapons: [] }
for (const [uuid, t] of Object.entries(TIERS)) out.tiers[t.name] = { vp: t.vp, color: t.color, uuid }

const skipped = { contract: 0, noTier: 0, esports: 0 }

for (const w of weapons) {
  const melee = w.displayName === 'Melee'
  const category = melee ? 'Melee' : (CATEGORY_LABEL[w.shopData?.categoryText] || 'Other')
  const skins = []
  for (const s of w.skins) {
    const tier = TIERS[s.contentTierUuid]
    if (!tier) { skipped.noTier++; continue }
    if (s.levels?.some((l) => contractRewards.has(l.uuid))) { skipped.contract++; continue }
    const theme = themeName[s.themeUuid] || ''
    if (ESPORTS.test(theme) || ESPORTS.test(s.displayName)) { skipped.esports++; continue }
    const icon = s.displayIcon || s.chromas?.[0]?.fullRender || s.chromas?.[0]?.displayIcon
      || s.levels?.find((l) => l.displayIcon)?.displayIcon
    if (!icon) continue
    skins.push({
      id: s.uuid.slice(0, 8),
      name: cleanName(s.displayName, w.displayName),
      full: s.displayName,
      tier: tier.name,
      theme,
      icon,
    })
  }
  skins.sort((a, b) => a.name.localeCompare(b.name))
  out.weapons.push({
    id: w.displayName.toLowerCase().replace(/\W+/g, ''),
    name: w.displayName,
    category,
    icon: w.displayIcon,
    cost: w.shopData?.cost ?? null,
    skins,
  })
}

out.weapons.sort(
  (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    || (b.cost ?? 0) - (a.cost ?? 0),
)
out.categories = CATEGORY_ORDER.filter((c) => out.weapons.some((w) => w.category === c))

mkdirSync('public', { recursive: true })
writeFileSync('public/skins.json', JSON.stringify(out))
const total = out.weapons.reduce((n, w) => n + w.skins.length, 0)
console.log(`${total} shop skins across ${out.weapons.length} weapons`)
console.log('skipped:', skipped)
for (const c of out.categories)
  console.log('  ' + c + ': ' + out.weapons.filter(w => w.category === c)
    .map(w => `${w.name}(${w.skins.length})`).join(' '))
