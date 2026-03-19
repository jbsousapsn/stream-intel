// ── Friends & Notifications ───────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────────────────────
let _friends        = [];      // accepted friends [{id,username,display_name,profile_pic}]
let _notifOffset       = 0;
let _notifHasMore      = false;
let _notifPanelOpen    = false;
let _notifScrollBound  = null;   // keeps the same fn ref so removeEventListener works
let _deletedNotifIds   = new Set(); // client-side tombstones — survive re-fetches
let _friendSearchTimer = null;

// Share prompt state
let _sharePending   = null;    // { action, selectedIds: Set }
let _shareMsgSelectedIds = new Set(); // for compose-message dialog
const _notifCache = new Map();  // id -> notification obj for detail view

const NOTIF_POLL_MS = 30_000;  // poll every 30 s

// ── Init (called from loadApp) ────────────────────────────────────────────────
async function initFriends() {
  await Promise.all([refreshFriendsList(), loadNotifications(true)]);
  setInterval(_pollUnread, NOTIF_POLL_MS);
  _maybeShowPushBanner();  // show prompt (iOS needs gesture) or silently subscribe
}

// ── Friends list ──────────────────────────────────────────────────────────────
async function refreshFriendsList() {
  const data = await api('GET', '/api/friends');
  if (!data) return;
  _friends = data.friends || [];
}

// ── Notifications ─────────────────────────────────────────────────────────────
async function loadNotifications(reset = false) {
  if (reset) _notifOffset = 0;
  const data = await api('GET', `/api/notifications?offset=${_notifOffset}`);
  if (!data) return;

  _updateNotifBadge(data.unread);
  _notifHasMore = data.has_more;

  const list = document.getElementById('notifList');
  if (!list) return;

  if (reset) list.innerHTML = '';

  if (reset && !data.notifications.length) {
    list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
    document.getElementById('notifShowMore')?.classList.add('hidden');
    return;
  }

  data.notifications.forEach(n => {
    if (_deletedNotifIds.has(n.id)) return; // skip tombstoned items
    const existing = list.querySelector(`[data-notif-id="${n.id}"]`);
    if (existing) return; // already rendered (e.g. from earlier poll)
    list.appendChild(_buildNotifEl(n));
  });

  // Show-more button is revealed by scroll, not immediately
  document.getElementById('notifShowMore')?.classList.add('hidden');
  _setupNotifScroll();
}

function _setupNotifScroll() {
  const list = document.getElementById('notifList');
  if (!list) return;
  // Remove any previously attached listener (same reference required)
  if (_notifScrollBound) list.removeEventListener('scroll', _notifScrollBound);
  _notifScrollBound = _onNotifScroll;
  list.addEventListener('scroll', _notifScrollBound);
  // Also check immediately in case list is short / fully visible
  _checkNotifScroll(list);
}

function _checkNotifScroll(list) {
  if (!list) list = document.getElementById('notifList');
  if (!list) return;
  const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 60;
  const showMore = document.getElementById('notifShowMore');
  if (showMore) showMore.classList.toggle('hidden', !(nearBottom && _notifHasMore));
}

function _onNotifScroll(e) {
  _checkNotifScroll(e.currentTarget);
}

async function loadMoreNotifs() {
  _notifOffset += 10;
  await loadNotifications(false);
}

function _updateNotifBadge(count) {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.remove('hidden');
    document.title = `(${count > 99 ? '99+' : count}) StreamIntel`;
  } else {
    badge.classList.add('hidden');
    document.title = 'StreamIntel';
  }
}

// ── Web Push subscription ─────────────────────────────────────────────────────
// Called on init — shows a prompt when a user gesture is required (iOS 16.4+
// PWA) or silently subscribes if permission was already granted.
function _maybeShowPushBanner() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission === 'denied') return;
  if (Notification.permission === 'granted') {
    // Already allowed — silently subscribe / re-sync subscription.
    _initPush();
    return;
  }
  // On some Android TWA/WebAPK builds Notification.permission can return
  // 'default' even after the user already granted it (permission state is
  // not reliably bridged across cold starts). Check our own localStorage
  // flag to avoid re-prompting users who already subscribed or dismissed.
  const pushFlag = localStorage.getItem('push_subscribed');
  if (pushFlag === '1') {
    _initPush();
    return;
  }
  if (pushFlag === 'dismissed') return;
  // permission === 'default' and never subscribed — must wait for a user gesture
  document.getElementById('notifPushPrompt')?.classList.remove('hidden');
}

async function enablePushFromPrompt() {
  document.getElementById('notifPushPrompt')?.classList.add('hidden');
  await _initPush();
}

function dismissPushPrompt() {
  document.getElementById('notifPushPrompt')?.classList.add('hidden');
  // Remember the dismissal so we don't re-prompt on every app open.
  localStorage.setItem('push_subscribed', 'dismissed');
}

async function _initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    // Fetch our VAPID public key from the server
    const { publicKey } = await api('GET', '/api/push/vapid-public-key');
    if (!publicKey) return;
    // Convert base64url to Uint8Array for applicationServerKey
    const keyBytes = _b64urlToUint8(publicKey);

    let sub = await reg.pushManager.getSubscription();

    // Handle VAPID key rotation: compare the key embedded in the existing
    // subscription directly (sub.options.applicationServerKey) rather than
    // relying on localStorage. localStorage is unreliable in TWA ephemeral
    // mode and is cleared between sessions, causing a false key-mismatch that
    // unsubscribes a perfectly valid subscription every cold start.
    if (sub && sub.options && sub.options.applicationServerKey) {
      const existingKey = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (existingKey !== publicKey) {
        console.log('[push] VAPID key rotated — unsubscribing old subscription');
        await sub.unsubscribe();
        sub = null;
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes,
      });
    }

    // Send subscription to backend (re-sync on every init to handle endpoint refresh)
    const result = await api('POST', '/api/push/subscribe', sub.toJSON());
    if (result?.ok) {
      localStorage.setItem('vapid_pub_key', publicKey);
      localStorage.setItem('push_subscribed', '1');
      console.log('[push] subscription saved to backend');
    } else {
      console.warn('[push] subscribe response:', result);
    }
  } catch (e) {
    console.warn('[push] _initPush error:', e);
  }
}

