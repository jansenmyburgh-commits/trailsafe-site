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
// The box appears right under the sign-in button (a slot with room), never off in a corner (owner, 2 Nov 2026).
function captchaToken() {
  captchaLoad = captchaLoad || new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.onload = ok; s.onerror = no; document.head.appendChild(s) })
  return captchaLoad.then(() => new Promise((ok, no) => {
    const slot = document.querySelector('#cap')
    const box = slot ? slot.querySelector('[data-widget]') : document.body.appendChild(Object.assign(document.createElement('div'), { style: 'position:fixed;left:0;right:0;bottom:24px;display:flex;justify-content:center;z-index:60' }))
    const hint = slot ? slot.querySelector('[data-hint]') : null
    box.style.minHeight = '65px'
    if (hint) { hint.hidden = false; hint.textContent = 'Checking that you’re a person…' }
    let id; const gone = () => { try { window.turnstile.remove(id) } catch {} box.style.minHeight = ''; if (hint) hint.hidden = true; if (!slot) box.remove() }
    id = window.turnstile.render(box, { sitekey: TURNSTILE_SITE_KEY, appearance: 'interaction-only', retry: 'auto',
      'before-interactive-callback': () => { if (hint) { hint.hidden = false; hint.textContent = 'Please tick the box to continue.' } if (slot) slot.scrollIntoView({ block: 'center', behavior: 'smooth' }) },
      callback: (t) => { gone(); ok(t) } })
    setTimeout(() => { gone(); no(new Error('captcha')) }, 120000)
  }))
}

