// TrailSafe owner console (wf-14). One page: signs the owner in (email code, then an authenticator code) and talks to the owner-api server
// function with that sign-in. Nothing secret is in this file: the database's master key lives only on the server.
const SUPABASE_URL = 'https://qpezqayqbghujlwjgemu.supabase.co'
const SUPABASE_KEY = 'sb_publishable_sbcMyfC8UcLTJ0g-i2vduw_RGy7CiEp'
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, storageKey: 'trailsafe-owner' } })

const TURNSTILE_SITE_KEY = '0x4AAAAAAFvFaEQHEPuX1Iu7'   // public by design
const $ = (s) => document.querySelector(s)
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const when = (iso) => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }
const slugOf = (n) => n.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500) }

// ---------- talking to the server ----------
async function api(action, args = {}) {
  const { data: s } = await sb.auth.getSession()
  const token = s.session?.access_token
  if (!token) throw new Error('sign_in')
  const res = await fetch(`${SUPABASE_URL}/functions/v1/owner-api`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...args }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || String(res.status))
  return j
}
const say = (e) => ({ sign_in: 'Please sign in again.', two_step: 'The authenticator code is needed.', not_owner: 'This account is not the owner account.' }[e.message] || e.message)

// ---------- confirm box (wf-14: every change names who and what, and says it is recorded) ----------
function confirmBox({ title, text, verb, danger = false }) {
  return new Promise((ok) => {
    const m = $('#modal')
    m.innerHTML = `<div class="box"><h2>${esc(title)}</h2><p>${esc(text)}</p><p class="muted">This is recorded in the audit trail.</p>
      <div class="row"><button class="btn ${danger ? 'warn' : 'go'}" id="yes">${esc(verb)}</button><button class="btn" id="no">Cancel</button></div></div>`
    m.hidden = false
    const done = (v) => { m.hidden = true; m.innerHTML = ''; ok(v) }
    $('#yes').onclick = () => done(true); $('#no').onclick = () => done(false)
  })
}


// ---------- the bot check (Cloudflare Turnstile): Supabase now asks for it when an email code is requested ----------
let captchaLoad = null
function captchaToken() {
  captchaLoad = captchaLoad || new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.onload = ok; s.onerror = no; document.head.appendChild(s) })
  return captchaLoad.then(() => new Promise((ok, no) => {
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;left:0;right:0;bottom:24px;display:flex;justify-content:center;z-index:60'; document.body.appendChild(box)
    let id; const gone = () => { try { window.turnstile.remove(id) } catch {} box.remove() }
    id = window.turnstile.render(box, { sitekey: TURNSTILE_SITE_KEY, appearance: 'interaction-only', retry: 'auto', callback: (t) => { gone(); ok(t) } })
    setTimeout(() => { gone(); no(new Error('captcha')) }, 120000)
  }))
}