function _b64urlToUint8(b64url) {
  const pad  = b64url.length % 4 === 0 ? '' : '===='.slice(b64url.length % 4);
  const b64  = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw  = atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function _pollUnread() {
  const data = await api('GET', '/api/notifications?offset=0');
  if (!data) return;
  _updateNotifBadge(data.unread);
  // If panel open, refresh visible items
  if (_notifPanelOpen) {
    await loadNotifications(true);
  }
}

function _buildNotifEl(n) {
  // Cache for detail view
  _notifCache.set(n.id, n);

  const el   = document.createElement('div');
  el.className = `notif-item${n.is_read ? '' : ' unread'}`;
  el.dataset.notifId = n.id;

  const avatarInner = n.actor_pic
    ? `<img class="notif-avatar" src="${escHtml(n.actor_pic)}" alt="">`
    : `<div class="notif-avatar-ph">${(n.actor_name||'?')[0].toUpperCase()}</div>`;

  // Avatar is clickable → friend profile (except system notifications)
  const avatarEl = n.actor_id
    ? `<button class="notif-avatar-wrap notif-actor-btn" onclick="openFriendProfile(${n.actor_id})" title="View profile">${avatarInner}</button>`
    : `<div class="notif-avatar-wrap">${avatarInner}</div>`;

  const text = _notifText(n);
  const time  = _relTime(n.created_at);

  // Meta strip — fall back to cardDataStore for older notifications
  let metaHtml  = '';
  let posterKey = null;
  if (n.type === 'shared_action') {
    const p      = n.payload || {};
    const tk     = (p.platform||'') + '::' + (p.title||'').toLowerCase().trim();
    const stored = (typeof cardDataStore !== 'undefined' && cardDataStore[tk]) || {};
    const tmdbD  = (typeof _tmdbShowData  !== 'undefined' && _tmdbShowData[tk])  || {};
    const ct     = p.content_type || stored.content_type || null;
    const year   = p.year      || stored.release_year || null;
    const endYr  = p.end_year  || stored.end_year     || null;
    const imdb   = p.imdb_score || stored.imdb_score  || null;
    const parts  = [];
    if (ct) parts.push(ct === 'tv' ? 'TV Show' : 'Movie');
    if (year) {
      if (ct === 'tv') {
        if (endYr)            parts.push(`${year}\u2013${endYr}`);
        else if (tmdbD.ongoing) parts.push(`${year}\u2013`);
        else                   parts.push(String(year));
      } else {
        parts.push(String(year));
      }
    }
    if (imdb) parts.push(`\u2605\u202f${Number(imdb).toFixed(1)}`);
    if (parts.length) metaHtml = `<div class="notif-meta">${parts.join(' · ')}</div>`;
    if (p.title) posterKey = { title: p.title, year: year || null, type: ct || 'movie' };
  }

  el.innerHTML = `
    ${avatarEl}
    <div class="notif-body">
      <div class="notif-text">${text}</div>
      ${metaHtml}
      <div class="notif-time">${time}</div>
    </div>
    <div class="notif-poster-wrap" id="notif-poster-${n.id}"></div>
    <div class="notif-actions">
      ${!n.is_read ? `<button class="notif-read-btn" title="Mark read" onclick="markNotifRead(${n.id},this)">\u2713</button>` : ''}
      <button class="notif-del-btn" title="Remove" onclick="deleteNotif(${n.id},this)">\u2715</button>
    </div>`;

  // Accept/reject buttons for friend requests
  if (n.type === 'friend_request' && !n.is_read) {
    const actorId = n.actor_id;
    const extra = document.createElement('div');
    extra.className = 'notif-fr-actions';
    extra.innerHTML = `
      <button class="notif-accept-btn" onclick="acceptFriendFromNotif(${actorId},this)">Accept</button>
      <button class="notif-reject-btn" onclick="rejectFriendFromNotif(${actorId},this)">Decline</button>`;
    el.querySelector('.notif-body').appendChild(extra);
  }

  // Async poster injection
  if (posterKey && typeof fetchPosterUrl === 'function') {
    const wrap = el.querySelector(`#notif-poster-${n.id}`);
    fetchPosterUrl(posterKey.title, posterKey.year, posterKey.type).then(result => {
      if (result?.poster && wrap) {
        wrap.innerHTML = `<img class="notif-poster" src="${result.poster}" alt="">`;
      }
    });
  }

  // Make the notification body area clickable — opens detail view
  el.style.cursor = 'pointer';
  el.addEventListener('click', e => {
    if (e.target.closest('.notif-actions, .notif-fr-actions, .notif-actor-btn, .notif-avatar-wrap, .notif-actor-link, .notif-title-link')) return;
    if (!n.is_read) { markNotifRead(n.id, el.querySelector('.notif-read-btn')); n.is_read = true; }
    openNotifDetail(n);
  });

  return el;
}

// Open title modal from a notification click; closes notif panel first.
function _openTitleFromNotif(spanEl) {
  const tk = spanEl.dataset.tk;
  if (!tk) return;
  if (_notifPanelOpen) toggleNotifPanel();
  if (typeof openModal === 'function') openModal(tk);
}
window._openTitleFromNotif = _openTitleFromNotif;

function _notifText(n) {
  const actorName = n.actor_name || 'Someone';
  // Actor name is clickable if we know their user id
  const actorHtml = n.actor_id
    ? `<b><span class="notif-actor-link" onclick="openFriendProfile(${n.actor_id})">${escHtml(actorName)}</span></b>`
    : `<b>${escHtml(actorName)}</b>`;
  const p = n.payload || {};
  switch (n.type) {
    case 'friend_request':  return `${actorHtml} sent you a friend request.`;
    case 'friend_accepted': return `${actorHtml} accepted your friend request.`;
    case 'title_message': {
      const rawTitle = p.title || '';
      const tk = escHtml((p.platform || '') + '::' + rawTitle.toLowerCase().trim());
      const titleLink = rawTitle
        ? `<span class="notif-title-link" data-tk="${tk}" onclick="event.stopPropagation();_openTitleFromNotif(this)">${escHtml(rawTitle)}</span>`
        : 'a title';
      const msg       = p.message || '';
      const truncated = msg.length > 60 ? escHtml(msg.slice(0, 60)) + '…' : escHtml(msg);
      return `${actorHtml} sent you a message about <b>${titleLink}</b>: <em>“${truncated}”</em>`;
    }
    case 'shared_action': {
      const rawTitle  = p.title || '';
      const tk        = escHtml((p.platform || '') + '::' + rawTitle.toLowerCase().trim());
      const titleLink = `<span class="notif-title-link" data-tk="${tk}" onclick="_openTitleFromNotif(this)">${escHtml(rawTitle)}</span>`;
      const statusMap = {
        watchlist:    `🔖 added <b>${titleLink}</b> to their watchlist`,
        watching:     `▶️ is watching <b>${titleLink}</b>`,
        finished:     `✅ finished watching <b>${titleLink}</b>`,
        'not-started':`❌ removed <b>${titleLink}</b> from their library`,
      };
      const parts = [];
      if (p.status && statusMap[p.status]) parts.push(statusMap[p.status]);
      if (p.is_fav === true)  parts.push(parts.length ? `and ♥️ marked it as favourite` : `♥️ favourited <b>${titleLink}</b>`);
      if (p.is_fav === false) parts.push(parts.length ? `and 💔 removed it from favourites` : `💔 unfavourited <b>${titleLink}</b>`);
      const statusStr = parts.length ? parts.join(' ') : `updated <b>${titleLink}</b>`;
      return `${actorHtml} ${statusStr}.`;
    }
    default: return 'New notification.';
  }
}

function _relTime(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr + 'Z').getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400)return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