// ---------- sign in: email code, then authenticator code ----------
function loginShell(inner) {
  $('#app').innerHTML = `<div class="login"><h1>TrailSafe owner console</h1><div class="panel">${inner}</div></div>`
}
function showEmailStep(msg = '') {
  loginShell(`<p>Sign in with the owner email. We send a 6-digit code to it.</p><label for="em">Email</label><input id="em" type="email" autocomplete="username" autofocus>
    <div class="row" style="margin-top:14px"><button class="btn go" id="send">Send code</button></div><div id="cap" style="margin-top:10px;text-align:center"><p data-hint hidden style="font-weight:600"></p><div data-widget style="display:flex;justify-content:center"></div></div><div class="err" id="e">${esc(msg)}</div>`)
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
const NAV = [['communities', 'Communities'], ['people', 'People'], ['alerts', 'Alert log'], ['health', 'Health'], ['requests', 'Group requests'], ['feedback', 'Feedback'], ['audit', 'Audit trail'], ['trail-areas', 'Trail areas'], ['coffee', 'Coffee']]
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
    if (p === 'trail-areas') return viewTrailAreas(a)
    if (p === 'coffee') return viewCoffee()
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
  const [{ data: info }, { data: members }, { data: regions }, { data: cof }] = await Promise.all([api('community_info', { community: id }), api('community_members', { community: id }), api('regions'), api('community_coffee', { community: id })])
  const cf = (cof && cof[0]) || {}
  const vlink = cf.link_token ? `https://trailsafety.app/coffee/?v=${cf.link_token}` : ''
  if (!info) return toast('Unknown community.')
  const admins = members.filter((m) => m.role === 'admin')
  shell('communities', `<p><a href="#/community/${id}">‹ ${esc(info.name)}</a></p><h1>Edit community</h1>
    <div class="panel"><label for="nm">Community name</label><input id="nm" type="text" value="${esc(info.name)}">
    <label for="rg">Map region</label><select id="rg"><option value="">None yet</option>${regions.map((r) => `<option value="${r.id}" ${r.id === info.region_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
    <label>Admins (${admins.length})</label>${admins.map((a) => `<p><b>${esc(a.full_name)}</b> · ${esc(a.email)} <button class="btn small" data-demote="${a.user_id}" data-n="${esc(a.full_name)}">Remove admin rights</button></p>`).join('') || '<p class="muted">No admins yet.</p>'}
    <h2 style="margin-top:22px">Free coffee</h2>
    <label for="cs">Sponsor</label><input id="cs" type="text" maxlength="80" value="${esc(cf.sponsor_name)}" placeholder="For example Spar Blanco">
    <label for="cn">Coffee shop</label><input id="cn" type="text" maxlength="80" value="${esc(cf.shop_name)}" placeholder="For example Coffee Corner">
    <label for="ca">Coffee shop address</label><input id="ca" type="text" maxlength="160" value="${esc(cf.shop_address)}" placeholder="For example 12 York Street, George">
    <label>Vendor link</label>${vlink ? `<input type="text" readonly value="${esc(vlink)}" id="vl"><p class="muted">${cf.link_active ? 'Send this to the coffee shop on WhatsApp or email. They open it once and add it to their home screen.' : 'This coffee shop is switched off.'}</p>
      <p><button class="btn small" id="cp">Copy link</button> <button class="btn small" id="nl">Make a new link</button> ${cf.link_active ? '<button class="btn small warn" id="off">Switch off the coffee shop</button>' : ''}</p>` : '<p class="muted">Add the coffee shop’s name and save, and its private link appears here. Leave all three empty and the community shows “Coffee vendor not yet set up” in the app.</p>'}
    <label for="q">Add an admin</label><input id="q" type="search" placeholder="Search people who have signed up by name or email"><div id="srch"></div>
    <div class="row" style="margin-top:20px"><button class="btn go" id="save">Save changes</button><a class="btn" href="#/community/${id}" style="text-decoration:none">Cancel</a></div></div>`)
  $('#save').onclick = () => guard(async () => {
    const name = $('#nm').value.trim(); if (!name) return toast('Give the community a name.')
    if (name !== info.name) await api('edit_community', { community: id, name })
    const region = $('#rg').value || null; if (region !== (info.region_id || null)) await api('set_region', { community: id, region })
    const sp = $('#cs').value.trim(), sh = $('#cn').value.trim(), ad = $('#ca').value.trim()
    if (sp !== (cf.sponsor_name || '') || sh !== (cf.shop_name || '') || ad !== (cf.shop_address || '')) await api('set_community_coffee', { community: id, sponsor: sp, shop: sh, address: ad })
    toast('Saved.'); location.hash = `#/community/${id}`
  })
  if ($('#cp')) $('#cp').onclick = async () => { try { await navigator.clipboard.writeText(vlink); toast('Link copied.') } catch { $('#vl').select(); toast('Select the link and copy it.') } }
  if ($('#nl')) $('#nl').onclick = () => guard(async () => {
    if (!(await confirmBox({ title: `Make a new vendor link for ${info.name}?`, text: 'The old link stops working at once. You will need to send the new one to the coffee shop.', verb: 'Make a new link' }))) return
    await api('remake_vendor_link', { community: id }); toast('New link made.'); viewEdit(id)
  })
  if ($('#off')) $('#off').onclick = () => guard(async () => {
    if (!(await confirmBox({ title: `Switch off the coffee shop for ${info.name}?`, text: 'Its link stops working and members see “Coffee vendor not yet set up”.', verb: 'Switch off', danger: true }))) return
    await api('switch_off_vendor', { community: id }); toast('Switched off.'); viewEdit(id)
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

// ---- Coffee (wf-23 S): suggestions and enquiries from the app, and each community's sponsor, coffee shop and coffees this month ----
const LEAD_KIND = { suggest_shop: 'Coffee shop', suggest_sponsor: 'Sponsor', vendor_enquiry: 'Coffee shop', sponsor_enquiry: 'Sponsor' }
async function viewCoffee() {
  const [{ data: leads }, { data: coms }] = await Promise.all([api('coffee_leads'), api('coffee_overview')])
  const month = coms.reduce((n, c) => n + (c.redeemed_month || 0), 0)
  const enq = leads.filter((l) => l.kind.endsWith('enquiry')).length
  const tile = (big, label, line) => `<div class="tile"><div class="big">${esc(big)}</div><div class="lab">${esc(label)}</div><div class="line">${esc(line)}</div></div>`
  shell('coffee', `<h1>Coffee</h1><p class="hint">Suggestions from members, enquiries, and each community’s sponsor and coffee shop.</p>
    <div class="tiles three">${tile(leads.length - enq, 'Suggestions', 'waiting for you')}${tile(enq, 'Enquiries', 'from the menu forms')}${tile(month, 'Coffees redeemed', 'this month, all communities')}</div>
    <h2>Suggestions and enquiries</h2>
    ${leads.length ? `<table><tr><th>Business</th><th>Kind</th><th>From</th><th>Town / contact</th><th></th></tr>${leads.map((l) => `<tr><td><b>${esc(l.business)}</b>${l.note ? `<br><small class="muted">${esc(l.note)}</small>` : ''}</td><td>${LEAD_KIND[l.kind]}${l.kind.endsWith('enquiry') ? ' · enquiry' : ' · suggestion'}</td><td>${esc(l.from_name || '')}<br><small class="muted">${esc(l.community || '')} · ${when(l.created_at)}</small></td><td>${esc([l.town, l.contact].filter(Boolean).join(' · '))}</td><td><button class="btn small" data-done="${l.id}">Done</button></td></tr>`).join('')}</table>` : '<p class="muted">Nothing waiting.</p>'}
    <h2>Communities</h2><table><tr><th>Community</th><th>Sponsor</th><th>Coffee shop</th><th>Vendor link</th><th>This month</th><th></th></tr>${coms.map((c) => `<tr><td><b>${esc(c.community)}</b></td>${c.set_up || c.shop_name ? `<td>${esc(c.sponsor_name || '—')}</td><td>${esc(c.shop_name || '—')}</td><td>${c.set_up ? 'Active' : 'Switched off'}</td>` : '<td colspan="3" class="muted">Not yet set up</td>'}<td>${c.redeemed_month}</td><td><a class="btn small" href="#/community/${c.community_id}/edit" style="text-decoration:none">${c.shop_name ? 'Edit' : 'Set up'}</a></td></tr>`).join('')}</table>
    <p class="hint">The sponsor and coffee shop are set up on each community’s Edit page.</p>`)
  document.querySelectorAll('[data-done]').forEach((b) => (b.onclick = () => guard(async () => { await api('coffee_lead_done', { id: +b.dataset.done }); toast('Done.'); viewCoffee() })))
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


// ---- wf-22: trail areas (the free coffee, Q-58) ----
// The owner picks an uploaded map, drags a loop around a trail network, names it and saves it. An area is saved as points on the earth
// (not as part of a map file), so a map update leaves every area where it was. Anyone inside any area, out and moving, counts (a later step).
const MAP_BUCKET = 'https://pub-bdde5cbc9ef549bab2bb38050a68c606.r2.dev/'
let trailMap = null, mapProtocol = null
const ringKm2 = (ring) => { const mlat = ring.reduce((s, p) => s + p[1], 0) / ring.length, kx = 111320 * Math.cos((mlat * Math.PI) / 180); let s = 0
  ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length]; s += p[0] * kx * q[1] * 110540 - q[0] * kx * p[1] * 110540 }); return Math.abs(s) / 2 / 1e6 }
const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const segHit = (a, b, c, d) => { const d1 = cross2(c, d, a), d2 = cross2(c, d, b), d3 = cross2(a, b, c), d4 = cross2(a, b, d); return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)) }
const hitPoint = (a, b, c, d) => { const t = cross2(c, d, a) / (cross2(c, d, a) - cross2(c, d, b)); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] }
// the same three checks the server makes (it is the one that decides): shape, crossing itself, under 1 km²
function ringProblem(ring) {
  const n = ring.length; if (n < 3 || n > 400) return 'shape'
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (segHit(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return 'crossing' }
  return ringKm2(ring) < 1 ? 'small' : null
}
// a loop drawn past its own start crosses itself: cut off the tail before the crossing, as a lasso does
function trimLoop(p) {
  for (let i = 0; i < p.length - 1; i++) for (let j = i + 2; j < p.length - 1; j++) if (segHit(p[i], p[i + 1], p[j], p[j + 1])) return [hitPoint(p[i], p[i + 1], p[j], p[j + 1]), ...p.slice(i + 1, j + 1)]
  return p
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts
  const a = pts[0], b = pts[pts.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y) || 1
  let max = 0, idx = 0
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / L; if (d > max) { max = d; idx = i } }
  return max <= tol ? [a, b] : simplify(pts.slice(0, idx + 1), tol).slice(0, -1).concat(simplify(pts.slice(idx), tol))
}
const TRAIL_STYLE = (url) => ({
  version: 8,
  glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
  sources: { base: { type: 'vector', url: `pmtiles://${url}`, attribution: '© OpenStreetMap contributors' } },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#F3F1EA' } },
    { id: 'earth', type: 'fill', source: 'base', 'source-layer': 'earth', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#ECE9DE' } },
    { id: 'wood', type: 'fill', source: 'base', 'source-layer': 'landuse', filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['get', 'kind'], ['literal', ['park', 'forest', 'wood', 'nature_reserve', 'national_park']]]], paint: { 'fill-color': '#DCE6CB' } },
    { id: 'water', type: 'fill', source: 'base', 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#B9D7E6' } },
    { id: 'water-lines', type: 'line', source: 'base', 'source-layer': 'water', filter: ['in', ['get', 'kind'], ['literal', ['river', 'stream']]], paint: { 'line-color': '#B9D7E6', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 15, 2.5] } },
    { id: 'road-minor', type: 'line', source: 'base', 'source-layer': 'roads', filter: ['in', ['get', 'kind'], ['literal', ['minor_road', 'medium_road', 'other']]], paint: { 'line-color': '#D2CCBC', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 2.5] } },
    { id: 'road-major', type: 'line', source: 'base', 'source-layer': 'roads', filter: ['in', ['get', 'kind'], ['literal', ['major_road', 'highway']]], paint: { 'line-color': '#BDB49C', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 15, 4] } },
    { id: 'trails', type: 'line', source: 'base', 'source-layer': 'roads', filter: ['==', ['get', 'kind'], 'path'], paint: { 'line-color': '#8A6A45', 'line-dasharray': [3, 1.6], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.9, 15, 1.8] } },
    { id: 'places', type: 'symbol', source: 'base', 'source-layer': 'places', filter: ['in', ['get', 'kind'], ['literal', ['locality', 'neighbourhood', 'macrohood']]], layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 }, paint: { 'text-color': '#3A3F37', 'text-halo-color': '#F3F1EA', 'text-halo-width': 1.4 } },
  ],
})
const trailMsg = (e) => ({ small: 'That loop is too small, or it crosses itself. Try again.', crossing: 'That loop is too small, or it crosses itself. Try again.', shape: 'That loop can’t be used. Try again.', name: 'Please give the area a name.' }[e.message] || say(e))

