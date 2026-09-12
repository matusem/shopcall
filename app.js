/* SHOP CALL — guess what's sitting in your friends' daily VALORANT store.
   Online rooms ride on ntfy.sh: one public topic per room code, every player
   publishes their own card and subscribes to everyone else's (SSE, history
   replayed on join). No accounts, no backend of our own. */
(() => {
  const KEY = 'shopcall.v2'
  const NTFY = 'https://ntfy.sh/'
  const TOPIC = (room) => 'shopcall-v1-' + room.toLowerCase()
  const app = document.getElementById('app')
  const nav = document.getElementById('nav')

  let DATA = null
  const skinIndex = new Map() // skinId -> { skin, weapon }

  let state = { me: '', players: [], picks: {}, cards: {}, room: '' }
  let ui = { view: 'setup', target: null, category: null, weapon: null, q: '', tier: '', msg: '' }
  const net = { es: null, status: 'off', stamps: {}, sent: '', timer: null }

  /* ---------- storage ---------- */
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch (e) { /* private mode */ }
  }
  const load = () => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) state = Object.assign(state, JSON.parse(raw))
    } catch (e) { /* ignore */ }
  }

  /* ---------- share codes (offline fallback) ---------- */
  const b64e = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const b64d = (s) => new TextDecoder().decode(
    Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))

  const myCode = () => b64e(JSON.stringify([state.me, Object.entries(state.picks)]))
  const shareLink = () => location.origin + location.pathname + '#c=' + myCode()
  const roomLink = () => location.origin + location.pathname + '#r=' + state.room

  function readCard(code) {
    const [who, pairs] = JSON.parse(b64d(code.trim()))
    if (!who || !Array.isArray(pairs)) throw new Error('bad card')
    const picks = {}
    for (const [target, id] of pairs) if (skinIndex.has(id)) picks[target] = id
    return { who, picks }
  }

  function importCode(code) {
    const { who, picks } = readCard(code)
    state.cards[who] = picks
    addPlayers([who, ...Object.keys(picks)])
    save()
  }

  const addPlayers = (names) => {
    for (const n of names)
      if (n && !state.players.some((p) => p.toLowerCase() === n.toLowerCase())) state.players.push(n)
  }

  /* ---------- online room ---------- */
  const newRoom = () => Array.from({ length: 4 }, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')

  function disconnect() {
    if (net.es) net.es.close()
    net.es = null
    net.status = 'off'
    net.sent = ''
    clearTimeout(net.timer)
  }

  function connect() {
    disconnect()
    if (!state.room || !state.me) return
    net.status = 'connecting'
    const es = new EventSource(NTFY + TOPIC(state.room) + '/sse?since=all')
    net.es = es
    es.onopen = () => { net.status = 'live'; publish(); repaint() }
    es.onerror = () => { net.status = 'offline'; repaint() }
    es.onmessage = (ev) => {
      let m, card
      try { m = JSON.parse(ev.data) } catch (e) { return }
      if (m.event !== 'message' || !m.message) return
      try { card = JSON.parse(m.message) } catch (e) { return }
      receive(card)
    }
  }

  function receive(card) {
    if (!card || card.v !== 1 || !card.who || !Array.isArray(card.picks)) return
    if (card.who === state.me) return
    if ((net.stamps[card.who] || 0) > card.ts) return
    net.stamps[card.who] = card.ts
    const picks = {}
    for (const [target, id] of card.picks) if (skinIndex.has(id)) picks[target] = id
    state.cards[card.who] = picks
    addPlayers([card.who, ...Object.keys(picks)])
    save()
    repaint()
  }

  function publish(delay) {
    if (!net.es || !state.room || !state.me) return
    clearTimeout(net.timer)
    net.timer = setTimeout(() => {
      const body = JSON.stringify({ v: 1, who: state.me, ts: Date.now(), picks: Object.entries(state.picks) })
      if (body.replace(/"ts":\d+/, '') === net.sent) return
      net.sent = body.replace(/"ts":\d+/, '')
      fetch(NTFY + TOPIC(state.room), { method: 'POST', body }).catch(() => { net.sent = '' })
    }, delay || 0)
  }

  function joinRoom(code) {
    const room = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
    if (!room) return false
    state.room = room
    net.stamps = {}
    save()
    connect()
    return true
  }

  function leaveRoom() {
    state.room = ''
    save()
    disconnect()
  }

  /* ---------- helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const others = () => state.players.filter((p) => p !== state.me)
  const myDone = () => others().filter((p) => state.picks[p]).length
  const allIn = () => others().length > 0 && myDone() === others().length
  const allCards = () => {
    const out = Object.assign({}, state.cards)
    if (state.me && Object.keys(state.picks).length) out[state.me] = state.picks
    return out
  }
  const tierColor = (t) => (DATA.tiers[t] || {}).color || '#8fa3b3'
  const go = (view, patch) => { ui = Object.assign(ui, { view, msg: '' }, patch || {}); render() }

  /* ---------- views ---------- */
  function roomPanel() {
    if (state.room) {
      const inRoom = Object.keys(state.cards)
      return `
        <div class="panel room">
          <div class="row" style="justify-content:space-between">
            <h2 style="margin:0">Room <span class="roomcode">${esc(state.room)}</span></h2>
            <span class="status ${net.status}">${net.status === 'live' ? 'Live'
              : net.status === 'connecting' ? 'Connecting&hellip;' : 'Offline'}</span>
          </div>
          <p class="hint" style="margin:12px 0">
            ${inRoom.length ? `${inRoom.length + 1} in the room: <strong>${esc([state.me, ...inRoom].join(', '))}</strong>.`
              : 'Waiting for the others&hellip; send them the code or the link.'}
            Calls sync as you make them.
          </p>
          <div class="row">
            <button class="btn ghost" id="copy-room">Copy invite link</button>
            <button class="btn ghost" id="leave-room">Leave room</button>
            <span class="hint" id="room-msg">${esc(ui.msg)}</span>
          </div>
        </div>`
    }
    return `
      <div class="panel room">
        <h2>Play online</h2>
        <p class="hint" style="margin-bottom:14px">Open a room, share the 4-letter code, and everyone's
        calls land on the same board live &mdash; no copy-pasting cards.</p>
        <div class="row">
          <button class="btn mint" id="create-room" ${state.me ? '' : 'disabled'}>Create a room</button>
          <form id="join-form" class="row" style="flex:1;min-width:220px">
            <input type="text" id="join-input" placeholder="Room code" maxlength="8" autocomplete="off" style="max-width:150px">
            <button class="btn ghost" type="submit" ${state.me ? '' : 'disabled'}>Join</button>
          </form>
          <span class="hint" id="room-msg">${state.me ? esc(ui.msg) : 'Set your name first.'}</span>
        </div>
      </div>`
  }

  function viewSetup() {
    return `
      <h1>Who's playing?</h1>
      <p class="lead">Everyone in the lobby calls one skin per friend &mdash; the skin they bet is sitting
      in that friend's daily shop right now. Add the squad, make your calls, then compare the board.</p>
      <div class="panel">
        <h2>Your name</h2>
        <form id="me-form" class="row">
          <input type="text" id="me-input" placeholder="e.g. Matus" value="${esc(state.me)}" maxlength="24" autocomplete="off">
          <button class="btn" type="submit">Save</button>
        </form>
        <div class="sep"></div>
        <h2>The squad</h2>
        <form id="add-form" class="row">
          <input type="text" id="add-input" placeholder="Add a friend&hellip;" maxlength="24" autocomplete="off">
          <button class="btn ghost" type="submit">Add</button>
        </form>
        <ul class="players">
          ${state.players.map((p) => `
            <li>
              <span class="who">${esc(p)}</span>
              ${p === state.me ? '<span class="tag">you</span>' : ''}
              <button class="x" data-remove="${esc(p)}" title="Remove">&times;</button>
            </li>`).join('') || '<li><span class="hint">No one here yet.</span></li>'}
        </ul>
        <div class="sep"></div>
        <div class="row">
          <button class="btn" id="start" ${state.me && others().length ? '' : 'disabled'}>Start calling</button>
          <span class="hint">${state.me && others().length
            ? `You'll call ${others().length} skin${others().length > 1 ? 's' : ''}.`
            : 'Set your name and add at least one friend.'}</span>
        </div>
      </div>
      <div class="sep"></div>
      ${roomPanel()}
      <div class="sep"></div>
      <div class="panel">
        <h2>Offline: paste a card</h2>
        <p class="hint" style="margin-bottom:12px">If you'd rather not use a room, friends can send you their
        card link instead.</p>
        <form id="import-form">
          <textarea class="code" id="import-input" placeholder="Paste a share link or code here&hellip;"></textarea>
          <div class="row" style="margin-top:10px">
            <button class="btn ghost" type="submit">Add to board</button>
            <span class="hint" id="import-msg"></span>
          </div>
        </form>
      </div>`
  }

  function targetStrip() {
    return `<div class="targets">${others().map((p) => {
      const id = state.picks[p]
      const hit = id && skinIndex.get(id)
      return `<button class="target ${hit ? 'done' : ''}" data-target="${esc(p)}"
        aria-current="${p === ui.target}">
        ${hit ? `<img class="thumb" src="${hit.skin.icon}" alt="" loading="lazy">` : '<span class="dot"></span>'}
        <span>${esc(p)}</span>
      </button>`
    }).join('')}</div>`
  }

  function viewPick() {
    if (!ui.target || !others().includes(ui.target)) ui.target = others().find((p) => !state.picks[p]) || others()[0]
    if (!ui.target) return viewSetup()

    const current = state.picks[ui.target] && skinIndex.get(state.picks[ui.target])

    let body
    if (!ui.category) {
      body = `
        <h2>1 &mdash; Weapon type</h2>
        <div class="chips">${DATA.categories.map((c) => `
          <button class="chip" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        <div class="hint">${DATA.weapons.reduce((n, w) => n + w.skins.length, 0)} buyable skins.
        Knives only ever drop in bundles and the Night Market &mdash; call one at your own risk.</div>`
    } else if (!ui.weapon) {
      const list = DATA.weapons.filter((w) => w.category === ui.category)
      if (list.length === 1) ui.weapon = list[0].id
      body = list.length === 1 ? '' : `
        <h2>2 &mdash; Which gun?</h2>
        <div class="weapons">${list.map((w) => `
          <button class="weapon" data-weapon="${w.id}">
            <img src="${w.icon}" alt="${esc(w.name)}" loading="lazy">
            <span class="nm">${esc(w.name)}</span>
            <span class="ct">${w.skins.length} skins</span>
          </button>`).join('')}</div>`
    }
    if (ui.weapon) {
      const w = DATA.weapons.find((x) => x.id === ui.weapon)
      const q = ui.q.trim().toLowerCase()
      const list = w.skins.filter((s) => (!ui.tier || s.tier === ui.tier) && (!q || s.name.toLowerCase().includes(q)))
      body = `
        <h2>${w.category === 'Melee' ? '2' : '3'} &mdash; Which skin?</h2>
        <div class="row" style="margin-bottom:14px">
          <input type="text" id="search" placeholder="Search ${esc(w.name)} skins&hellip;" value="${esc(ui.q)}" autocomplete="off" style="max-width:280px">
        </div>
        <div class="chips">
          <button class="chip" data-tier="" aria-pressed="${ui.tier === ''}">All tiers</button>
          ${Object.keys(DATA.tiers).map((t) => `
            <button class="chip" data-tier="${t}" aria-pressed="${ui.tier === t}">${t}</button>`).join('')}
        </div>
        <div class="skins">${list.map((s) => `
          <button class="skin" data-skin="${s.id}" style="--tier:${tierColor(s.tier)}"
            aria-pressed="${state.picks[ui.target] === s.id}">
            <img src="${s.icon}" alt="${esc(s.full)}" loading="lazy">
            <span class="nm">${esc(s.name)}</span>
            <span class="meta"><span class="pill">${esc(s.tier)}</span> ${DATA.tiers[s.tier].vp} VP</span>
          </button>`).join('')}</div>
        ${list.length ? '' : '<p class="empty">No skin matches that.</p>'}`
    }

    const wName = ui.weapon && DATA.weapons.find((x) => x.id === ui.weapon).name

    return `
      <h1>What's in ${esc(ui.target)}'s shop?</h1>
      <p class="lead">Called ${myDone()} of ${others().length}.${current
        ? ` Current call for ${esc(ui.target)}: <strong>${esc(current.skin.name)}${
            current.weapon.category === 'Melee' ? '' : ' ' + esc(current.weapon.name)}</strong>.`
        : ''}${state.room ? ` <span class="status ${net.status}">${net.status === 'live'
          ? 'Room ' + esc(state.room) + ' &middot; live' : 'Room ' + esc(state.room) + ' &middot; offline'}</span>` : ''}</p>
      ${targetStrip()}
      <div class="panel">
        <div class="crumbs">
          <button data-crumb="cat">Weapon type</button>
          ${ui.category ? `<span>&rsaquo;</span><button data-crumb="weapon">${esc(ui.category)}</button>` : '<span>&rsaquo;</span><span>&hellip;</span>'}
          ${ui.weapon && wName !== ui.category ? `<span>&rsaquo;</span><span>${esc(wName)}</span>` : ''}
        </div>
        ${body}
      </div>
      <div class="sep"></div>
      <div class="row">
        <button class="btn" data-goto="board" ${myDone() ? '' : 'disabled'}>See the board</button>
        <button class="btn ghost" data-goto="share">Share my card</button>
      </div>`
  }

  function viewShare() {
    const missing = others().filter((p) => !state.picks[p])
    return `
      <h1>Your card</h1>
      <p class="lead">${state.room
        ? `You're in room <strong>${esc(state.room)}</strong> &mdash; your calls already sync there.
           This link is for anyone who'd rather stay offline.`
        : 'Send this to the squad. When they open the link, your calls drop straight onto their board.'}</p>
      ${missing.length ? `<div class="panel" style="margin-bottom:16px"><span class="hint">Still no call for
        <strong>${missing.map(esc).join(', ')}</strong>.</span></div>` : ''}
      ${state.room ? '' : roomPanel() + '<div class="sep"></div>'}
      <div class="panel">
        <h2>Card link</h2>
        <textarea class="code" id="share-out" readonly>${esc(state.room ? roomLink() : shareLink())}</textarea>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="copy">Copy link</button>
          <button class="btn ghost" data-goto="pick">Back to calling</button>
          <span class="hint" id="copy-msg"></span>
        </div>
      </div>
      <div class="sep"></div>
      ${cardsHtml({ [state.me]: state.picks })}`
  }

  function viewBoard() {
    const cards = allCards()
    const pickers = Object.keys(cards)
    if (!pickers.length) return `<h1>The board</h1><p class="lead">Nothing called yet.</p>${roomPanel()}`

    if (state.room && !allIn()) {
      return `
        <h1>The board</h1>
        <p class="lead">Sealed until you've called everyone &mdash; no peeking at other people's reads first.</p>
        <div class="panel">
          <h2>${pickers.length} card${pickers.length > 1 ? 's' : ''} in the room</h2>
          <ul class="players">
            ${pickers.map((p) => `<li><span class="who">${esc(p)}</span>
              <span class="tag">${Object.keys(cards[p]).length} call${Object.keys(cards[p]).length === 1 ? '' : 's'}</span></li>`).join('')}
          </ul>
          <div class="sep"></div>
          <div class="row">
            <button class="btn" data-goto="pick">Finish my calls (${myDone()}/${others().length})</button>
          </div>
        </div>
        <div class="sep"></div>
        ${roomPanel()}`
    }

    const byTarget = {}
    for (const picker of pickers)
      for (const [target, id] of Object.entries(cards[picker])) {
        (byTarget[target] = byTarget[target] || []).push([picker, id])
      }

    return `
      <h1>The board</h1>
      <p class="lead">${pickers.length} card${pickers.length > 1 ? 's' : ''} in
      (${pickers.map(esc).join(', ')}). Open your real shop and see who read you right.</p>
      <div class="cards">
        ${Object.entries(byTarget).map(([target, calls]) => `
          <div class="card">
            <h3>In ${esc(target)}'s shop&hellip;</h3>
            <ul class="calls">
              ${calls.map(([picker, id]) => {
                const hit = skinIndex.get(id)
                if (!hit) return ''
                return `<li>
                  <img src="${hit.skin.icon}" alt="" loading="lazy">
                  <div class="txt">
                    <div class="nm" style="color:${tierColor(hit.skin.tier)}">${esc(hit.skin.name)}${
                      hit.weapon.category === 'Melee' ? '' : ' ' + esc(hit.weapon.name)}</div>
                    <div class="sub">${esc(picker)}'s call &middot; ${esc(hit.skin.tier)} &middot; ${DATA.tiers[hit.skin.tier].vp} VP</div>
                  </div>
                </li>`
              }).join('')}
            </ul>
          </div>`).join('')}
      </div>
      <div class="sep"></div>
      ${roomPanel()}
      ${state.room ? '' : `
        <div class="sep"></div>
        <div class="panel">
          <h2>Add another card</h2>
          <form id="import-form">
            <textarea class="code" id="import-input" placeholder="Paste a friend's link or code&hellip;"></textarea>
            <div class="row" style="margin-top:10px">
              <button class="btn ghost" type="submit">Add to board</button>
              <span class="hint" id="import-msg"></span>
            </div>
          </form>
        </div>`}`
  }

  function cardsHtml(cards) {
    return `<div class="cards">${Object.entries(cards).map(([picker, picks]) => `
      <div class="card">
        <h3>${esc(picker)}'s calls</h3>
        <ul class="calls">
          ${Object.entries(picks).map(([target, id]) => {
            const hit = skinIndex.get(id)
            if (!hit) return ''
            return `<li>
              <img src="${hit.skin.icon}" alt="" loading="lazy">
              <div class="txt">
                <div class="nm">${esc(target)}</div>
                <div class="sub" style="color:${tierColor(hit.skin.tier)}">${esc(hit.skin.name)}${
                  hit.weapon.category === 'Melee' ? '' : ' ' + esc(hit.weapon.name)}</div>
              </div>
            </li>`
          }).join('')}
        </ul>
      </div>`).join('')}</div>`
  }

  /* ---------- render + events ---------- */
  function render() {
    nav.hidden = !state.me
    for (const b of nav.querySelectorAll('[data-goto]'))
      b.setAttribute('aria-current', String(b.dataset.goto === ui.view))
    app.innerHTML = ui.view === 'setup' ? viewSetup()
      : ui.view === 'share' ? viewShare()
      : ui.view === 'board' ? viewBoard()
      : viewPick()
    wire()
  }

  // re-render on incoming room data, but never yank a field the user is typing in
  function repaint() {
    const a = document.activeElement
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return
    render()
  }

  function wire() {
    const $ = (s) => app.querySelector(s)

    const meForm = $('#me-form')
    if (meForm) meForm.onsubmit = (e) => {
      e.preventDefault()
      const v = $('#me-input').value.trim()
      if (!v) return
      const old = state.me
      state.me = v
      const i = state.players.findIndex((p) => p === old)
      if (old && i >= 0) state.players[i] = v
      else addPlayers([v])
      save()
      if (state.room) connect()
      render()
    }

    const addForm = $('#add-form')
    if (addForm) addForm.onsubmit = (e) => {
      e.preventDefault()
      addPlayers([$('#add-input').value.trim()])
      save(); render()
    }

    for (const b of app.querySelectorAll('[data-remove]')) b.onclick = () => {
      const p = b.dataset.remove
      state.players = state.players.filter((x) => x !== p)
      delete state.picks[p]
      if (state.me === p) { state.me = ''; disconnect() }
      save(); publish(); render()
    }

    const start = $('#start')
    if (start) start.onclick = () => go('pick', { target: null, category: null, weapon: null })

    const create = $('#create-room')
    if (create) create.onclick = () => { joinRoom(newRoom()); go('pick') }

    const joinForm = $('#join-form')
    if (joinForm) joinForm.onsubmit = (e) => {
      e.preventDefault()
      if (joinRoom($('#join-input').value)) go(others().length ? 'pick' : 'setup')
      else { ui.msg = 'Enter a room code.'; render() }
    }

    const leave = $('#leave-room')
    if (leave) leave.onclick = () => { leaveRoom(); render() }

    const copyRoom = $('#copy-room')
    if (copyRoom) copyRoom.onclick = async () => {
      try { await navigator.clipboard.writeText(roomLink()) } catch (e) { /* no clipboard */ }
      $('#room-msg').textContent = 'Invite link copied.'
    }

    for (const b of app.querySelectorAll('[data-target]')) b.onclick = () =>
      go('pick', { target: b.dataset.target, category: null, weapon: null, q: '' })

    for (const b of app.querySelectorAll('[data-cat]')) b.onclick = () =>
      go('pick', { category: b.dataset.cat, weapon: null, q: '', tier: '' })

    for (const b of app.querySelectorAll('[data-weapon]')) b.onclick = () =>
      go('pick', { weapon: b.dataset.weapon, q: '', tier: '' })

    for (const b of app.querySelectorAll('[data-tier]')) b.onclick = () => go('pick', { tier: b.dataset.tier })

    for (const b of app.querySelectorAll('[data-crumb]')) b.onclick = () =>
      go('pick', b.dataset.crumb === 'cat' ? { category: null, weapon: null } : { weapon: null })

    const search = $('#search')
    if (search) search.oninput = () => {
      ui.q = search.value
      render()
      const s = app.querySelector('#search')
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length) }
    }

    for (const b of app.querySelectorAll('[data-skin]')) b.onclick = () => {
      state.picks[ui.target] = b.dataset.skin
      save()
      publish(600)
      const next = others().find((p) => !state.picks[p])
      go(next ? 'pick' : (state.room ? 'board' : 'share'),
        { target: next || ui.target, category: null, weapon: null, q: '', tier: '' })
    }

    const copy = $('#copy')
    if (copy) copy.onclick = async () => {
      const out = $('#share-out')
      try { await navigator.clipboard.writeText(out.value) } catch (e) { out.select() }
      $('#copy-msg').textContent = 'Copied. Paste it in the group chat.'
    }

    const imp = $('#import-form')
    if (imp) imp.onsubmit = (e) => {
      e.preventDefault()
      const raw = $('#import-input').value.trim()
      const code = raw.includes('#c=') ? raw.split('#c=')[1] : raw
      try { importCode(code); go('board') } catch (err) {
        $('#import-msg').textContent = "That doesn't look like a card."
      }
    }
  }

  for (const b of nav.querySelectorAll('[data-goto]')) b.onclick = () => go(b.dataset.goto)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#app [data-goto]')
    if (b && !b.disabled) go(b.dataset.goto)
  })

  /* ---------- boot ---------- */
  fetch('skins.json').then((r) => r.json()).then((data) => {
    DATA = data
    for (const w of DATA.weapons) for (const s of w.skins) skinIndex.set(s.id, { skin: s, weapon: w })
    load()

    const card = location.hash.match(/#c=(.+)$/)
    const room = location.hash.match(/#r=([A-Za-z0-9]+)/)
    if (card) {
      try {
        const { who } = readCard(card[1])
        if (who !== state.me) { importCode(card[1]); ui.view = 'board' }
      } catch (e) { /* junk hash */ }
    } else if (room) {
      state.room = room[1].toUpperCase()
      state.cards = {}
      save()
      ui.view = state.me ? 'pick' : 'setup'
    }
    if (location.hash) history.replaceState(null, '', location.pathname)

    if (ui.view === 'setup' && state.me && others().length) ui.view = 'pick'
    if (state.room) connect()
    render()
  }).catch(() => {
    app.innerHTML = '<h1>Could not load skin data</h1><p class="lead">Reload the page.</p>'
  })
})()