async function markNotifRead(id, btn) {
  await api('POST', '/api/notifications/read', { id });
  const item = btn?.closest('.notif-item');
  if (item) {
    item.classList.remove('unread');
    btn.remove();
  }
  _pollUnread();
}

async function markAllNotifsRead() {
  await api('POST', '/api/notifications/read', {});
  document.querySelectorAll('.notif-item.unread').forEach(el => {
    el.classList.remove('unread');
    el.querySelector('.notif-read-btn')?.remove();
  });
  _updateNotifBadge(0);
}

async function deleteNotif(id, btn) {
  _deletedNotifIds.add(id);
  await api('DELETE', `/api/notifications/${id}`);
  btn?.closest('.notif-item')?.remove();
  const list = document.getElementById('notifList');
  if (list && !list.querySelector('.notif-item')) {
    list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
  }
  _pollUnread();
}

async function acceptFriendFromNotif(actorId, btn) {
  await api('POST', '/api/friends/accept', { user_id: actorId });
  await refreshFriendsList();
  btn?.closest('.notif-fr-actions')?.remove();
  // mark as read
  const item = btn?.closest('.notif-item');
  if (item) {
    const nid = parseInt(item.dataset.notifId);
    await markNotifRead(nid, item.querySelector('.notif-read-btn'));
  }
}

async function rejectFriendFromNotif(actorId, btn) {
  await api('POST', '/api/friends/reject', { user_id: actorId });
  const item = btn?.closest('.notif-item');
  btn?.closest('.notif-fr-actions')?.remove();
  if (item) {
    const nid = parseInt(item.dataset.notifId);
    await markNotifRead(nid, item.querySelector('.notif-read-btn'));
  }
}

// ── Bell toggle ───────────────────────────────────────────────────────────────
function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  const btn = document.getElementById('notifBtn');
  if (!panel) return;
  _notifPanelOpen = !_notifPanelOpen;
  if (_notifPanelOpen && window.innerWidth > 768) {
    // Position panel below the bell button on desktop
    if (btn) {
      const r = btn.getBoundingClientRect();
      panel.style.top   = (r.bottom + 10) + 'px';
      panel.style.right = (window.innerWidth - r.right) + 'px';
    }
  }
  panel.classList.toggle('open', _notifPanelOpen);
  if (btn) {
    btn.classList.toggle('notif-open', _notifPanelOpen);
    btn.setAttribute('aria-expanded', String(_notifPanelOpen));
  }
  if (_notifPanelOpen) loadNotifications(true);
}

// close on click-outside (panel is now body-level, separate from notifWrap)
document.addEventListener('click', e => {
  if (!_notifPanelOpen) return;
  const btn   = document.getElementById('notifBtn');
  const panel = document.getElementById('notifPanel');
  // Ignore clicks on the button itself — toggleNotifPanel() handles those
  if (btn && btn.contains(e.target)) return;
  // Ignore clicks inside the notification detail overlay — don't collapse panel while detail is open
  const notifDetail = document.getElementById('notifDetailOverlay');
  if (notifDetail && notifDetail.contains(e.target)) return;
  if (btn && panel && !panel.contains(e.target)) {
    _notifPanelOpen = false;
    panel.classList.remove('open');
    btn.classList.remove('notif-open');
    btn.setAttribute('aria-expanded', 'false');
  }
});

// ── Friends overlay ───────────────────────────────────────────────────────────
async function openFriends() {
  const _fo = document.getElementById('friendsOverlay');
  // Toggle: if already open, close it
  if (_fo && _fo.classList.contains('open')) { closeFriends(); return; }
  if (!_handlingPop) history.pushState({ modal: 'friends' }, '');
  if (_fo) { _fo.classList.remove('hidden', 'closing'); _fo.classList.add('open'); }
  const friendsBtn = document.querySelector('.bottom-nav-btn[data-bnav="friends"]');
  if (friendsBtn) friendsBtn.classList.add('panel-open');
  await Promise.all([
    loadFriendsPanel(),
    loadFriendRequests(),
    loadSentRequests(),
  ]);
}