async function viewTrailAreas(regionId) {
  if (trailMap) { trailMap.remove(); trailMap = null }
  const { data: maps } = await api('trail_maps')
  if (!maps.length) return shell('trail-areas', `<h1>Trail areas</h1><p class="hint">There is no uploaded map yet. Upload a map first; areas are drawn on a map.</p>`)
  const cur = maps.find((m) => m.id === regionId) || maps[0]
  const { data: areas } = await api('trail_areas', { region: cur.id })
  const fmt = (iso) => new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  // an update notice, once: the map's version changed since this browser last looked
  let note = ''
  try { const k = `ts.console.mapver.${cur.slug}`, seen = localStorage.getItem(k); if (seen && Number(seen) !== cur.version && areas.length) note = `<p class="okmsg">The ${esc(cur.name)} map was updated on ${new Date(cur.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}. Your ${areas.length} area${areas.length === 1 ? ' is' : 's are'} exactly where you drew ${areas.length === 1 ? 'it' : 'them'}.</p>`; localStorage.setItem(k, String(cur.version)) } catch { /* the notice is a nicety */ }
  shell('trail-areas', `<h1>Trail areas</h1><p class="hint">Where time on the trail counts towards the free coffee. Anyone inside any area, out and moving, counts; anywhere else doesn’t.</p>
    <div class="row" style="margin-top:14px"><label for="mapsel" style="margin:0">Map to draw on</label>
      <select id="mapsel">${maps.map((m) => `<option value="${m.id}" ${m.id === cur.id ? 'selected' : ''}>${esc(m.name)} · updated ${esc(fmt(m.updated_at))}</option>`).join('')}</select><small class="muted">the uploaded maps</small></div>${note}
    <div class="ta"><div id="taside"></div><div id="tamap"></div></div>`)
  $('#mapsel').onchange = (e) => { location.hash = `#/trail-areas/${e.target.value}` }

  const url = MAP_BUCKET + cur.file
  if (!mapProtocol) { mapProtocol = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', mapProtocol.tile) }
  const file = new pmtiles.PMTiles(url); mapProtocol.add(file)
  let hdr = null; try { hdr = await file.getHeader() } catch { /* the map still opens without it */ }
  const map = (trailMap = new maplibregl.Map({ container: 'tamap', style: TRAIL_STYLE(url), center: hdr ? [(hdr.minLon + hdr.maxLon) / 2, (hdr.minLat + hdr.maxLat) / 2] : [22.46, -33.96], zoom: 10, attributionControl: { compact: true } }))
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  const inMap = (ring) => !hdr || ring.some((p) => p[0] >= hdr.minLon && p[0] <= hdr.maxLon && p[1] >= hdr.minLat && p[1] <= hdr.maxLat)
  const fc = () => ({ type: 'FeatureCollection', features: areas.map((a) => ({ type: 'Feature', properties: { id: a.id, name: a.name, out: inMap(a.ring) ? 0 : 1 }, geometry: { type: 'Polygon', coordinates: [[...a.ring, a.ring[0]]] } })) })
  let mode = 'idle', draft = null, trace = [], message = ''
  map.on('load', () => {
    if (hdr) map.fitBounds([[hdr.minLon, hdr.minLat], [hdr.maxLon, hdr.maxLat]], { padding: 20, animate: false })
    map.addSource('areas', { type: 'geojson', data: fc() })
    map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['case', ['==', ['get', 'out'], 1], '#9A9A9A', '#5A9A5B'], 'fill-opacity': 0.35 } })
    map.addLayer({ id: 'areas-line', type: 'line', source: 'areas', paint: { 'line-color': ['case', ['==', ['get', 'out'], 1], '#777', '#3E7A40'], 'line-width': 1.6 } })
    map.addLayer({ id: 'areas-name', type: 'symbol', source: 'areas', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 }, paint: { 'text-color': '#1E3A2C', 'text-halo-color': '#fff', 'text-halo-width': 1.4 } })
    map.addSource('draft', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({ id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#5A9A5B', 'fill-opacity': 0.35 } })
    map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', paint: { 'line-color': '#B4492C', 'line-width': 2, 'line-dasharray': [3, 2] } })
  })
  const showDraft = (ring, closed) => map.getSource('draft')?.setData({ type: 'FeatureCollection', features: ring && ring.length > 1 ? [{ type: 'Feature', properties: {}, geometry: closed ? { type: 'Polygon', coordinates: [[...ring, ring[0]]] } : { type: 'LineString', coordinates: ring } }] : [] })

  const side = () => {
    const outsideTag = (a) => (inMap(a.ring) ? '' : ' · <b>Outside this map</b>')
    const list = areas.length ? areas.map((a) => `<div class="arow"><b>${esc(a.name)}</b><small>${Math.round(Number(a.area_km2))} km² · added ${esc(new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}${outsideTag(a)}</small><button class="btn small warn" data-del="${a.id}" data-n="${esc(a.name)}">Delete</button></div>`).join('') : `<p class="muted">No trail areas yet. Zoom to a town, press <b>Draw an area</b> and circle where the trails are.</p>`
    if (mode === 'drawing') return `<h2>Areas on ${esc(cur.name)} (${areas.length})</h2><p class="muted">Press on the map and drag a loop around the trail network. Let go to close the shape. It doesn’t need to be a neat circle.</p><button class="btn" id="tacancel">Cancel</button>`
    if (mode === 'naming') return `<h2>New area</h2><label for="taname">Name</label><input id="taname" type="text" maxlength="60" placeholder="e.g. George, mountain side" autofocus><p class="muted">About <b>${Math.round(ringKm2(draft))} km²</b>. Anyone inside, out and moving, counts.</p>
      <div class="col"><button class="btn go" id="tasave">Save area</button><button class="btn" id="taagain">Draw again</button><button class="btn" id="tacancel">Cancel</button></div>`
    return `<h2>Areas on ${esc(cur.name)} (${areas.length})</h2>${message ? `<p class="badmsg">${esc(message)}</p>` : ''}${list}<p class="row"><button class="btn go" id="tadraw">${areas.length ? 'Draw another area' : 'Draw an area'}</button></p>${areas.length ? '<p class="muted">Anyone inside any of these areas, out and moving, counts towards their free coffee. Anywhere else doesn’t.</p>' : ''}`
  }
  const render = () => {
    $('#taside').innerHTML = side()
    const on = (id, f) => { const b = $(id); if (b) b.onclick = f }
    on('#tadraw', () => { message = ''; mode = 'drawing'; render() })
    on('#tacancel', () => { mode = 'idle'; draft = null; message = ''; showDraft(null); map.dragPan.enable(); render() })
    on('#taagain', () => { mode = 'drawing'; draft = null; showDraft(null); render() })
    on('#tasave', () => guard(async () => {
      const name = $('#taname').value.trim(); if (!name) return toast('Please give the area a name.')
      try { await api('add_trail_area', { region: cur.id, name, ring: draft }) } catch (e) { if (['sign_in', 'two_step'].includes(e.message)) throw e; message = trailMsg(e); mode = 'idle'; draft = null; showDraft(null); return render() }
      toast('Saved.'); viewTrailAreas(cur.id)
    }))
    document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => guard(async () => {
      if (!(await confirmBox({ title: `Delete “${b.dataset.n}”?`, text: 'People inside it stop earning coffee time there. Time already earned stays.', verb: 'Delete area', danger: true }))) return
      await api('delete_trail_area', { id: b.dataset.del }); toast('Deleted.'); viewTrailAreas(cur.id)
    })))
    map.getCanvas().style.cursor = mode === 'drawing' ? 'crosshair' : ''
    if (mode === 'naming') $('#taname')?.focus()
  }
  // the lasso: press and drag, let go
  let down = false
  const add = (e) => { const last = trace[trace.length - 1], p = e.point; if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 3) { trace.push({ x: p.x, y: p.y, ll: [e.lngLat.lng, e.lngLat.lat] }); showDraft(trace.map((t) => t.ll), false) } }
  const start = (e) => { if (mode !== 'drawing') return; down = true; trace = []; map.dragPan.disable(); add(e) }
  const move = (e) => { if (down) add(e) }
  const stop = () => {
    if (!down) return; down = false; map.dragPan.enable()
    let pts = trace; for (let tol = 3; pts.length > 200 && tol < 40; tol += 3) pts = simplify(trace, tol); if (trace.length > 2) pts = simplify(trace, 3)
    let ring = pts.map((t) => t.ll); ring = trimLoop(ring)
    const problem = ringProblem(ring)
    if (problem) { message = problem === 'shape' ? 'That loop can’t be used. Try again.' : 'That loop is too small, or it crosses itself. Try again.'; mode = 'idle'; showDraft(null); return render() }
    draft = ring; mode = 'naming'; showDraft(ring, true); render()
  }
  map.on('mousedown', start); map.on('mousemove', move); map.on('mouseup', stop)
  map.on('touchstart', start); map.on('touchmove', move); map.on('touchend', stop)
  render()
}

start()
