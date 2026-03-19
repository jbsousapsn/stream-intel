// ── Profile overlay ───────────────────────────────────────────────────────────

let _profileOpen = false;
let _ratingsData  = [];  // cached for current profile session
let _peopleLoaded = false;

function openProfile() {
  if (!_handlingPop) history.pushState({ modal: 'profile' }, '');
  document.getElementById('profileOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  _profileOpen = true;
  _ratingsData   = [];   // reset so ratings reload fresh each open
  _peopleLoaded  = false;
  loadProfile();
}

function closeProfile() {
  document.getElementById('profileOverlay').classList.remove('open');
  document.body.style.overflow = '';
  _profileOpen = false;
}

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('peopleAllOverlay')?.classList.contains('open')) { closePeopleAll(); return; }
    if (_profileOpen) closeProfile();
  }
});

// ── Load & render ─────────────────────────────────────────────────────────────
async function loadProfile() {
  const data = await api('GET', '/api/profile').catch(() => null);
  if (!data) return;

  // Avatar
  const img = document.getElementById('profileAvatarImg');
  const headerImg     = document.getElementById('headerAvatarImg');
  const headerInitial = document.getElementById('headerAvatarInitial');
  if (data.profile_pic) {
    const posY = data.pic_position_y ?? 50;
    img.src = data.profile_pic;
    img.style.objectPosition = `50% ${posY}%`;
    img.style.display = 'block';
    img.previousElementSibling.style.display = 'none'; // hide placeholder svg
    if (headerImg)     { headerImg.src = data.profile_pic; headerImg.style.display = 'block'; }
    if (headerInitial) { headerInitial.style.display = 'none'; }
  } else {
    img.style.display = 'none';
    img.previousElementSibling.style.display = '';
    if (headerImg)     { headerImg.style.display = 'none'; }
    if (headerInitial) { headerInitial.style.display = ''; }
  }

  // Identity
  const dn = document.getElementById('profileDisplayName');
  dn.textContent = data.display_name || data.username;
  dn.dataset.original = dn.textContent;

  document.getElementById('profileUsernameSub').textContent = '@' + data.username;
  const unInput = document.getElementById('profileUsernameInput');
  const unText  = document.getElementById('profileUsernameText');
  if (unInput) {
    unInput.value = data.username;
    unInput.dataset.original = data.username;
  }
  if (unText) unText.textContent = data.username;
  document.getElementById('profileAuthType').textContent =
    data.auth_type === 'google' ? '🔗 Google' : '🔑 Password';
  if (data.member_since) {
    document.getElementById('profileMemberSince').textContent =
      '📅 Member since ' + _fmtDate(data.member_since);
  }

  // ── Home country selector ─────────────────────────────────────────────────
  const countrySelect = document.getElementById('profileCountrySelect');
  if (countrySelect.options.length <= 1 && typeof COUNTRY_NAMES !== 'undefined') {
    Object.entries(COUNTRY_NAMES)
      .sort((a, b) => a[1].localeCompare(b[1]))
      .forEach(([code, name]) => {
        const opt = document.createElement('option');
        opt.value = code;
        opt.textContent = `${name} (${code})`;
        countrySelect.appendChild(opt);
      });
  }
  countrySelect.value = data.home_country || '';

  // ── Library public toggle ─────────────────────────────────────────────────
  const libToggle = document.getElementById('libraryPublicToggle');
  if (libToggle) libToggle.checked = !!data.library_public;

  // ── Change password section (only for password-auth users) ────────────────
  const cpwSection = document.getElementById('changePasswordSection');
  if (cpwSection) cpwSection.style.display = data.auth_type === 'password' ? '' : 'none';

  const s = data.stats;
  // Override server-side genre counts with client-side computed ones so the
  // chip number matches the library genre filter result exactly.
  if (typeof computeTopGenres === 'function') {
    const cg = computeTopGenres(6);
    if (cg.length) s.top_genres = cg;
  }

  // ── Total watch time ───────────────────────────────────────────────────────
  document.getElementById('profileTotalTime').textContent = s.total_watch_time.label || '0m';
  document.getElementById('profileTimeSub').innerHTML = `
    <div class="ptime-row">
      <span class="ptime-icon" style="font-size:16px;line-height:1">🎬</span>
      <span class="ptime-label">Movies</span>
      <span class="ptime-val">${s.movie_watch_time.label}</span>
    </div>
    <div class="ptime-row">
      <span class="ptime-icon" style="font-size:16px;line-height:1">📺</span>
      <span class="ptime-label">TV Shows</span>
      <span class="ptime-val">${s.tv_watch_time.label}</span>
    </div>`;

  // ── Movies section ────────────────────────────────────────────────────────
  const statCard = (label, value, cls='', navView='', navType='') => `
    <div class="profile-stat-card" ${navView ? `onclick="_navToView('${navView}','${navType}')" title="View in library"` : 'style="cursor:default"'}>
      <div class="profile-stat-value ${cls}">${value}</div>
      <div class="profile-stat-label">${label}</div>
    </div>`;

  document.getElementById('profileMovieGrid').innerHTML = [
    statCard('Finished',  s.movies_finished,  'gold',  'finished', 'movie'),
    statCard('Watching',  s.movies_watching,  '',      'watching', 'movie'),
    statCard('In Library',s.movies_in_library,'',      'library',  'movie'),
  ].join('');
  document.getElementById('profileMovieTime').innerHTML =
    `<span class="watch-card-label">Watch Time</span><span class="watch-card-value">${s.movie_watch_time.label || '0m'}</span>`;

  // ── TV section ────────────────────────────────────────────────────────────
  document.getElementById('profileTVGrid').innerHTML = [
    statCard('Shows Finished',  s.tv_finished,      'accent', 'finished', 'tv'),
    statCard('Shows Watching',  s.tv_watching,       '',       'watching', 'tv'),
    statCard('Episodes Watched',s.episodes_watched,  ''),
  ].join('');
  document.getElementById('profileTVTime').innerHTML =
    `<span class="watch-card-label">Watch Time</span><span class="watch-card-value">${s.tv_watch_time.label || '0m'}</span>`;

  // ── Library overview ──────────────────────────────────────────────────────
  document.getElementById('profileLibraryGrid').innerHTML = [
    statCard('Total in Library', s.total_in_library, '',       'library'),
    statCard('Favourites',       s.favourites,       'tomato', 'favourites'),
  ].join('');
  document.getElementById('profileLibraryGrid2').innerHTML = [
    statCard('Watchlist',   s.watchlist_count,  'purple',   'watchlist'),
    statCard('In Progress', s.watching_count,   'watching', 'watching'),
    statCard('Finished',    s.finished_count,   'finished', 'finished'),
  ].join('');

  // ── Genres ────────────────────────────────────────────────────────────────
  const genresSec = document.getElementById('profileGenresSection');
  if (s.top_genres && s.top_genres.length > 0) {
    genresSec.style.display = '';
    const maxCount = s.top_genres[0].count || 1;
    document.getElementById('profileGenres').innerHTML = s.top_genres.map(g => `
      <div class="profile-genre-chip" onclick="_navToGenre('${g.genre.replace(/'/g,"\\'")}')">
        <span class="genre-chip-name">${genreEmoji(formatGenre(g.genre))} ${formatGenre(g.genre)}</span>
        <div class="profile-genre-bar-wrap"><div class="profile-genre-bar" style="width:${Math.round(g.count/maxCount*100)}%"></div></div>
        <span class="genre-chip-count">${g.count}</span>
        <span class="genre-chip-arrow">›</span>
      </div>`).join('');
  } else {
    genresSec.style.display = 'none';
  }

  // ── Ratings list ──────────────────────────────────────────────────────────
  loadProfileRatings('rating', null);

  // ── Top Actors & Directors (async, non-blocking) ──────────────────────────
  loadTopPeople();
}