// ---------- sign in: email code, then authenticator code ----------
function loginShell(inner) {
  $('#app').innerHTML = `<div class="login"><h1>TrailSafe owner console</h1><div class="panel">${inner}</div></div>`
}
function showEmailStep(msg = '') {
  loginShell(`<p>Sign in with the owner email. We send a 6-digit code to it.</p><label for="em">Email</label><input id="em" type="email" autocomplete="username" autofocus>
    <div class="row" style="margin-top:14px"><button class="btn go" id="send">Send code</button></div><div class="err" id="e">${esc(msg)}</div>`)
  $('#send').onclick = async () => {
    const email = $('#em').value.trim().toLowerCase()
    if (!email) return
    $('#send').disabled = true
    let captchaToken_; try { captchaToken_ = await captchaToken() } catch { $('#e').textContent = 'The bot check did not pass. If you use a VPN, switch it off for a moment and try again.'; $('#send').disabled = false; return }
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, captchaToken: captchaToken_ } })
    if (error) { $('#e').textContent = error.message; $('#send').disabled = false; return }
    showCodeStep(email)
  }
}
function showCodeStep(email, msg = '') {
  loginShell(`<p>We sent a 6-digit code to <b>${esc(email)}</b>.</p><label for="cd">Email code</label><input id="cd" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" autofocus>
    <div class="row" style="margin-top:14px"><button class="btn go" id="ok">Continue</button><button class="btn" id="back">Use another email</button></div><div class="err" id="e">${esc(msg)}</div>`)
  $('#back').onclick = () => showEmailStep()
  $('#ok').onclick = async () => {
    const token = $('#cd').value.trim()
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' })
    if (error) { $('#e').textContent = 'That code did not work. Try again.'; return }
    start()
  }
}
async function showAuthenticatorStep() {
  const { data: f } = await sb.auth.mfa.listFactors()
  const verified = (f?.totp ?? []).find((x) => x.status === 'verified')
  if (verified) {
    loginShell(`<p>Enter the 6-digit code from your authenticator app.</p><label for="tc">Authenticator code</label><input id="tc" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" autofocus>
      <div class="row" style="margin-top:14px"><button class="btn go" id="ok">Sign in</button></div><div class="err" id="e"></div>`)
    $('#ok').onclick = async () => {
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: verified.id, code: $('#tc').value.trim() })
      if (error) { $('#e').textContent = 'That code did not work. Try again.'; return }
      start()
    }
    return
  }
  for (const x of f?.all ?? []) if (x.factor_type === 'totp' && x.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: x.id })   // an unfinished set-up from before
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'TrailSafe owner' })
  if (error) return showEmailStep(error.message)
  loginShell(`<p><b>One-time set-up.</b> Scan this with an authenticator app (Google Authenticator, Authy, 1Password…), then enter the 6-digit code it shows.</p>
    <div class="qr"><img alt="QR code" src="${esc(data.totp.qr_code)}"></div><p class="muted">Or type this key in: <span class="secret">${esc(data.totp.secret)}</span></p>
    <label for="tc">Authenticator code</label><input id="tc" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
    <div class="row" style="margin-top:14px"><button class="btn go" id="ok">Finish set-up</button></div><div class="err" id="e"></div>`)
  $('#ok').onclick = async () => {
    const { error: e2 } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: $('#tc').value.trim() })
    if (e2) { $('#e').textContent = 'That code did not work. Try again.'; return }
    start()
  }
}

// ---------- the console ----------
let me = null, counts = { requests: 0, feedback: 0 }
async function start() {
  const { data: s } = await sb.auth.getSession()
  if (!s.session) return showEmailStep()
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal?.currentLevel !== 'aal2') return showAuthenticatorStep()
  try { me = (await api('whoami')).email } catch (e) { await sb.auth.signOut(); return showEmailStep(say(e)) }
  route()
}
async function refreshCounts() {
  try {
    const [r, f] = await Promise.all([api('group_requests'), api('feedback')])
    counts = { requests: r.data.filter((x) => x.status === 'new').length, feedback: f.data.filter((x) => x.status === 'new').length }
  } catch { /* the counts are a nicety */ }
}
const NAV = [['communities', 'Communities'], ['people', 'People'], ['alerts', 'Alert log'], ['health', 'Health'], ['requests', 'Group requests'], ['feedback', 'Feedback'], ['audit', 'Audit trail']]
function shell(active, inner) {
  const badge = (k) => (k === 'requests' && counts.requests ? `<span class="count">${counts.requests}</span>` : k === 'feedback' && counts.feedback ? `<span class="count">${counts.feedback}</span>` : '')
  $('#app').innerHTML = `<div class="layout"><nav><div class="brand">TrailSafe</div><div class="sub">Owner console</div>
    ${NAV.map(([k, l]) => `<a href="#/${k}" class="${k === active ? 'on' : ''}">${l}${badge(k)}</a>`).join('')}
    <div class="who">${esc(me)}<br><button id="signout">Sign out</button></div></nav><main>${inner}</main></div>`
  $('#signout').onclick = async () => { await sb.auth.signOut(); showEmailStep() }
}
async function guard(fn) { try { await fn() } catch (e) { if (['sign_in', 'two_step'].includes(e.message)) return start(); toast(say(e)) } }