function closeFriends() {
  document.getElementById('friendSearchInput').value = '';
  document.getElementById('friendSearchResults').innerHTML = '';
  const overlay = document.getElementById('friendsOverlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  overlay.classList.remove('open');
  overlay.classList.add('closing');
  overlay.addEventListener('animationend', () => {
    overlay.classList.remove('closing');
    overlay.classList.add('hidden');
  }, { once: true });
  const friendsBtn = document.querySelector('.bottom-nav-btn[data-bnav="friends"]');
  if (friendsBtn) friendsBtn.classList.remove('panel-open');
}

async function loadFriendsPanel() {
  await refreshFriendsList();
  const list = document.getElementById('friendsList');
  if (!list) return;
  if (!_friends.length) {
    list.innerHTML = '<div class="friends-empty">No friends yet — search for someone above.</div>';
    return;
  }
  list.innerHTML = _friends.map(f => `
    <div class="friend-row" id="friend-row-${f.id}">
      <div class="friend-clickable" onclick="openFriendProfile(${f.id})" title="View stats">
        ${_avatarHtml(f, 36)}
        <div class="friend-info">
          <div class="friend-name">${escHtml(f.display_name || f.username)}</div>
          <div class="friend-username">@${escHtml(f.username)}</div>
        </div>
      </div>
      <button class="friend-remove-btn" onclick="removeFriend(${f.id})">Remove</button>
    </div>`).join('');
}

async function loadFriendRequests() {
  const data = await api('GET', '/api/friends/requests');
  if (!data) return;
  const section = document.getElementById('friendRequestsSection');
  const list    = document.getElementById('friendRequestsList');
  if (!section || !list) return;
  if (!data.requests.length) {
    section.style.display = 'none';
    const title = document.getElementById('friendRequestsTitle');
    if (title) title.textContent = 'Pending Requests';
    return;
  }
  section.style.display = '';
  const title = document.getElementById('friendRequestsTitle');
  if (title) {
    const badge = data.requests.length > 1 ? `<span class="friends-req-badge">${data.requests.length}</span>` : '';
    title.innerHTML = `Pending Requests${badge}`;
  }
  list.innerHTML = data.requests.map(r => `
    <div class="friend-row" id="req-row-${r.id}">
      ${_avatarHtml(r, 36)}
      <div class="friend-info">
        <div class="friend-name">${escHtml(r.display_name || r.username)}</div>
        <div class="friend-username">@${escHtml(r.username)}</div>
      </div>
      <div class="friend-req-btns">
        <button class="friend-accept-btn" onclick="acceptRequest(${r.id},this)">Accept</button>
        <button class="friend-reject-btn" onclick="rejectRequest(${r.id},this)">Decline</button>
      </div>
    </div>`).join('');
}

function _avatarHtml(u, size) {
  if (u.profile_pic) return `<img class="friend-avatar" src="${escHtml(u.profile_pic)}" style="width:${size}px;height:${size}px" alt="">`;
  const initial = (u.display_name || u.username || '?')[0].toUpperCase();
  return `<div class="friend-avatar-ph" style="width:${size}px;height:${size}px;font-size:${Math.floor(size*0.45)}px">${initial}</div>`;
}

async function acceptRequest(userId, btn) {
  await api('POST', '/api/friends/accept', { user_id: userId });
  document.getElementById(`req-row-${userId}`)?.remove();
  await loadFriendsPanel();
  await loadFriendRequests();
}

async function rejectRequest(userId, btn) {
  await api('POST', '/api/friends/reject', { user_id: userId });
  document.getElementById(`req-row-${userId}`)?.remove();
  await loadFriendRequests();
}

async function loadSentRequests() {
  const data = await api('GET', '/api/friends/requests/sent');
  if (!data) return;
  const section = document.getElementById('sentRequestsSection');
  const list    = document.getElementById('sentRequestsList');
  if (!section || !list) return;
  if (!data.requests.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  list.innerHTML = data.requests.map(r => `
    <div class="friend-row" id="sent-row-${r.id}">
      ${_avatarHtml(r, 36)}
      <div class="friend-info">
        <div class="friend-name">${escHtml(r.display_name || r.username)}</div>
        <div class="friend-username">@${escHtml(r.username)}</div>
      </div>
      <button class="friend-cancel-btn" onclick="cancelFriendReq(${r.id},this)">Cancel</button>
    </div>`).join('');
}

async function cancelFriendReq(userId, btn) {
  await api('DELETE', `/api/friends/request/${userId}`);
  document.getElementById(`sent-row-${userId}`)?.remove();
  await loadSentRequests();
}

async function removeFriend(userId) {
  await api('POST', '/api/friends/remove', { user_id: userId });
  document.getElementById(`friend-row-${userId}`)?.remove();
  await refreshFriendsList();
  const list = document.getElementById('friendsList');
  if (list && !list.querySelector('.friend-row')) {
    list.innerHTML = '<div class="friends-empty">No friends yet — search for someone above.</div>';
  }
}

// ── Friend search ─────────────────────────────────────────────────────────────
function onFriendSearch(q) {
  clearTimeout(_friendSearchTimer);
  if (q.length < 2) {
    document.getElementById('friendSearchResults').innerHTML = '';
    return;
  }
  _friendSearchTimer = setTimeout(() => _runFriendSearch(q), 300);
}

async function _runFriendSearch(q) {
  const data = await api('GET', `/api/friends/search?q=${encodeURIComponent(q)}`);
  if (!data) return;
  const box = document.getElementById('friendSearchResults');
  if (!box) return;
  if (!data.users.length) {
    box.innerHTML = '<div class="friends-empty">No users found.</div>';
    return;
  }
  box.innerHTML = data.users.map(u => {
    const fs = u.friendship_status;
    let actionHtml = '';
    if (fs === 'friends') {
      actionHtml = `<span class="fs-tag friends">Friends</span>`;
    } else if (fs === 'request_sent') {
      actionHtml = `<span class="fs-tag pending">Requested</span>`;
    } else if (fs === 'request_received') {
      actionHtml = `
        <button class="friend-accept-btn" onclick="acceptRequest(${u.id},this);document.getElementById('friendSearchInput').dispatchEvent(new Event('input'))">Accept</button>`;
    } else {
      actionHtml = `<button class="friend-add-btn" onclick="sendFriendRequest(${u.id},this)">+ Add</button>`;
    }
    return `
      <div class="friend-row" id="search-row-${u.id}">
        ${_avatarHtml(u, 36)}
        <div class="friend-info">
          <div class="friend-name">${escHtml(u.display_name || u.username)}</div>
          <div class="friend-username">@${escHtml(u.username)}</div>
        </div>
        ${actionHtml}
      </div>`;
  }).join('');
}

async function sendFriendRequest(userId, btn) {
  const data = await api('POST', '/api/friends/request', { user_id: userId });
  if (!data) return;
  if (btn) {
    if (data.status === 'accepted') {
      btn.replaceWith(Object.assign(document.createElement('span'), { className: 'fs-tag friends', textContent: 'Friends' }));
      await loadFriendsPanel();
    } else {
      btn.replaceWith(Object.assign(document.createElement('span'), { className: 'fs-tag pending', textContent: 'Requested' }));
      await loadSentRequests();
    }
  }
}

// ── Friend profile overlay ───────────────────────────────────────────
async function openFriendProfile(uid) {
  if (!_handlingPop) history.pushState({ modal: 'friendProfile' }, '');
  if (_notifPanelOpen) toggleNotifPanel();
  const overlay = document.getElementById('friendProfileOverlay');
  if (!overlay) return;

  document.getElementById('fpoCrumb').textContent   = 'Profile';
  document.getElementById('fpoName').textContent    = '…';
  document.getElementById('fpoUserSub').textContent = '';
  const avatarImg = document.getElementById('fpoAvatarImg');
  avatarImg.style.display = 'none';
  const ph = document.getElementById('fpoAvatar').querySelector('.profile-avatar-placeholder');
  if (ph) ph.style.display = '';
  document.getElementById('fpoContent').innerHTML =
    '<div class="profile-section" style="text-align:center;color:var(--muted);padding:40px 0">Loading…</div>';

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  const data = await api('GET', `/api/friends/${uid}/profile`);
  if (!data || data.error) {
    document.getElementById('fpoContent').innerHTML =
      '<div class="profile-section" style="text-align:center;color:var(--muted);padding:40px 0">Could not load profile.</div>';
    return;
  }

  if (data.profile_pic) {
    avatarImg.src = data.profile_pic;
    avatarImg.style.display = 'block';
    if (ph) ph.style.display = 'none';
  }

  const displayName = data.display_name || data.username;
  document.getElementById('fpoName').textContent    = displayName;
  document.getElementById('fpoUserSub').textContent = '@' + data.username;
  document.getElementById('fpoCrumb').textContent   = displayName;

  if (!data.stats) {
    const libBtn = data.library_public
      ? `<div class="profile-section" style="text-align:center;padding:16px 0">
           <button class="fpo-library-btn" onclick="openFriendLibrary(${uid},'${escAttr2(displayName)}')">
             📚 Browse ${escHtml(displayName)}’s Library
           </button></div>`
      : '';
    document.getElementById('fpoContent').innerHTML =
      libBtn + '<div class="profile-section" style="text-align:center;color:var(--muted);padding:40px 0">No watch history yet.</div>';
    return;
  }

  const s = data.stats;
  const statCard = (label, value, cls='') =>
    `<div class="profile-stat-card"><div class="profile-stat-value ${cls}">${value}</div><div class="profile-stat-label">${label}</div></div>`;

  let html = `
    ${ data.library_public ? `<div class="profile-section" style="text-align:center;padding:12px 0">
      <button class="fpo-library-btn" onclick="openFriendLibrary(${uid},'${escAttr2(displayName)}')">\n        \ud83d\udcda Browse ${escHtml(displayName)}\u2019s Library\n      </button></div>` : ''}
    <div class="profile-section">
      <div class="profile-section-header"><div class="profile-section-title">Total Watch Time</div></div>
      <div class="profile-time-card">
        <div class="profile-time-main">${s.total_watch_time.label || '0m'}</div>
        <div class="profile-time-sub">
          <div class="ptime-row"><span class="ptime-icon" style="font-size:15px;line-height:1">🎬</span><span class="ptime-label">Movies</span><span class="ptime-val">${s.movie_watch_time.label}</span></div>
          <div class="ptime-row"><span class="ptime-icon" style="font-size:15px;line-height:1">📺</span><span class="ptime-label">TV Shows</span><span class="ptime-val">${s.tv_watch_time.label}</span></div>
        </div>
      </div>
    </div>
    <div class="profile-section">
      <div class="profile-section-title">🎬 Movies</div>
      <div class="profile-split">
        <div class="profile-stats-grid">
          ${statCard('Finished',   s.movies_finished,   'gold')}
          ${statCard('Watching',   s.movies_watching,   '')}
          ${statCard('In Library', s.movies_in_library, '')}
        </div>
        <div class="profile-time-pill"><span class="pill-label">Watch time</span><span class="pill-value">${s.movie_watch_time.label||'0m'}</span></div>
      </div>
    </div>
    <div class="profile-section">
      <div class="profile-section-title">📺 TV Shows</div>
      <div class="profile-split">
        <div class="profile-stats-grid">
          ${statCard('Shows Finished',   s.tv_finished,      'accent')}
          ${statCard('Shows Watching',   s.tv_watching,      '')}
          ${statCard('Episodes Watched', s.episodes_watched, '')}
        </div>
        <div class="profile-time-pill"><span class="pill-label">Watch time</span><span class="pill-value">${s.tv_watch_time.label||'0m'}</span></div>
      </div>
    </div>`;

  if (s.top_genres?.length) {
    const maxCount = s.top_genres[0].count || 1;
    html += `<div class="profile-section">
      <div class="profile-section-title">Favourite Genres</div>
      <div class="profile-genres">${s.top_genres.map(g =>
        `<div class="profile-genre-chip">
          <span>${genreEmoji(formatGenre(g.genre))} ${escHtml(formatGenre(g.genre))}</span>
          <div class="profile-genre-bar-wrap"><div class="profile-genre-bar" style="width:${Math.round(g.count/maxCount*100)}%"></div></div>
          <span style="font-size:11px;color:var(--muted)">${g.count}</span>
        </div>`).join('')}
      </div>
    </div>`;
  }

  html += `
    <div class="profile-section" id="fpoRatingsSection" style="display:none">
      <div class="profile-section-header"><div class="profile-section-title">Their Ratings</div></div>
      <div class="fpo-ratings-list" id="fpoRatingsList"></div>
    </div>
    <div class="profile-section" id="fpoActorsSection" style="display:none">
      <div class="profile-section-header"><div class="profile-section-title">Frequent Actors</div></div>
      <div class="profile-people-list" id="fpoActorsList"></div>
    </div>
    <div class="profile-section" id="fpoDirectorsSection" style="display:none">
      <div class="profile-section-header"><div class="profile-section-title">Frequent Directors</div></div>
      <div class="profile-people-list" id="fpoDirectorsList"></div>
    </div>`;

  document.getElementById('fpoContent').innerHTML = html;
  loadFriendPeople(uid);
  if (data.library_public) _loadFriendRatings(uid);
}

function closeFriendProfile() {
  document.getElementById('friendProfileOverlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Friend ratings loader ────────────────────────────────────────────────────
let _fpoRatingsExpanded = false;
async function _loadFriendRatings(uid) {
  const section = document.getElementById('fpoRatingsSection');
  const list    = document.getElementById('fpoRatingsList');
  if (!section || !list) return;

  const data = await api('GET', `/api/friends/${uid}/library`, null, {loader: false}).catch(() => null);
  if (!data?.library?.length) return;

  const rated = data.library.filter(r => (r.user_rating || 0) > 0)
                             .sort((a, b) => (b.user_rating || 0) - (a.user_rating || 0));
  if (!rated.length) return;

  section.style.display = '';
  _fpoRatingsExpanded = false;
  const LIMIT = 10;

  function render() {
    const visible = _fpoRatingsExpanded ? rated : rated.slice(0, LIMIT);
    list.innerHTML = visible.map(r => {
      const stars = '★'.repeat(r.user_rating) + '☆'.repeat(5 - r.user_rating);
      const typeTag = r.content_type === 'movie' ? '🎬' : r.content_type === 'tv' ? '📺' : '';
      return `<div class="fpo-rating-row">
        <div class="fpo-rating-stars">${stars}</div>
        <div class="fpo-rating-info">
          <span class="fpo-rating-title">${escHtml(r.title)}</span>
          <span class="fpo-rating-meta">${r.release_year || ''} ${typeTag} ${formatPlatform(r.platform)}</span>
        </div>
      </div>`;
    }).join('')
    + (rated.length > LIMIT && !_fpoRatingsExpanded
       ? `<button class="fpo-ratings-toggle" onclick="_fpoRatingsExpanded=true;_loadFriendRatings(${uid})">View all ${rated.length} →</button>`
       : '');
  }
  render();
}

// ── Friend library overlay ───────────────────────────────────────────────────
async function openFriendLibrary(uid, name) {
  if (!_handlingPop) history.pushState({ modal: 'friendLibrary' }, '');
  const overlay = document.getElementById('friendLibraryOverlay');
  if (!overlay) return;
  document.getElementById('floCrumb').textContent = `${name}'s Library`;
  document.getElementById('floContent').innerHTML =
    '<div class="profile-section" style="text-align:center;color:var(--muted);padding:40px 0">Loading…</div>';
  overlay.classList.add('open');

  const data = await api('GET', `/api/friends/${uid}/library`).catch(() => null);
  if (!data || data.error) {
    document.getElementById('floContent').innerHTML =
      '<div class="profile-section" style="text-align:center;color:var(--muted);padding:40px 0">Library unavailable.</div>';
    return;
  }

  const lib = data.library || [];
  if (!lib.length) {
    document.getElementById('floContent').innerHTML =
      '<div class="profile-section" style="text-align:center;color:var(--muted);padding:40px 0">No titles in library yet.</div>';
    return;
  }

  // Group by status
  const groups = {
    favourites: lib.filter(i => i.is_fav),
    watchlist:  lib.filter(i => i.status === 'watchlist'),
    watching:   lib.filter(i => i.status === 'watching'),
    finished:   lib.filter(i => i.status === 'finished'),
  };
  const groupMeta = [
    { key: 'favourites', label: '♥️ Favourites' },
    { key: 'watchlist',  label: '🔖 Watchlist' },
    { key: 'watching',   label: '▶️ Watching' },
    { key: 'finished',   label: '✅ Finished' },
  ];

  const itemHtml = (item, idx) => {
    const tk    = escAttr2((item.platform || '') + '::' + (item.title || '').toLowerCase().trim());
    const platLabel = (typeof formatPlatform === 'function') ? formatPlatform(item.platform) : (item.platform || '');
    const typeTag = item.content_type === 'tv'
      ? '<span class="profile-rating-type tag-tv">TV</span>'
      : '<span class="profile-rating-type tag-movie">Film</span>';
    const year = item.release_year || '';
    const posterId = `flo-poster-${idx}`;
    // Async poster injection after render
    setTimeout(() => {
      if (typeof fetchPosterUrl !== 'function') return;
      fetchPosterUrl(item.title, year || null, item.content_type || 'movie').then(imgs => {
        const wrap = document.getElementById(posterId);
        if (wrap && imgs?.poster) {
          wrap.innerHTML = `<img src="${imgs.poster}" alt="${escHtml(item.title)}" style="width:100%;height:100%;object-fit:cover">`;
        }
      });
    }, idx * 30); // slight stagger to avoid hammering
    return `
      <div class="flo-card" onclick="_openTitleFromFriendLib('${tk}','${escAttr2(item.platform)}','${escAttr2(item.title)}')">
        <div class="flo-card-poster" id="${posterId}">${item.content_type === 'tv' ? '📺' : '🎬'}</div>
        <div class="flo-card-body">
          <div class="flo-card-title">${escHtml(item.title)}</div>
          <div class="flo-card-meta">${year ? year + ' · ' : ''}${escHtml(platLabel)}</div>
          <div class="flo-card-tags">
            ${typeTag}
            ${item.imdb_score > 0 ? `<span class="profile-rating-type" style="color:var(--gold)">★ ${item.imdb_score.toFixed(1)}</span>` : ''}
          </div>
        </div>
      </div>`;
  };

  let html = '';
  let globalIdx = 0;
  groupMeta.forEach(({ key, label }) => {
    const items = groups[key];
    if (!items.length) return;
    html += `<div class="profile-section">
      <div class="profile-section-title">${label} <span style="font-size:13px;color:var(--muted);font-weight:400">(${items.length})</span></div>
      <div class="flo-grid">${items.map(item => itemHtml(item, globalIdx++)).join('')}</div>
    </div>`;
  });

  document.getElementById('floContent').innerHTML = html;
}

function closeFriendLibrary() {
  document.getElementById('friendLibraryOverlay')?.classList.remove('open');
}

function _openTitleFromFriendLib(tk, platform, title) {
  closeFriendLibrary();
  const t = allTitles?.find(x => x.platform === platform && x.title.toLowerCase() === title.toLowerCase())
         || { platform, title, content_type: 'movie' };
  setTimeout(() => openModal(t), 80);
}

// Close friend profile on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('friendLibraryOverlay')?.classList.contains('open')) { closeFriendLibrary(); return; }
    if (document.getElementById('friendProfileOverlay')?.classList.contains('open')) { closeFriendProfile(); return; }
  }
});

// ── Friend profile: top actors & directors ───────────────────────────────────
async function loadFriendPeople(uid) {
  const actorSec    = document.getElementById('fpoActorsSection');
  const directorSec = document.getElementById('fpoDirectorsSection');
  if (!actorSec || !directorSec) return;

  const res = await api('GET', `/api/friends/${uid}/watched`, null, {loader: false}).catch(() => null);
  const titles = res?.titles || [];
  if (!titles.length) return;

  const actorMap    = {};
  const directorMap = {};
  const tmdbSilent  = path => api('GET', '/api/tmdb' + path, null, {loader: false});

  const BATCH = 5;
  for (let i = 0; i < titles.length; i += BATCH) {
    await Promise.all(titles.slice(i, i + BATCH).map(async entry => {
      const mt  = (entry.content_type || '').toLowerCase() === 'movie' ? 'movie' : 'tv';
      const qs  = new URLSearchParams({ query: entry.title, type: mt });
      if (entry.release_year) qs.set('year', entry.release_year);
      const search = await api('GET', `/api/tmdb/search?${qs}`, null, {loader: false}).catch(() => null);
      const id = search?.results?.[0]?.id;
      if (!id) return;
      const credits = await tmdbSilent(`/${mt}/${id}/credits`).catch(() => null);
      if (!credits) return;
      (credits.cast || []).slice(0, 10).forEach(a => {
        if (!actorMap[a.id]) actorMap[a.id] = { id: a.id, name: a.name, img: a.profile_path, count: 0 };
        actorMap[a.id].count++;
      });
      (credits.crew || []).filter(c => c.job === 'Director').forEach(d => {
        if (!directorMap[d.id]) directorMap[d.id] = { id: d.id, name: d.name, img: d.profile_path, count: 0 };
        directorMap[d.id].count++;
      });
    }));
  }

  const top = (map, n) => Object.values(map).sort((a, b) => b.count - a.count).slice(0, n);
  const topActors    = top(actorMap,    8);
  const topDirectors = top(directorMap, 8);
  const BASE = 'https://image.tmdb.org/t/p';
  const personCard = p => {
    const img = p.img
      ? `<img src="${BASE}/w185${p.img}" alt="${escHtml(p.name)}" loading="lazy">`
      : `<div class="profile-person-ph">\u{1F3AD}</div>`;
    return `<div class="profile-person-row" title="${escHtml(p.name)}" onclick="openActorModal(${p.id},'${escAttr2(p.name)}','')">
      <div class="profile-person-img">${img}</div>
      <div class="profile-person-name">${escHtml(p.name)}</div>
      <div class="profile-person-count">${p.count} title${p.count !== 1 ? 's' : ''}</div>
    </div>`;
  };
  if (topActors.length) {
    actorSec.style.display = '';
    document.getElementById('fpoActorsList').innerHTML = topActors.map(personCard).join('');
  }
  if (topDirectors.length) {
    directorSec.style.display = '';
    document.getElementById('fpoDirectorsList').innerHTML = topDirectors.map(personCard).join('');
  }
}

// ── Share prompt ──────────────────────────────────────────────────────────────
let _shareAutoHideTimer = null;

function shareStatusFromModal() {
  if (typeof currentModalTitle === 'undefined' || !currentModalTitle) return;
  const entry = (typeof getEntry === 'function') ? getEntry(currentModalTitle) : {};
  const status = entry.status;
  const action = {
    title: currentModalTitle.title,
    platform: currentModalTitle.platform,
    content_type: currentModalTitle.content_type,
    year: currentModalTitle.release_year || null,
    end_year: currentModalTitle.end_year || null,
    imdb_score: currentModalTitle.imdb_score || null,
  };
  if (status && status !== 'not-started') action.status = status;
  // Only include fav change if the user actually toggled it during this modal session
  if (typeof _modalFavChangedThisSession !== 'undefined' && _modalFavChangedThisSession) {
    action.is_fav = !!entry.is_fav;
  }
  promptShare(action);
}

function promptShare(action) {
  if (!_friends.length) return; // no friends, skip silently
  _sharePending = { action, selectedIds: new Set() };

  const titleEl   = document.getElementById('sharePromptTitle');
  const friendsEl = document.getElementById('sharePromptFriends');
  if (!titleEl || !friendsEl) return;

  titleEl.textContent = _shareActionLabel(action);
  friendsEl.innerHTML = _friends.map(f => `
    <button class="share-friend-chip" data-fid="${f.id}" onclick="toggleShareFriend(${f.id},this)">
      ${_avatarHtml(f, 24)}
      <span>${escHtml(f.display_name || f.username)}</span>
    </button>`).join('');

  const prompt = document.getElementById('sharePrompt');
  prompt?.classList.remove('hidden');
  prompt?.classList.add('visible');

  clearTimeout(_shareAutoHideTimer);
  _shareAutoHideTimer = setTimeout(dismissSharePrompt, 12000);
}

function _shareActionLabel(a) {
  const t = a.title || '';
  const statusLabels = {
    watchlist:     `added "${t}" to your watchlist`,
    watching:      `are watching "${t}"`,
    finished:      `finished watching "${t}"`,
    'not-started': `removed "${t}" from your library`,
  };
  const parts = [];
  if (a.status && statusLabels[a.status]) parts.push(statusLabels[a.status]);
  if (a.is_fav === true)  parts.push(parts.length ? `and marked it as favourite` : `favourited "${t}"`);
  if (a.is_fav === false) parts.push(parts.length ? `and removed it from favourites` : `unfavourited "${t}"`);
  const desc = parts.join(', ') || `updated "${t}"`;
  return `Share: you ${desc}`;
}

function toggleShareFriend(fid, btn) {
  if (!_sharePending) return;
  if (_sharePending.selectedIds.has(fid)) {
    _sharePending.selectedIds.delete(fid);
    btn.classList.remove('selected');
  } else {
    _sharePending.selectedIds.add(fid);
    btn.classList.add('selected');
  }
}

function selectAllShareFriends() {
  if (!_sharePending) return;
  const friendsEl = document.getElementById('sharePromptFriends');
  const chips = friendsEl?.querySelectorAll('.share-friend-chip');
  if (!chips) return;
  const allSelected = [...chips].every(btn => btn.classList.contains('selected'));
  const btn = document.querySelector('#sharePrompt .share-select-all-btn');
  chips.forEach(chip => {
    const fid = parseInt(chip.dataset.fid);
    if (allSelected) {
      _sharePending.selectedIds.delete(fid);
      chip.classList.remove('selected');
    } else {
      _sharePending.selectedIds.add(fid);
      chip.classList.add('selected');
    }
  });
  if (btn) btn.textContent = allSelected ? 'Select all' : 'Deselect all';
}

async function confirmShare() {
  if (!_sharePending) return;
  const ids = [..._sharePending.selectedIds];
  if (ids.length) {
    await api('POST', '/api/friends/share', {
      friend_ids: ids,
      action:     _sharePending.action,
    });
  }
  dismissSharePrompt();
}

async function clearAllNotifs() {
  // Tombstone all currently visible IDs so re-fetches don't ghost them back
  const list = document.getElementById('notifList');
  list?.querySelectorAll('[data-notif-id]').forEach(el => _deletedNotifIds.add(+el.dataset.notifId));
  await api('DELETE', '/api/notifications');
  if (list) list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
  document.getElementById('notifShowMore')?.classList.add('hidden');
  _notifHasMore = false;
  _notifOffset  = 0;
  _updateNotifBadge(0);
}

function dismissSharePrompt() {
  clearTimeout(_shareAutoHideTimer);
  const prompt = document.getElementById('sharePrompt');
  prompt?.classList.remove('visible');
  setTimeout(() => prompt?.classList.add('hidden'), 300);
  _sharePending = null;
}

// ── Share-message compose dialog ───────────────────────────────────────────────
function openShareMsgDialog() {
  const t = (typeof currentModalTitle !== 'undefined') ? currentModalTitle : null;
  if (!t) return;
  if (!_friends.length) {
    // Politely nudge if no friends yet
    alert('Add some friends first, then you can send them messages!');
    return;
  }

  _shareMsgSelectedIds = new Set();

  // Populate title row
  const titleRow = document.getElementById('shareMsgTitleRow');
  const platform = (typeof formatPlatform === 'function') ? formatPlatform(t.platform) : t.platform;
  const year     = t.release_year ? ` (${t.release_year})` : '';
  const typeLbl  = t.content_type === 'tv' ? 'TV Show' : 'Movie';
  titleRow.innerHTML = `
    <span class="share-msg-content-type">${escHtml(typeLbl)}</span>
    <span class="share-msg-content-title">${escHtml(t.title)}${escHtml(year)}</span>
    <span class="share-msg-content-plat">${escHtml(platform)}</span>`;

  // Populate friend chips
  const friendsEl = document.getElementById('shareMsgFriends');
  friendsEl.innerHTML = _friends.map(f => `
    <button class="share-msg-friend-chip" data-fid="${f.id}" onclick="toggleShareMsgFriend(${f.id},this)">
      ${_avatarHtml(f, 24)}
      <span>${escHtml(f.display_name || f.username)}</span>
    </button>`).join('');

  document.getElementById('shareMsgText').value = '';
  document.getElementById('shareMsgCharCount').textContent = '0/500';

  const overlay = document.getElementById('shareMsgOverlay');
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('open'));
  setTimeout(() => document.getElementById('shareMsgText').focus(), 150);
}