// ── Profile ratings list ──────────────────────────────────────────────────────

let _sortedRatingsCache = [];

async function loadProfileRatings(sort, btn) {
  // Update active sort button
  if (btn) {
    document.querySelectorAll('.profile-sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  if (_ratingsData.length === 0) {
    const res = await api('GET', '/api/ratings', null, {loader:false}).catch(() => null);
    _ratingsData = res?.ratings || [];
  }

  const section = document.getElementById('profileRatingsSection');
  if (_ratingsData.length === 0) { section.style.display = 'none'; return; }
  section.style.display = '';

  const sorted = [..._ratingsData].sort((a, b) => {
    if (sort === 'title') return (a.title||'').localeCompare(b.title||'');
    if (sort === 'year')  return (b.year||0) - (a.year||0);
    // default: by rating desc, then title
    return (b.user_rating - a.user_rating) || (a.title||'').localeCompare(b.title||'');
  });

  _sortedRatingsCache = sorted;
  const stars = n => '★'.repeat(n) + '☆'.repeat(5-n);
  document.getElementById('profileRatingsList').innerHTML = sorted.map((r, i) => `
    <div class="profile-rating-item" onclick="openTitleFromProfile('${escAttr2(r.platform)}','${escAttr2(r.title)}')">
      <div class="profile-rating-stars">${stars(r.user_rating)}</div>
      <div class="profile-rating-info">
        <div class="profile-rating-title">${escHtml(r.title)}</div>
        <div class="profile-rating-sub">${r.year ? r.year + ' · ' : ''}${r.platform || ''}</div>
      </div>
      <span class="profile-rating-type ${r.content_type === 'tv' ? 'tag-tv' : 'tag-movie'}">${r.content_type === 'tv' ? 'TV' : 'Film'}</span>
      <button class="rating-menu-btn" onclick="event.stopPropagation();openRatingSheet(${i})" title="Options">⋮</button>
    </div>`).join('');
}

// ── Rating detail bottom sheet ───────────────────────────────────────────────
let _ratingSheetIdx = null;
let _ratingSheetRating = 0;

function openRatingSheet(idx) {
  _ratingSheetIdx = idx;
  const r = _sortedRatingsCache[idx];
  if (!r) return;

  // Title + sub
  document.getElementById('ratingSheetTitle').textContent = r.title;
  _updateRatingSheetSub(r);

  // Status buttons
  _updateRatingSheetStatusRow(r.status || 'not-started');

  // Stars
  _ratingSheetRating = r.user_rating || 0;
  _renderRatingSheetStars(_ratingSheetRating);

  // Action buttons
  document.getElementById('ratingSheetViewBtn').onclick = () => {
    closeRatingSheet();
    openTitleFromProfile(r.platform, r.title);
  };
  document.getElementById('ratingSheetDeleteBtn').onclick = ratingSheetDelete;

  // Push history and open
  if (!_handlingPop) history.pushState({ modal: 'ratingSheet' }, '');
  document.getElementById('ratingSheetBackdrop').classList.add('open');
  document.getElementById('ratingDetailSheet').classList.add('open');
}

function _updateRatingSheetSub(r) {
  const statusLabel = { watchlist: 'Watchlist', watching: 'In Progress', finished: 'Finished' }[r.status] || '';
  const statusCls   = r.status === 'watching' ? 'watching' : (r.status || '');
  document.getElementById('ratingSheetSub').innerHTML =
    `${r.year ? r.year + ' · ' : ''}${escHtml(r.platform || '')}` +
    (statusLabel ? `<span class="rs-status-chip ${statusCls}">${statusLabel}</span>` : '');
}

function _updateRatingSheetStatusRow(currentStatus) {
  const defs = [
    { key: 'watchlist', label: 'Watchlist',   icon: '🔖' },
    { key: 'watching',  label: 'In Progress', icon: '▶' },
    { key: 'finished',  label: 'Finished',    icon: '✓' },
  ];
  const activeCls = { watchlist: 'active-watchlist', watching: 'active-watching', finished: 'active-finished' };
  document.getElementById('ratingSheetStatusRow').innerHTML = defs.map(s =>
    `<button class="rs-status-btn${currentStatus === s.key ? ' ' + activeCls[s.key] : ''}" onclick="ratingSheetSetStatus('${s.key}')">
       <span>${s.icon}</span><span>${s.label}</span>${currentStatus === s.key ? '<span>✓</span>' : ''}
     </button>`
  ).join('');
}

function closeRatingSheet() {
  document.getElementById('ratingSheetBackdrop').classList.remove('open');
  document.getElementById('ratingDetailSheet').classList.remove('open');
  _ratingSheetIdx = null;
}

function _renderRatingSheetStars(rating) {
  const row = document.getElementById('ratingSheetStarsRow');
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += `<button class="rs-star-btn${i <= rating ? ' lit' : ''}" onmouseenter="_rsStarHover(${i})" onmouseleave="_rsStarUnhover()" onclick="ratingSheetSetRating(${i})">★</button>`;
  }
  html += `<span class="rs-rating-label" id="ratingSheetRatingLabel">${rating ? rating + '/5' : '—'}</span>`;
  row.innerHTML = html;
}