window.addEventListener('hashchange', () => me && route())
function route() {
  const h = location.hash.replace(/^#\/?/, '')
  const [p, a, b] = h.split('?')[0].split('/')
  const q = new URLSearchParams(h.split('?')[1] || '')
  guard(async () => {
    if (!p || p === 'communities') return viewCommunities()
    if (p === 'community' && a === 'new') return viewCreate(q.get('from'))
    if (p === 'community' && b === 'edit') return viewEdit(a)
    if (p === 'community') return viewCommunity(a)
    if (p === 'people') return viewPeople()
    if (p === 'requests') return viewRequests()
    if (p === 'request') return viewRequest(a)
    if (p === 'feedback') return viewFeedback(q.get('f') || 'all')
    if (p === 'report') return viewReport(a)
    if (p === 'alerts') return viewAlerts()
    if (p === 'health') return viewHealth()
    if (p === 'audit') return viewAudit()
    return viewCommunities()
  })
}


// ---- I: health and numbers (counts only; no locations, ever) ----
const dur = (s) => (s == null ? '—' : s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`)
async function viewHealth() {
  const [{ data: h }, { data: pilot }] = await Promise.all([api('ops_status'), api('pilot')])
  const stuck = h.outbox_pending > 0 && (h.outbox_oldest_age_s ?? 0) > 300
  const tile = (ok, big, label, line) => `<div class="tile ${ok === null ? '' : ok ? 'ok' : 'bad'}"><div class="big">${esc(big)}</div><div class="lab">${esc(label)}</div><div class="line">${esc(line)}</div></div>`
  const at = new Date(h.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  shell('health', `<h1>Health and numbers</h1><p class="hint">Counts only. Checked ${esc(at)}. <a href="#/health">Check again</a></p>
    <h2>Is it working?</h2><div class="tiles">
    ${tile(!stuck, h.outbox_pending, 'Notifications waiting', stuck ? 'Notifications are waiting longer than 5 minutes. Look now.' : 'Nothing is stuck.')}
    ${tile(!stuck, h.outbox_pending ? dur(h.outbox_oldest_age_s) : '—', 'Oldest waiting', h.outbox_pending ? (stuck ? 'Waiting too long.' : 'Waiting a short while.') : 'Nothing waiting.')}
    ${tile(h.outbox_gave_up === 0, h.outbox_gave_up, 'Gave up', h.outbox_gave_up ? 'A notification failed for good. Look now.' : 'No notification failed for good.')}
    ${tile(h.alerts_overdue === 0, h.alerts_overdue, 'Alerts overdue', h.alerts_overdue ? 'An alert is still live after it should have expired. Look now.' : 'No alert is overdue.')}
    ${tile(null, h.out_now, 'Out right now', 'Members sharing or hiding.')}
    ${tile(true, 'OK', 'Last health check', at)}</div>
    <h2>The pilot so far</h2><div class="tiles three">
    ${tile(null, pilot.signups, 'Sign-ups', 'People who have an account.')}
    ${tile(null, pilot.approvals, 'Approvals', 'People now in a community.')}
    ${tile(null, pilot.median_approval_s == null ? '—' : dur(pilot.median_approval_s), 'Median time to approve', 'From asking to being approved.')}</div>
    <p class="hint">Green means fine; red means look now, with one line saying why. No locations, ever.</p>`)
}

// ---- J / K: the alert log across every community (last 7 days) ----
const dayTime = (iso) => { if (!iso) return ''; const d = new Date(iso); const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); const today = new Date().toDateString() === d.toDateString()
  return (today ? 'Today ' : d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ') + t }
async function viewAlerts() {
  const { data } = await api('alert_log')
  shell('alerts', `<h1>Alert log</h1><p class="hint">Every community, last 7 days. Use Hide only for a false or malicious alert.</p>
    <table><tr><th>Community</th><th>Sender</th><th>Sent</th><th>Ended</th><th>Started at</th><th></th></tr>
    ${data.map((a) => `<tr><td>${esc(a.community || '')}</td><td>${esc(a.sender_name || 'A former member')}</td><td>${esc(dayTime(a.started_at))}</td>
      <td>${a.end_kind === 'expired' ? 'Expired ' : ''}${esc(a.ended_at ? new Date(a.ended_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')}</td>
      <td>${a.lat == null ? '' : `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}`}</td>
      <td>${a.hidden ? `<span class="muted" title="${esc(a.hidden_reason || '')}">Hidden</span>` : `<button class="btn small warn" data-hide="${a.alert_id}" data-who="${esc(a.sender_name || 'A former member')}" data-c="${esc(a.community || '')}" data-t="${esc(dayTime(a.started_at))}">Hide entry</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No alerts in the last 7 days.</td></tr>'}</table>
    <p class="hint">The one place a coordinate appears: the same one every member can already read in the app. A hidden entry vanishes from members’ logs and stays here for the audit.</p>`)
  document.querySelectorAll('[data-hide]').forEach((b) => (b.onclick = () => guard(async () => {
    const reason = await reasonBox({ title: `Hide ${b.dataset.who}’s alert from ${b.dataset.c}?`, text: `${b.dataset.t}. It disappears from members’ logs and stays here, marked Hidden.`, verb: 'Hide entry' })
    if (!reason) return
    await api('hide_alert', { alert: b.dataset.hide, reason }); toast('Hidden.'); viewAlerts()
  })))
}
// a confirm box that also asks for the reason (wf-14 K: a reason is required)
function reasonBox({ title, text, verb }) {
  return new Promise((ok) => {
    const m = $('#modal')
    m.innerHTML = `<div class="box"><h2>${esc(title)}</h2><p>${esc(text)}</p><label for="why">Why? (required)</label><input id="why" type="text" maxlength="500" autofocus>
      <p class="muted">This is recorded in the audit trail.</p><div class="row"><button class="btn warn" id="yes" disabled>${esc(verb)}</button><button class="btn" id="no">Cancel</button></div></div>`
    m.hidden = false
    const done = (v) => { m.hidden = true; m.innerHTML = ''; ok(v) }
    $('#why').oninput = () => { $('#yes').disabled = !$('#why').value.trim() }
    $('#yes').onclick = () => done($('#why').value.trim()); $('#no').onclick = () => done(null)
  })
}

// a confirm box with a choice of communities
function pickBox({ title, text, options, verb }) {
  return new Promise((ok) => {
    const m = $('#modal')
    m.innerHTML = `<div class="box"><h2>${esc(title)}</h2><p>${esc(text)}</p><label for="to">Move to</label><select id="to">${options.map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join('')}</select>
      <p class="muted">This is recorded in the audit trail.</p><div class="row"><button class="btn go" id="yes">${esc(verb)}</button><button class="btn" id="no">Cancel</button></div></div>`
    m.hidden = false
    const done = (v) => { m.hidden = true; m.innerHTML = ''; ok(v) }
    $('#yes').onclick = () => { const sel = $('#to'); done({ id: sel.value, name: sel.options[sel.selectedIndex].text }) }; $('#no').onclick = () => done(null)
  })
}

// ---- B: communities ----
async function viewCommunities() {
  await refreshCounts()
  const { data } = await api('communities')
  shell('communities', `<div class="row" style="justify-content:space-between"><div><h1>Communities</h1><p class="hint">${data.length} communit${data.length === 1 ? 'y' : 'ies'}</p></div><a class="btn go" href="#/community/new" style="text-decoration:none">Create community</a></div>
    <table><tr><th>Name</th><th>Members</th><th>Admins</th><th>Waiting to join</th><th>Codes out</th><th></th></tr>
    ${data.map((c) => { const days = c.oldest_request_age_s == null ? null : Math.floor(c.oldest_request_age_s / 86400)
      return `<tr><td><b>${esc(c.name)}</b></td><td><a href="#/community/${c.community_id}">${c.members}</a></td><td>${c.admins}</td>
        <td>${c.waiting}${days != null ? ` · <span class="${days > 7 ? 'red' : 'muted'}">oldest ${days} day${days === 1 ? '' : 's'}</span>` : ''}</td><td>${c.codes_out}</td>
        <td><a href="#/community/${c.community_id}/edit">Edit</a></td></tr>` }).join('') || '<tr><td colspan="6" class="muted">No communities yet.</td></tr>'}</table>
    <p class="hint">Click a member count to see who is in the community. A waiting request older than 7 days shows in red.</p>`)
}

// ---- D: who is in a community ----
async function viewCommunity(id) {
  const [{ data: info }, { data: members }] = await Promise.all([api('community_info', { community: id }), api('community_members', { community: id })])
  if (!info) return toast('Unknown community.')
  const admins = members.filter((m) => m.role === 'admin').length
  shell('communities', `<p><a href="#/communities">‹ Communities</a></p><div class="row" style="justify-content:space-between"><div><h1>${esc(info.name)} — ${members.length} member${members.length === 1 ? '' : 's'}</h1><p class="hint">${admins} admin${admins === 1 ? '' : 's'}</p></div><a class="btn" href="#/community/${id}/edit" style="text-decoration:none">Edit community</a></div>
    <table><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr>
    ${members.map((m) => `<tr><td><b>${esc(m.full_name)}</b></td><td>${esc(m.email)}</td><td>${m.role === 'admin' ? 'Admin' : 'Member'}</td>
      <td class="row"><button class="btn small" data-role="${m.role === 'admin' ? 'member' : 'admin'}" data-u="${m.user_id}" data-n="${esc(m.full_name)}">${m.role === 'admin' ? 'Remove admin rights' : 'Make admin'}</button>
      <button class="btn small" data-mv="${m.user_id}" data-n="${esc(m.full_name)}">Move to…</button>
      <button class="btn small warn" data-rm="${m.user_id}" data-n="${esc(m.full_name)}">Remove</button></td></tr>`).join('')}</table>
    <p class="hint">Names and activity only — never a location.</p>`)
  document.querySelectorAll('[data-role]').forEach((b) => (b.onclick = () => guard(async () => {
    const admin = b.dataset.role === 'admin'
    if (!(await confirmBox(admin ? { title: `Make ${b.dataset.n} an admin of ${info.name}?`, text: 'They’ll be able to approve and remove members.', verb: 'Make admin' }
      : { title: `Remove admin rights from ${b.dataset.n}?`, text: 'They stay a member.', verb: 'Remove admin rights' }))) return
    await api('set_role', { community: id, user: b.dataset.u, role: b.dataset.role }); toast('Done.'); viewCommunity(id)
  })))
  document.querySelectorAll('[data-mv]').forEach((b) => (b.onclick = () => guard(async () => {
    const { data: all } = await api('communities')
    const others = all.filter((x) => x.community_id !== id && x.is_active !== false)
    if (!others.length) return toast('There is no other community to move to.')
    const to = await pickBox({ title: `Move ${b.dataset.n} from ${info.name} to…`, options: others.map((x) => [x.community_id, x.name]),
      text: 'They leave this community and join the other one straight away. A live alert of theirs ends, and they press Start again.', verb: 'Move' })
    if (!to) return
    await api('move_member', { user: b.dataset.mv, from: id, to: to.id }); toast(`${b.dataset.n} is now in ${to.name}.`); viewCommunity(id)
  })))
  document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => guard(async () => {
    if (!(await confirmBox({ title: `Remove ${b.dataset.n} from ${info.name}?`, text: 'They lose access straight away and can ask to join again.', verb: 'Remove from community', danger: true }))) return
    await api('remove_member', { community: id, user: b.dataset.rm }); toast('Removed.'); viewCommunity(id)
  })))
}

// ---- C / S: create community (optionally from a group request) ----
async function viewCreate(fromId) {
  const [{ data: regions }, reqs] = await Promise.all([api('regions'), fromId ? api('group_requests') : Promise.resolve({ data: [] })])
  const req = fromId ? reqs.data.find((r) => r.id === fromId) : null
  let admin = req?.asker_id ? { id: req.asker_id, name: req.asker_name, email: req.asker_email } : null
  shell('communities', `<p><a href="#/${req ? 'request/' + fromId : 'communities'}">‹ ${req ? 'The request' : 'Communities'}</a></p><h1>Create community</h1>
    <p class="hint">${req ? `From the request by ${esc(req.asker_name || 'a former member')}. Check it, change anything, then create.` : 'You can add the first admin now, or later.'}</p>
    <div class="panel"><label for="nm">Community name</label><input id="nm" type="text" value="${esc(req?.group_name || '')}">
    <label for="rg">Map region</label><select id="rg"><option value="">None yet</option>${regions.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
    <p class="hint">The map file this community’s members get on their phones. ${req ? `The request said “${esc(req.where_text)}”.` : ''}</p>
    <label>First admin</label><div id="adm"></div><div id="srch"></div>
    <div class="row" style="margin-top:20px"><button class="btn go" id="mk">Create community</button><a class="btn" href="#/communities" style="text-decoration:none">Cancel</a></div></div>`)
  const drawAdmin = () => {
    $('#adm').innerHTML = admin ? `<p><b>${esc(admin.name)}</b> · ${esc(admin.email)} <button class="btn small" id="chg">Change</button></p>` : `<input id="q" type="search" placeholder="Search people who have signed up by name or email">`
    if (admin) $('#chg').onclick = () => { admin = null; drawAdmin() }
    else $('#q').oninput = debounce(async () => {
      const v = $('#q').value.trim(); if (v.length < 2) { $('#srch').innerHTML = ''; return }
      const { data } = await api('search_people', { query: v })
      $('#srch').innerHTML = `<table>${data.slice(0, 10).map((p, i) => `<tr><td><b>${esc(p.full_name)}</b><br><small class="muted">${esc(p.email)}</small></td><td>${esc(p.community || 'Not in a community')}</td><td><button class="btn small" data-i="${i}">Choose</button></td></tr>`).join('')}</table>`
      document.querySelectorAll('#srch [data-i]').forEach((b) => (b.onclick = () => { const p = data[+b.dataset.i]; admin = { id: p.user_id, name: p.full_name, email: p.email }; $('#srch').innerHTML = ''; drawAdmin() }))
    }, 250)
  }
  drawAdmin()
  $('#mk').onclick = () => guard(async () => {
    const name = $('#nm').value.trim(); if (!name) return toast('Give the community a name.')
    $('#mk').disabled = true
    try {
      const { data: id } = await api('create_community', { name, slug: slugOf(name), first_admin: admin?.id ?? null })
      const region = $('#rg').value; if (region) await api('set_region', { community: id, region })
      if (req) await api('set_group_request_status', { id: req.id, status: 'done' })
      toast('Community created.'); location.hash = `#/community/${id}`
    } catch (e) { $('#mk').disabled = false; throw e }
  })
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }

// ---- E: edit community ----
async function viewEdit(id) {
  const [{ data: info }, { data: members }, { data: regions }] = await Promise.all([api('community_info', { community: id }), api('community_members', { community: id }), api('regions')])
  if (!info) return toast('Unknown community.')
  const admins = members.filter((m) => m.role === 'admin')
  shell('communities', `<p><a href="#/community/${id}">‹ ${esc(info.name)}</a></p><h1>Edit community</h1>
    <div class="panel"><label for="nm">Community name</label><input id="nm" type="text" value="${esc(info.name)}">
    <label for="rg">Map region</label><select id="rg"><option value="">None yet</option>${regions.map((r) => `<option value="${r.id}" ${r.id === info.region_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
    <label>Admins (${admins.length})</label>${admins.map((a) => `<p><b>${esc(a.full_name)}</b> · ${esc(a.email)} <button class="btn small" data-demote="${a.user_id}" data-n="${esc(a.full_name)}">Remove admin rights</button></p>`).join('') || '<p class="muted">No admins yet.</p>'}
    <label for="q">Add an admin</label><input id="q" type="search" placeholder="Search people who have signed up by name or email"><div id="srch"></div>
    <div class="row" style="margin-top:20px"><button class="btn go" id="save">Save changes</button><a class="btn" href="#/community/${id}" style="text-decoration:none">Cancel</a></div></div>`)
  $('#save').onclick = () => guard(async () => {
    const name = $('#nm').value.trim(); if (!name) return toast('Give the community a name.')
    if (name !== info.name) await api('edit_community', { community: id, name })
    const region = $('#rg').value || null; if (region !== (info.region_id || null)) await api('set_region', { community: id, region })
    toast('Saved.'); location.hash = `#/community/${id}`
  })
  document.querySelectorAll('[data-demote]').forEach((b) => (b.onclick = () => guard(async () => {
    if (!(await confirmBox({ title: `Remove admin rights from ${b.dataset.n}?`, text: 'They stay a member.', verb: 'Remove admin rights' }))) return
    await api('set_role', { community: id, user: b.dataset.demote, role: 'member' }); toast('Done.'); viewEdit(id)
  })))
  $('#q').oninput = debounce(async () => {
    const v = $('#q').value.trim(); if (v.length < 2) { $('#srch').innerHTML = ''; return }
    const { data } = await api('search_people', { query: v })
    $('#srch').innerHTML = `<table>${data.slice(0, 10).map((p, i) => `<tr><td><b>${esc(p.full_name)}</b> · ${esc(p.activity || '')}<br><small class="muted">${esc(p.email)}${p.community_id === id ? ' · member of ' + esc(info.name) : ''}</small></td><td><button class="btn small" data-i="${i}">Make admin</button></td></tr>`).join('')}</table>`
    document.querySelectorAll('#srch [data-i]').forEach((b) => (b.onclick = () => guard(async () => {
      const p = data[+b.dataset.i]
      if (!(await confirmBox({ title: `Make ${p.full_name} an admin of ${info.name}?`, text: p.community_id === id ? 'They’ll be able to approve and remove members.' : 'They are not in this community yet, so they are added to it as an admin. They’ll be able to approve and remove members.', verb: 'Make admin' }))) return
      if (!members.some((m) => m.user_id === p.user_id)) await api('add_to_community', { community: id, user: p.user_id })
      await api('set_role', { community: id, user: p.user_id, role: 'admin' }); toast('Done.'); viewEdit(id)
    })))
  }, 250)
}