function closeShareMsgDialog() {
  const overlay = document.getElementById('shareMsgOverlay');
  overlay.classList.remove('open');
  setTimeout(() => overlay.classList.add('hidden'), 280);
}

function toggleShareMsgFriend(fid, btn) {
  if (_shareMsgSelectedIds.has(fid)) {
    _shareMsgSelectedIds.delete(fid);
    btn.classList.remove('selected');
  } else {
    _shareMsgSelectedIds.add(fid);
    btn.classList.add('selected');
  }
}

function selectAllShareMsgFriends() {
  const friendsEl = document.getElementById('shareMsgFriends');
  const chips = friendsEl?.querySelectorAll('.share-msg-friend-chip');
  if (!chips) return;
  const allSelected = [...chips].every(btn => btn.classList.contains('selected'));
  const btn = document.querySelector('#shareMsgOverlay .share-select-all-btn');
  chips.forEach(chip => {
    const fid = parseInt(chip.dataset.fid);
    if (allSelected) {
      _shareMsgSelectedIds.delete(fid);
      chip.classList.remove('selected');
    } else {
      _shareMsgSelectedIds.add(fid);
      chip.classList.add('selected');
    }
  });
  if (btn) btn.textContent = allSelected ? 'Select all' : 'Deselect all';
}