function _rsStarHover(n) {
  document.querySelectorAll('.rs-star-btn').forEach((btn, i) => btn.classList.toggle('lit', i < n));
}

function _rsStarUnhover() {
  _renderRatingSheetStars(_ratingSheetRating);
}

async function ratingSheetSetRating(n) {
  const r = _sortedRatingsCache[_ratingSheetIdx];
  if (!r) return;
  _ratingSheetRating = n;
  r.user_rating = n;
  _renderRatingSheetStars(n);
  await api('PATCH', '/api/library', { platform: r.platform, title: r.title, user_rating: n });
  const ri = _ratingsData.find(x => x.platform === r.platform && x.title === r.title);
  if (ri) ri.user_rating = n;
}

async function ratingSheetSetStatus(status) {
  const r = _sortedRatingsCache[_ratingSheetIdx];
  if (!r) return;
  r.status = status;
  const ri = _ratingsData.find(x => x.platform === r.platform && x.title === r.title);
  if (ri) ri.status = status;
  _updateRatingSheetStatusRow(status);
  _updateRatingSheetSub(r);
  await api('PATCH', '/api/library', { platform: r.platform, title: r.title, status });
}

async function ratingSheetDelete() {
  const r = _sortedRatingsCache[_ratingSheetIdx];
  if (!r) return;
  closeRatingSheet();
  await api('PATCH', '/api/library', { platform: r.platform, title: r.title, status: 'not-started', user_rating: 0 });
  _ratingsData = _ratingsData.filter(x => !(x.platform === r.platform && x.title === r.title));
  loadProfileRatings('rating', null);
}