// ---- F / G: people ----
async function viewPeople() {
  shell('people', `<h1>People</h1><p class="hint">Everyone who has signed up in the app.</p><input id="q" type="search" placeholder="Search by name or email" style="margin-top:14px"><div id="out"></div>`)
  const { data: comms } = await api('communities')
  const draw = async () => {
    const { data } = await api('search_people', { query: $('#q').value })
    const none = data.filter((p) => !p.community_id).length
    $('#out').innerHTML = `<p class="hint">${data.length} shown${none ? ` · ${none} not in a community` : ''}</p><table><tr><th>Name</th><th>Email</th><th>Community and role</th><th></th></tr>
      ${data.map((p, i) => `<tr><td><b>${esc(p.full_name)}</b></td><td>${esc(p.email)}</td><td>${p.community_id ? esc(p.community) + ' · ' + (p.status === 'approved' ? (p.role === 'admin' ? 'Admin' : 'Member') : esc(p.status)) : '<span class="muted">Not in a community</span>'}</td>
        <td>${p.community_id ? '' : `<button class="btn small" data-i="${i}">Add to community</button>`}</td></tr>`).join('')}</table>`
    document.querySelectorAll('#out [data-i]').forEach((b) => (b.onclick = () => addToCommunity(data[+b.dataset.i], comms)))
  }
  $('#q').oninput = debounce(() => guard(draw), 250)
  await draw()
}
function addToCommunity(p, comms) {
  const m = $('#modal')
  m.innerHTML = `<div class="box"><h2>Add ${esc(p.full_name)} to a community?</h2><label for="cc">Community</label><select id="cc">${comms.map((c) => `<option value="${c.community_id}">${esc(c.name)}</option>`).join('')}</select>
    <p>They join straight away as a member, with no community join code, and get a notice. Normally a community’s own admin approves people.</p><p class="muted">This is recorded in the audit trail.</p>
    <div class="row"><button class="btn go" id="yes">Add to community</button><button class="btn" id="no">Cancel</button></div></div>`
  m.hidden = false
  $('#no').onclick = () => { m.hidden = true }
  $('#yes').onclick = () => guard(async () => { await api('add_to_community', { community: $('#cc').value, user: p.user_id }); m.hidden = true; toast('Added.'); viewPeople() })
}