async function sendShareMsg() {
  const t   = (typeof currentModalTitle !== 'undefined') ? currentModalTitle : null;
  const msg = document.getElementById('shareMsgText')?.value.trim();
  const ids = [..._shareMsgSelectedIds];
  if (!t) return;
  if (!ids.length) return;

  const btn = document.querySelector('.share-msg-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  await api('POST', '/api/friends/share', {
    friend_ids: ids,
    action: {
      type:         'title_message',
      title:        t.title,
      platform:     t.platform,
      content_type: t.content_type,
      release_year: t.release_year || null,
      imdb_score:   t.imdb_score   || null,
      message:      msg,
    },
  });

  if (btn) {
    btn.disabled    = false;
    btn.innerHTML   = '✔ Sent!';
    setTimeout(closeShareMsgDialog, 800);
  } else {
    closeShareMsgDialog();
  }
}

// ── Notification detail overlay ──────────────────────────────────────────────
function openNotifDetail(n) {
  const overlay = document.getElementById('notifDetailOverlay');
  const content = document.getElementById('notifDetailContent');
  if (!overlay || !content) return;

  const p    = n.payload || {};
  const time = _relTime(n.created_at);

  // Actor row
  const avatarInner = n.actor_pic
    ? `<img class="nd-avatar" src="${escHtml(n.actor_pic)}" alt="">`
    : `<div class="nd-avatar-ph">${(n.actor_name || '?')[0].toUpperCase()}</div>`;
  const actorClick = n.actor_id
    ? `onclick="closeNotifDetail();openFriendProfile(${n.actor_id})"`
    : '';

  let html = `
    <div class="nd-actor-row" ${actorClick} style="${n.actor_id ? 'cursor:pointer' : ''}">
      ${avatarInner}
      <div>
        <div class="nd-actor-name">${escHtml(n.actor_name || 'Unknown')}</div>
        ${n.actor_username ? `<div class="nd-actor-username">@${escHtml(n.actor_username)}</div>` : ''}
        <div class="nd-time">${time}</div>
      </div>
    </div>`;

  // Title block (for content-related types)
  if (p.title && (n.type === 'shared_action' || n.type === 'title_message')) {
    const year     = p.release_year ? ` (${p.release_year})` : (p.year ? ` (${p.year})` : '');
    const typeLbl  = p.content_type === 'tv' ? 'TV Show' : p.content_type === 'movie' ? 'Movie' : '';
    const platform = (typeof formatPlatform === 'function' && p.platform) ? formatPlatform(p.platform) : (p.platform || '');
    const meta     = [typeLbl, platform].filter(Boolean).join(' · ');
    const tk       = (p.platform || '') + '::' + (p.title || '').toLowerCase().trim();
    // Fall back to cardDataStore for scores missing from older payloads
    const stored   = (typeof cardDataStore !== 'undefined' && cardDataStore[tk]) || {};
    const imdb     = p.imdb_score   || stored.imdb_score   || null;
    const rt       = p.tomatometer  || stored.tomatometer  || null;
    html += `
      <div class="nd-title-block" onclick="openModal('${escHtml(tk)}')" style="cursor:pointer" title="Open title">
        ${meta ? `<div class="nd-meta">${escHtml(meta)}</div>` : ''}
        <div class="nd-title">${escHtml(p.title)}${escHtml(year)}</div>
        <div class="nd-scores">
          ${imdb ? `<span class="nd-imdb">${_imdbStarSvg(11)} ${Number(imdb).toFixed(1)} IMDb</span>` : ''}
          ${rt   ? `<span class="nd-rt">${_rtTomatoSvg(11)} ${rt}% RT</span>` : ''}
        </div>
      </div>`;
  }

  // Message (title_message type) — full text, no truncation
  if (n.type === 'title_message' && p.message) {
    html += `<div class="nd-message">“${escHtml(p.message)}”</div>`;
  }

  // For other types build a description
  if (n.type !== 'title_message') {
    const desc = _notifDetailDesc(n);
    if (desc) html += `<div class="nd-event">${desc}</div>`;
  }

  // Friend-request actions if still pending
  if (n.type === 'friend_request' && !n.is_read) {
    html += `
      <div class="nd-fr-actions">
        <button class="notif-accept-btn" onclick="closeNotifDetail();acceptFriendFromNotif(${n.actor_id},this)">Accept</button>
        <button class="notif-reject-btn" onclick="closeNotifDetail();rejectFriendFromNotif(${n.actor_id},this)">Decline</button>
      </div>`;
  }

  content.innerHTML = html;

  // Collapse long messages with a Read more button (threshold: ~5 visible lines)
  const msgEl = content.querySelector('.nd-message');
  if (msgEl && msgEl.textContent.length > 280) {
    msgEl.classList.add('nd-collapsed');
    const readMoreBtn = document.createElement('button');
    readMoreBtn.className = 'nd-read-more';
    readMoreBtn.textContent = 'Read more ↓';
    readMoreBtn.onclick = () => {
      msgEl.classList.remove('nd-collapsed');
      readMoreBtn.remove();
    };
    msgEl.insertAdjacentElement('afterend', readMoreBtn);
  }

  // Async backdrop (banner) for title block
  if (p.title && (n.type === 'shared_action' || n.type === 'title_message')) {
    const ct = p.content_type || 'movie';
    const titleBlockEl = content.querySelector('.nd-title-block');
    if (titleBlockEl && typeof fetchPosterUrl === 'function') {
      fetchPosterUrl(p.title, p.release_year || p.year || null, ct).then(res => {
        const img = res?.backdrop || res?.poster; // prefer banner; fall back to poster
        if (img && titleBlockEl) {
          titleBlockEl.style.backgroundImage = `url('${img}')`;
          titleBlockEl.classList.add('nd-title-has-poster');
        }
      });
    }
  }

  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function closeNotifDetail() {
  const overlay = document.getElementById('notifDetailOverlay');
  overlay.classList.remove('open');
  setTimeout(() => overlay.classList.add('hidden'), 280);
}

// full text (no truncation) for non-message notifs shown in detail
function _notifDetailDesc(n) {
  const p = n.payload || {};
  switch (n.type) {
    case 'friend_request':  return `${escHtml(n.actor_name || 'Someone')} sent you a friend request.`;
    case 'friend_accepted': return `${escHtml(n.actor_name || 'Someone')} accepted your friend request.`;
    case 'shared_action': {
      const statusMap = {
        watchlist:    '🔖 Added to their watchlist',
        watching:     '▶️ Watching',
        finished:     '✅ Finished watching',
        'not-started':'❌ Removed from their library',
      };
      const parts = [];
      if (p.status && statusMap[p.status]) parts.push(statusMap[p.status]);
      if (p.is_fav === true)  parts.push(parts.length ? '♥️ marked as favourite' : '♥️ Marked as favourite');
      if (p.is_fav === false) parts.push(parts.length ? '💔 removed from favourites' : '💔 Removed from favourites');
      return parts.join(', ') || 'Updated their library.';
    }
    default: return '';
  }
}

// ── Wired into loadApp ────────────────────────────────────────────────────────
// Called by catalog.js loadApp() after auth completes.
// Exposed globally so catalog.js can call it without a hard dependency.
window._initFriends = initFriends;