function escAttr2(s) { return (s||'').replace(/'/g, "\\'"); }

function openTitleFromProfile(platform, title) {
  closeProfile();
  const t = allTitles?.find(x => x.platform === platform && x.title.toLowerCase() === title.toLowerCase())
         || {platform, title, content_type: 'movie'};
  setTimeout(() => openModal(t), 80);
}

function openActorFromProfile(id, name) {
  // Keep profile (and peopleAll if open) in the stack so pressing back
  // returns to them naturally. Actor z-index sits above both.
  openActorModal(id, name, '');
}

// ── Top Actors & Directors ────────────────────────────────────────────────────
async function loadTopPeople() {
  if (_peopleLoaded) return;
  _peopleLoaded = true;

  const actorSec    = document.getElementById('profileTopActorsSection');
  const directorSec = document.getElementById('profileTopDirectorsSection');

  // Build list of watched titles with full metadata from allTitles
  const watched = Object.entries(libraryMap)
    .filter(([, e]) => e.status === 'finished' || e.status === 'watching')
    .map(([key]) => {
      const [platform, ...rest] = key.split('::');
      const titleLower = rest.join('::');
      return allTitles?.find(t =>
        t.platform === platform && t.title.toLowerCase().trim() === titleLower
      );
    })
    .filter(Boolean)
    .slice(0, 25);

  if (!watched.length) {
    actorSec.style.display = 'none';
    directorSec.style.display = 'none';
    return;
  }

  const actorMap    = {};
  const directorMap = {};
  const tmdbSilent  = path => api('GET', '/api/tmdb' + path, null, {loader: false});

  const BATCH = 5;
  for (let i = 0; i < watched.length; i += BATCH) {
    await Promise.all(watched.slice(i, i + BATCH).map(async entry => {
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
  _renderPeopleList(actorSec,    'profileTopActorsList',    top(actorMap,    20), 'profileActorsViewAll',    'actors');
  _renderPeopleList(directorSec, 'profileTopDirectorsList', top(directorMap, 20), 'profileDirectorsViewAll', 'directors');
}

const PEOPLE_PREVIEW = 8;
const _allPeopleData  = {};

function _personCard(p) {
  const BASE = 'https://image.tmdb.org/t/p';
  const img = p.img
    ? `<img src="${BASE}/w185${p.img}" alt="${escHtml(p.name)}" loading="lazy">`
    : `<div class="profile-person-ph">🎭</div>`;
  return `
    <div class="profile-person-row" onclick="openActorFromProfile(${p.id},'${escAttr2(p.name)}')"
         title="${escHtml(p.name)}">
      <div class="profile-person-img">${img}</div>
      <div class="profile-person-name">${escHtml(p.name)}</div>
      <div class="profile-person-count">${p.count} title${p.count !== 1 ? 's' : ''}</div>
    </div>`;
}

function _renderPeopleList(section, listId, people, viewAllBtnId, storeKey) {
  if (!people.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  _allPeopleData[storeKey] = people;
  const el = document.getElementById(listId);
  const visible = people.slice(0, PEOPLE_PREVIEW);
  el.innerHTML = visible.map(_personCard).join('');
  const viewAllBtn = document.getElementById(viewAllBtnId);
  if (viewAllBtn) viewAllBtn.style.display = people.length > PEOPLE_PREVIEW ? '' : 'none';
}

function openPeopleAll(title, storeKey) {
  if (!_handlingPop) history.pushState({ modal: 'peopleAll' }, '');
  const people = _allPeopleData[storeKey] || [];
  document.getElementById('peopleAllTitle').textContent = title;
  document.getElementById('peopleAllGrid').innerHTML = people.map(_personCard).join('');
  document.getElementById('peopleAllOverlay').classList.add('open');
  document.getElementById('peopleAllOverlay').querySelector('.people-all-scroll').scrollTop = 0;
}

function closePeopleAll() {
  document.getElementById('peopleAllOverlay').classList.remove('open');
}

// ── Library visibility ───────────────────────────────────────────────────────
async function saveLibraryPublic(isPublic) {
  const res = await api('POST', '/api/profile', { library_public: isPublic }).catch(() => null);
  if (res?.ok) {
    _showProfileHint(isPublic ? '✓ Library visible to friends' : '✓ Library set to private');
  } else {
    // Revert toggle on failure
    const toggle = document.getElementById('libraryPublicToggle');
    if (toggle) toggle.checked = !isPublic;
    _showProfileHint('✗ Could not save setting');
  }
}

// ── Home country ─────────────────────────────────────────────────────────────
async function saveHomeCountry(code) {
  const res = await api('POST', '/api/profile', { home_country: code }).catch(() => null);
  if (res?.ok) {
    // Mirror to the in-memory activeRegion so browsing reflects the new preference
    if (typeof activeRegion !== 'undefined') {
      activeRegion = code || 'all';
      if (typeof updateRegionBtn === 'function') updateRegionBtn();
      // Rebuild the filter to tick the right option
      if (typeof buildRegionFilter === 'function') buildRegionFilter();
    }
    _showProfileHint('✓ Country saved');
  } else {
    _showProfileHint('✗ Could not save country');
  }
}

// ── Username change ──────────────────────────────────────────────────────────
function startEditUsername() {
  document.getElementById('profileUsernameDisplay').style.display = 'none';
  document.getElementById('profileUsernameEdit').style.display    = '';
  const input = document.getElementById('profileUsernameInput');
  if (input) { input.focus(); input.select(); }
}

function cancelEditUsername() {
  document.getElementById('profileUsernameDisplay').style.display = '';
  document.getElementById('profileUsernameEdit').style.display    = 'none';
  const hint = document.getElementById('profileUsernameHint');
  if (hint) { hint.textContent = ''; hint.style.opacity = '0'; }
}

async function saveUsername() {
  const input = document.getElementById('profileUsernameInput');
  const hint  = document.getElementById('profileUsernameHint');
  const newUname = (input.value || '').trim();

  if (!newUname) { _showUsernameHint(hint, '✗ Username cannot be empty', true); return; }
  if (newUname.length < 3) { _showUsernameHint(hint, '✗ Must be at least 3 characters', true); return; }
  if (newUname.length > 30) { _showUsernameHint(hint, '✗ Must be 30 characters or fewer', true); return; }
  if (newUname === input.dataset.original) { _showUsernameHint(hint, 'This is already your username', false); return; }

  const res = await api('POST', '/api/profile', { username: newUname }).catch(() => null);
  if (res?.ok) {
    // Update the sub-label and the header display
    const dn = document.getElementById('profileDisplayName');
    const sub = document.getElementById('profileUsernameSub');
    if (sub) sub.textContent = dn && dn.textContent.trim() !== newUname ? '@' + newUname : '';
    const headerUsernameEl = document.getElementById('usernameDisplay');
    if (headerUsernameEl) headerUsernameEl.textContent = newUname;
    input.dataset.original = newUname;
    // Update display text and exit edit mode
    const unText = document.getElementById('profileUsernameText');
    if (unText) unText.textContent = newUname;
    cancelEditUsername();
    _showProfileHint('✓ Username saved');
  } else {
    const msg = res?.error || 'Could not save username';
    _showUsernameHint(hint, '✗ ' + msg, true);
  }
}

function _showUsernameHint(el, msg, isError) {
  el.textContent = msg;
  el.style.color = isError ? 'var(--tomato, #ff6b6b)' : 'var(--accent)';
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

// ── Display name edit ─────────────────────────────────────────────────────────
async function saveDisplayName(el) {
  const newName = el.textContent.trim();
  if (!newName || newName === el.dataset.original) return;
  const res = await api('POST', '/api/profile', { display_name: newName }).catch(() => null);
  if (res && res.ok) {
    el.dataset.original = newName;
    _showProfileHint('✓ Name saved');
  } else {
    el.textContent = el.dataset.original;
    _showProfileHint('✗ Could not save name');
  }
}

// ── Avatar upload ─────────────────────────────────────────────────────────────
async function onProfilePicChange(event) {
  const file = event.target.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  // Resize then show drag-to-position popup instead of directly uploading
  const dataUrl = await _resizeImage(file, 600).catch(() => null);
  if (!dataUrl) return;
  _openPicCropPopup(dataUrl);
}

function _resizeImage(file, maxPx) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width  * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _showProfileHint(msg) {
  const el = document.getElementById('profileSaveHint');
  el.textContent = msg;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2800);
}

function _navToView(view, navType) {
  closeProfile();
  if (typeof setView === 'function') {
    const tab = document.querySelector(`.nav-tab[data-view="${view}"]`);
    setView(view, tab || null, navType || null);
  }
}

function _navToGenre(genre) {
  closeProfile();
  if (typeof clearAllFilters === 'function') clearAllFilters();
  // Navigate to 'library' so only the user's own watched/watching titles are shown
  if (typeof setView === 'function') {
    const tab = document.querySelector('[data-view="library"]');
    setView('library', tab || null, null);
  }
  if (typeof activeGenres !== 'undefined') {
    activeGenres.add(genre);
    if (typeof updateGenreBtn === 'function') updateGenreBtn();
    if (typeof applyFilters === 'function') applyFilters(true);
  }
}

// ── Profile picture vertical position (drag popup) ──────────────────────────
let _cropDataUrl  = null;
let _cropPosY     = 50;   // 0-100
let _cropDragActive = false;
let _cropDragStartY = 0;
let _cropDragStartOffset = 0;

function _openPicCropPopup(dataUrl) {
  _cropDataUrl = dataUrl;
  _cropPosY    = 50;
  const popup  = document.getElementById('picCropOverlay');
  const img    = document.getElementById('picCropImg');
  const wrap   = document.getElementById('picCropImgWrap');
  img.src = dataUrl;
  wrap.style.transform = 'translateY(0px)';
  popup.style.display  = 'flex';
  // Wait for image to load so we know its natural size
  img.onload = () => { _applyCropPos(); };
  if (img.complete) _applyCropPos();
}

function _applyCropPos() {
  const wrap  = document.getElementById('picCropImgWrap');
  const stage = document.getElementById('picCropStage');
  if (!wrap || !stage) return;
  const img   = document.getElementById('picCropImg');
  const stageH = stage.clientHeight || 260;
  const imgH   = img.naturalHeight;
  const scale  = stage.clientWidth / (img.naturalWidth || stage.clientWidth);
  const scaledH = imgH * scale;
  const maxOffset = Math.max(0, scaledH - stageH);
  const offset = -((_cropPosY / 100) * maxOffset);
  wrap.style.transform = `translateY(${offset}px)`;
}

function _setupCropDrag() {
  const stage = document.getElementById('picCropStage');
  if (!stage || stage._cropDragBound) return;
  stage._cropDragBound = true;

  const onStart = (clientY) => {
    _cropDragActive      = true;
    _cropDragStartY      = clientY;
    const wrap           = document.getElementById('picCropImgWrap');
    const m = wrap.style.transform.match(/translateY\(([\d.-]+)px\)/);
    _cropDragStartOffset = m ? parseFloat(m[1]) : 0;
  };
  const onMove = (clientY) => {
    if (!_cropDragActive) return;
    const wrap  = document.getElementById('picCropImgWrap');
    const stage = document.getElementById('picCropStage');
    const img   = document.getElementById('picCropImg');
    const stageH = stage.clientHeight;
    const scale  = stage.clientWidth / (img.naturalWidth || stage.clientWidth);
    const scaledH = img.naturalHeight * scale;
    const maxOffset = Math.max(0, scaledH - stageH);
    const delta     = clientY - _cropDragStartY;
    const newOffset = Math.min(0, Math.max(-maxOffset, _cropDragStartOffset + delta));
    wrap.style.transform = `translateY(${newOffset}px)`;
    // Update _cropPosY from offset
    _cropPosY = maxOffset > 0 ? Math.round((-newOffset / maxOffset) * 100) : 50;
  };
  const onEnd = () => { _cropDragActive = false; };

  stage.addEventListener('mousedown', e => onStart(e.clientY));
  window.addEventListener('mousemove', e => { if (_cropDragActive) onMove(e.clientY); });
  window.addEventListener('mouseup',   onEnd);
  stage.addEventListener('touchstart', e => { e.preventDefault(); onStart(e.touches[0].clientY); }, {passive:false});
  window.addEventListener('touchmove',  e => { if (_cropDragActive) { e.preventDefault(); onMove(e.touches[0].clientY); } }, {passive:false});
  window.addEventListener('touchend',   onEnd);
}
document.addEventListener('DOMContentLoaded', _setupCropDrag);

function cancelPicCrop() {
  document.getElementById('picCropOverlay').style.display = 'none';
  _cropDataUrl = null;
  // Reset file input so same file can be re-selected
  const input = document.getElementById('profilePicInput');
  if (input) input.value = '';
}

async function savePicCrop() {
  if (!_cropDataUrl) return;
  // Resize to standard upload size
  const final = await _cropToSize(_cropDataUrl, 400, _cropPosY);
  const res = await api('POST', '/api/profile', { profile_pic: final, pic_position_y: _cropPosY }).catch(() => null);
  if (res && res.ok) {
    const img = document.getElementById('profileAvatarImg');
    img.src = final;
    img.style.objectPosition = `50% ${_cropPosY}%`;
    img.style.display = 'block';
    img.previousElementSibling.style.display = 'none';
    const headerImg     = document.getElementById('headerAvatarImg');
    const headerInitial = document.getElementById('headerAvatarInitial');
    if (headerImg)     { headerImg.src = final; headerImg.style.display = 'block'; }
    if (headerInitial) { headerInitial.style.display = 'none'; }
    _showProfileHint('✓ Photo saved');
  } else {
    _showProfileHint('✗ Could not save photo');
  }
  cancelPicCrop();
}

function _cropToSize(dataUrl, maxPx) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.src = dataUrl;
  });
}

// Kept for compatibility but slider no longer rendered on profile
function _showPicPosSlider() {}
function _hidePicPosSlider() {}
function onPicPositionChange(val) {}


// ── Watch History page ────────────────────────────────────────────────────────
let _whData     = [];
let _whType     = 'all';
let _whSort     = 'time';
let _whMinImdb  = 0;
let _whGenre    = '';

async function openWatchHistory() {
  const ov = document.getElementById('watchHistoryOverlay');
  if (!ov) return;
  if (!_handlingPop) history.pushState({ modal: 'watchHistory' }, '');
  ov.classList.add('open');
  document.body.style.overflow = 'hidden';
  // Reset state
  _whType   = 'all';
  _whSort   = 'time';
  _whMinImdb = 0;
  _whGenre  = '';
  _syncWhTypePills('all');
  _syncWhSortBtn('By Watch Time');
  _syncWhImdbBtn('Any IMDb');
  // Reset filter panel to closed
  const whFilterPanel = document.getElementById('whToolbarFilters');
  if (whFilterPanel) whFilterPanel.classList.add('filters-hidden');
  const whFilterBtn = document.getElementById('whFilterToggleBtn');
  if (whFilterBtn) whFilterBtn.classList.remove('filters-open');

  const list = document.getElementById('whList');
  if (list) list.innerHTML = '<div class="empty"><div class="empty-icon" style="font-size:0"><span class="spinner" style="width:36px;height:36px;border-width:3px;margin:0"></span></div><div class="empty-title" style="margin-top:20px">Loading…</div></div>';

  const data = await api('GET', '/api/profile/watchtime', null, {loader: false}).catch(() => null);
  _whData = data?.titles || [];

  // Build genre list for dropdown
  _buildWhGenreMenu();
  whApplyFilters();
}

function closeWatchHistory() {
  const ov = document.getElementById('watchHistoryOverlay');
  if (ov) ov.classList.remove('open');
  document.body.style.overflow = '';
}

function whSetType(type, btn) {
  _whType = type;
  _syncWhTypePills(type);
  whApplyFilters();
}

function _syncWhTypePills(type) {
  document.querySelectorAll('#whTypeBar .library-sub-tab').forEach(p => p.classList.toggle('active', p.dataset.wht === type));
}

function toggleWhFilters() {
  const panel = document.getElementById('whToolbarFilters');
  const btn   = document.getElementById('whFilterToggleBtn');
  if (!panel || !btn) return;
  const willOpen = panel.classList.contains('filters-hidden');
  panel.classList.toggle('filters-hidden', !willOpen);
  btn.classList.toggle('filters-open', willOpen);
}

function whSetSort(val, label, el) {
  _whSort = val;
  _syncWhSortBtn(label);
  document.getElementById('whSortMenu')?.classList.remove('open');
  document.querySelectorAll('#whSortMenu .genre-option').forEach(o => o.classList.remove('checked'));
  if (el) el.classList.add('checked');
  whApplyFilters();
}
function _syncWhSortBtn(label) {
  const btn = document.getElementById('whSortBtn');
  if (btn) btn.textContent = label + ' ▾';
}

function whSetImdb(val, label, el) {
  _whMinImdb = val;
  _syncWhImdbBtn(label);
  document.getElementById('whImdbMenu')?.classList.remove('open');
  document.querySelectorAll('#whImdbMenu .genre-option').forEach(o => o.classList.remove('checked'));
  if (el) el.classList.add('checked');
  whApplyFilters();
}
function _syncWhImdbBtn(label) {
  const btn = document.getElementById('whImdbBtn');
  if (btn) btn.textContent = label + ' ▾';
}

function _buildWhGenreMenu() {
  const allGenres = new Set();
  _whData.forEach(t => (t.genre||'').split(',').forEach(g => { const s=g.trim(); if(s) allGenres.add(s); }));
  const menu = document.getElementById('whGenreMenu');
  if (!menu) return;
  menu.innerHTML = `<div class="genre-option checked" onclick="whSetGenre('',this)"><span class="genre-checkbox"></span>All Genres</div>`
    + [...allGenres].sort().map(g => `<div class="genre-option" onclick="whSetGenre('${g.replace(/'/g,"\\'")  }',this)"><span class="genre-checkbox"></span>${typeof formatGenre==='function'?formatGenre(g):g}</div>`).join('');
}

function whSetGenre(genre, el) {
  _whGenre = genre;
  const btn = document.getElementById('whGenreBtn');
  if (btn) btn.textContent = (genre ? (typeof formatGenre==='function'?formatGenre(genre):genre) : 'All Genres') + ' ▾';
  document.getElementById('whGenreMenu')?.classList.remove('open');
  document.querySelectorAll('#whGenreMenu .genre-option').forEach(o => o.classList.remove('checked'));
  if (el) el.classList.add('checked');
  whApplyFilters();
}

function whToggleDropdown(e, menuId) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const r = btn.getBoundingClientRect();
  const isMobile = window.innerWidth <= 768;
  const bottomGap = isMobile ? 70 : 8;
  // wh dropdowns use position:fixed (no backdrop-filter ancestor) → viewport top always correct
  menu.style.top = r.bottom + 'px';
  menu.style.maxHeight = Math.max(120, window.innerHeight - r.bottom - bottomGap) + 'px';
  if (!isMobile) {
    const mw = 200;
    const overflows = r.left + mw > window.innerWidth - 8;
    menu.style.left = overflows ? Math.max(8, r.right - mw) + 'px' : r.left + 'px';
    menu.style.right = 'auto';
  } else {
    menu.style.left = '';
    menu.style.right = '';
  }
  document.querySelectorAll('.genre-dropdown-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
  document.querySelectorAll('.sort-select.dropdown-open').forEach(b => { if (b !== btn) b.classList.remove('dropdown-open'); });
  menu.classList.toggle('open');
  btn.classList.toggle('dropdown-open', menu.classList.contains('open'));
  if (!menu.classList.contains('open')) btn.blur();
}

// Close wh dropdowns on outside click
document.addEventListener('click', e => {
  const btnIds = {whImdbMenu:'whImdbBtn', whGenreMenu:'whGenreBtn', whSortMenu:'whSortBtn'};
  ['whImdbMenu','whGenreMenu','whSortMenu'].forEach(id => {
    const menu = document.getElementById(id);
    const wrap = menu?.closest('.genre-dropdown');
    if (menu && wrap && !wrap.contains(e.target)) {
      menu.classList.remove('open');
      document.getElementById(btnIds[id])?.classList.remove('dropdown-open');
    }
  });
});

function whApplyFilters() {
  const q   = (document.getElementById('whSearchInput')?.value || '').toLowerCase();
  let items = _whData.filter(t => {
    if (_whType !== 'all' && t.content_type !== _whType) return false;
    if (_whMinImdb > 0 && (t.imdb_score||0) < _whMinImdb) return false;
    if (_whGenre && !(t.genre||'').split(',').map(g=>g.trim()).includes(_whGenre)) return false;
    if (q && !t.title.toLowerCase().includes(q)) return false;
    return true;
  });
  items.sort((a, b) => {
    if (_whSort === 'time')  return (b.watch_mins||0) - (a.watch_mins||0);
    if (_whSort === 'title') return (a.title||'').localeCompare(b.title||'');
    if (_whSort === 'year')  return (b.release_year||0) - (a.release_year||0);
    if (_whSort === 'imdb')  return (b.imdb_score||0) - (a.imdb_score||0);
    return 0;
  });
  _renderWhList(items);
}

function _whFmtTime(mins) {
  if (!mins || mins < 1) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  if (d >= 1)  return `${d}d ${hr}h`;
  if (h >= 1)  return `${h}h ${m}m`;
  return `${m}m`;
}

function _renderWhList(items) {
  const wrap = document.getElementById('whList');
  if (!wrap) return;
  if (!items.length) {
    wrap.innerHTML = '<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">No titles found.</div><div class="empty-sub">Try adjusting your filters.</div></div>';
    return;
  }
  // Make sure all wh items are reachable via openModal(key)
  if (typeof cardDataStore !== 'undefined') {
    items.forEach(wh => { if (!cardDataStore[titleKey(wh)]) cardDataStore[titleKey(wh)] = wh; });
  }
  // Resolve to full allTitles entries once (for fav/wl state, tomatometer, etc.)
  const tList = items.map(wh => {
    const full = (typeof allTitles !== 'undefined' && allTitles)
      ? allTitles.find(x => titleKey(x) === titleKey(wh))
      : null;
    return full || wh;
  });
  // Shallow copies so _wh_rank doesn't mutate the shared allTitles objects
  const rankedList = tList.map((t, i) => ({ ...t, _wh_rank: i + 1 }));
  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.innerHTML = (typeof renderCard === 'function')
    ? rankedList.map((t, i) => renderCard(t, i)).join('')
    : '';
  wrap.innerHTML = '';
  wrap.appendChild(grid);
  wrap.parentElement.scrollTop = 0;
  // Load posters using direct element references scoped to this grid.
  // Using getElementById would return the catalog card with the same ID when a
  // title exists in both views — so we walk grid.children instead.
  if (typeof fetchPosterUrl === 'function') {
    rankedList.forEach((t, i) => {
      const cardEl   = grid.children[i];
      if (!cardEl) return;
      const posterEl = cardEl.querySelector('.card-poster');
      if (!posterEl) return;
      fetchPosterUrl(t.title, t.release_year, t.content_type).then(imgs => {
        if (!imgs || !posterEl.isConnected) return;
        const placeholder = posterEl.querySelector('.card-poster-placeholder');
        const img = document.createElement('img');
        img.src = imgs.poster; img.alt = t.title;
        img.onload  = () => { if (placeholder) placeholder.remove(); };
        img.onerror = () => img.remove();
        posterEl.insertBefore(img, posterEl.querySelector('.card-poster-overlay'));
      });
    });
  }
}

function _whOpenTitle(platform, title) {
  closeWatchHistory();
  const t = (typeof allTitles !== 'undefined' ? allTitles : []).find(x => x.platform === platform && x.title.toLowerCase() === title.toLowerCase())
         || {platform, title, content_type: 'movie'};
  setTimeout(() => {
    if (typeof openModal === 'function') openModal(t);
  }, 80);
}

function _fmtDate(iso) {
  // "2025-03-01" → "Mar 2025"
  if (!iso) return '';
  const [y, m] = iso.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m,10)-1] || m} ${y}`;
}

function _shortTime(mins) {
  if (!mins) return '0m';
  const h = Math.floor(mins / 60);
  if (h >= 24) return `${Math.floor(h/24)}d`;
  if (h > 0)   return `${h}h`;
  return `${mins}m`;
}