// ---- O / P: group requests ----
const pill = (s) => `<span class="pill ${s}">${s === 'new' ? 'New' : s === 'read' ? 'Read' : 'Done'}</span>`
async function viewRequests() {
  const { data } = await api('group_requests'); counts.requests = data.filter((x) => x.status === 'new').length
  shell('requests', `<h1>Group requests</h1><p class="hint">People asking for a new community group (from the picker). Newest first. Only groups we can verify are approved.</p>
    <table><tr><th>When</th><th>From</th><th>Group</th><th>Where</th><th>How to verify</th><th>Status</th></tr>
    ${data.map((r) => `<tr class="click" data-id="${r.id}"><td>${when(r.created_at)}</td><td>${esc(r.asker_name || 'A former member')}</td><td><b>${esc(r.group_name)}</b></td><td>${esc(r.where_text)}</td><td>${esc(r.how_to_verify)}</td><td>${pill(r.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No requests yet.</td></tr>'}</table>`)
  document.querySelectorAll('tr.click').forEach((t) => (t.onclick = () => (location.hash = `#/request/${t.dataset.id}`)))
}
async function viewRequest(id) {
  const { data } = await api('group_requests'); const r = data.find((x) => x.id === id)
  if (!r) return toast('Unknown request.')
  if (r.status === 'new') { await api('set_group_request_status', { id, status: 'read' }); r.status = 'read'; counts.requests = Math.max(0, counts.requests - 1) }
  shell('requests', `<p><a href="#/requests">‹ Group requests</a></p><h1>${esc(r.group_name)}</h1><p class="hint">Asked by ${esc(r.asker_name || 'a former member')}${r.asker_email ? ' · ' + esc(r.asker_email) : ''} · ${when(r.created_at)} · ${pill(r.status)}</p>
    <div class="panel"><label>Where do they run, hike or ride?</label><p>${esc(r.where_text)}</p><label>How we can verify the group</label><p>${esc(r.how_to_verify)}</p>
    <div class="row" style="margin-top:18px">${r.status === 'done' ? '<span class="muted">A community was created from this request.</span>' : `<a class="btn go" href="#/community/new?from=${id}" style="text-decoration:none">Create community</a>`}<a class="btn" href="#/requests" style="text-decoration:none">Back</a></div></div>`)
}

// ---- Q / R: feedback ----
const KIND = { bug: 'Bug report', feature: 'Feature request', both: 'Bug and feature' }
async function viewFeedback(f) {
  const { data } = await api('feedback'); counts.feedback = data.filter((x) => x.status === 'new').length
  const rows = data.filter((x) => f === 'all' || (f === 'new' ? x.status === 'new' : f === 'bug' ? x.kind !== 'feature' : x.kind !== 'bug'))
  const tab = (k, l) => `<a class="btn small ${f === k ? 'go' : ''}" href="#/feedback?f=${k}" style="text-decoration:none">${l}</a>`
  shell('feedback', `<h1>Feedback</h1><p class="hint">Bug reports and feature requests from the app. Newest first.</p><div class="row" style="margin-top:12px">${tab('all', 'All')}${tab('bug', 'Bug reports')}${tab('feature', 'Feature requests')}${tab('new', 'New only')}</div>
    <table><tr><th>When</th><th>Type</th><th>From</th><th>Phone</th><th>Message</th><th>Picture</th><th>Status</th></tr>
    ${rows.map((x) => `<tr class="click" data-id="${x.id}"><td>${when(x.created_at)}</td><td>${KIND[x.kind] || x.kind}</td><td>${esc(x.sender_name || 'A former member')}</td><td>${esc([x.device?.model, x.device?.system && 'Android'.startsWith(x.device.system) ? '' : x.device?.system].filter(Boolean).join(' '))}<br><small class="muted">${esc(x.device?.system || '')} ${esc(x.device?.system_version || '')} · app ${esc(x.device?.app_version || '')}</small></td><td>${esc(x.body.length > 80 ? x.body.slice(0, 80) + '…' : x.body)}</td><td>${x.screenshot_path ? 'Yes' : ''}</td><td>${pill(x.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nothing here.</td></tr>'}</table>`)
  document.querySelectorAll('tr.click').forEach((t) => (t.onclick = () => (location.hash = `#/report/${t.dataset.id}`)))
}
async function viewReport(id) {
  const { data } = await api('feedback'); const x = data.find((r) => r.id === id)
  if (!x) return toast('Unknown report.')
  if (x.status === 'new') { await api('set_feedback_status', { id, status: 'read' }); x.status = 'read'; counts.feedback = Math.max(0, counts.feedback - 1) }
  shell('feedback', `<p><a href="#/feedback">‹ Feedback</a></p><h1>${KIND[x.kind] || x.kind}</h1><p class="hint">From ${esc(x.sender_name || 'a former member')}${x.sender_email ? ' · ' + esc(x.sender_email) : ''} · ${when(x.created_at)} · ${pill(x.status)}</p>
    <div class="panel"><label>Message</label><p style="white-space:pre-wrap">${esc(x.body)}</p>
    <label>Phone</label><p>${esc(x.device?.model || '')} · ${esc(x.device?.system || '')} ${esc(x.device?.system_version || '')} · app ${esc(x.device?.app_version || '')}</p>
    <div id="shot"></div><div class="row" style="margin-top:18px">${x.status === 'done' ? '' : '<button class="btn go" id="dn">Mark done</button>'}<a class="btn" href="#/feedback" style="text-decoration:none">Back</a></div></div>`)
  if (x.screenshot_path) guard(async () => { const s = await api('screenshot', { path: x.screenshot_path }); $('#shot').innerHTML = `<label>Picture</label><img class="shot" alt="Screenshot" src="${esc(s.url)}">` })
  const dn = $('#dn'); if (dn) dn.onclick = () => guard(async () => { await api('set_feedback_status', { id, status: 'done' }); toast('Marked done.'); location.hash = '#/feedback' })
}

// ---- L: audit trail ----
async function viewAudit() {
  const { data } = await api('audit_trail')
  shell('audit', `<h1>Audit trail</h1><p class="hint">Kept 24 months. Newest first.</p><table><tr><th>When</th><th>Who</th><th>What</th></tr>
    ${data.map((a) => `<tr><td>${when(a.at)}</td><td>${esc(a.who)}</td><td>${esc(a.action.replace(/_/g, ' '))}${a.subject ? ' · ' + esc(a.subject) : ''}${a.community ? ' · ' + esc(a.community) : ''}${a.detail ? ' · ' + esc(a.detail) : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nothing yet.</td></tr>'}</table>`)
}

start()
