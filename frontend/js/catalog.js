// ── Shared rating icon helpers ───────────────────────────────────────────────
function _imdbStarSvg(sz = 13) {
  return `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" style="vertical-align:-1px;flex-shrink:0" fill="var(--gold)"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
}
function _rtTomatoSvg(sz = 13) {
  return `<svg viewBox="0 0 32 32" width="${sz}" height="${sz}" style="vertical-align:-1px;flex-shrink:0" fill="none"><circle cx="16" cy="20" r="11" fill="var(--tomato)"/><path d="M16 9 Q19 5 23 6 Q20 9 19 12 Q17 9 15 12 Q14 9 11 6 Q15 5 16 9Z" fill="#56ab2f"/></svg>`;
}

// ── Poster queue ─────────────────────────────────────────────────────────────
const posterCache = {};
const fetchQueue  = [];
let   fetchActive = 0;
const FETCH_CONCURRENCY = 6;   // increased from 3
const FETCH_DELAY_MS    = 100; // reduced from 200

function enqueuePoster(title, year, type, resolve) { fetchQueue.push({title,year,type,resolve}); drainQueue(); }
function drainQueue() {
  while (fetchActive < FETCH_CONCURRENCY && fetchQueue.length > 0) {
    const job = fetchQueue.shift(); fetchActive++;
    _doFetch(job.title, job.year, job.type).then(result => {
      job.resolve(result); fetchActive--;
      setTimeout(drainQueue, FETCH_DELAY_MS);
    });
  }
}
function fetchPosterUrl(title, year, type) {
  const k = `${title}::${year}::${type}`;
  if (posterCache[k] !== undefined) return Promise.resolve(posterCache[k]);
  return new Promise(resolve => enqueuePoster(title, year, type, result => { posterCache[k]=result; resolve(result); }));
}
async function _doFetch(title, year, type) {
  try {
    // Route through our server-side proxy instead of calling TMDB directly.
    // This keeps the API key off the client and shares the server-side session.
    const qs  = new URLSearchParams({ query: title, type: type==='movie'?'movie':'tv' });
    if (year) qs.set('year', year);
    const res = await api('GET', `/api/tmdb/search?${qs}`);
    if (!res) return null;
    const h = res.results?.[0];
    if (!h?.poster_path) return null;
    const result = {
      poster:   `https://image.tmdb.org/t/p/w342${h.poster_path}`,
      backdrop: h.backdrop_path ? `https://image.tmdb.org/t/p/w1280${h.backdrop_path}` : null,
      tmdb_id:  h.id,
    };
    // Persist to server cache in background (fire-and-forget)
    api('POST', '/api/posters/cache', [{
      cache_key: `${title}::${year}::${type}`,
      poster_url: result.poster,
      backdrop_url: result.backdrop,
    }]);
    return result;
  } catch { return null; }
}

// ── State ────────────────────────────────────────────────────────────────────
let allTitles         = [];   // deduplicated titles loaded from server
let serverTotal       = 0;    // total rows matching current server-side filters
let libraryMap        = {};   // "platform::title_lower" -> { is_fav, status, notes, user_rating }
let activeType        = 'all';
let activeStatusFilter = 'all'; // status sub-filter: 'all'|'favourites'|'watchlist'|'watching'|'finished'
let activePlatform    = 'all';
let activeRegion      = 'all';
let trendingContentType = 'all'; // 'all' | 'movie' | 'tv' — sub-filter on Trending tab
let activeGenres      = new Set();
let excludedGenres    = new Set();
let activeVotes       = 0;      // minimum IMDb vote count filter
let activeSort        = 'rank'; // current sort key
let activeContentTypeFilter = null; // 'movie' | 'tv' | null — secondary type filter (used when navigating from profile stats)
let activeOngoingFilter = 'all'; // 'all' | 'ongoing' | 'ended' — TV only
let allKnownRegions   = [];          // populated on first full load; preserved when region filter active
let currentModalTitle = null;
// Use titleKey as stable ID so cardDataStore never grows unbounded
const cardDataStore   = {};   // titleKey -> title object
const navStack        = [];
let _handlingPop      = false;   // prevents re-pushing state during popstate handling
const _tmdbShowData   = {};   // titleKey -> { tmdbId, ongoing, endYear, nextEp, posterThumb }
const _upcomingEpStore = {};  // epKey (title_key::SxEx) -> {ep, t, sd}

function titleKey(t) { return `${t.platform}::${t.title.toLowerCase().trim()}`; }
// cardKey adds content_type so a movie and TV show with the same name on the
// same platform get distinct entries in cardDataStore (avoids wrong modal bug).
function cardKey(t) { return `${t.platform}::${t.title.toLowerCase().trim()}::${t.content_type || ''}`; }
function getEntry(t) { return libraryMap[titleKey(t)] || {is_fav:false, status:'not-started', notes:'', user_rating:0}; }

async function syncLibrary(t, patch, opts={}) {
  const entry  = getEntry(t);
  const merged = {...entry, ...patch};
  libraryMap[titleKey(t)] = merged;
  _forYouDirty = true; // library change invalidates recommendations
  await api('POST', '/api/library', {
    platform: t.platform, title: t.title,
    is_fav: merged.is_fav, status: merged.status, notes: merged.notes,
    user_rating: merged.user_rating || 0,
  }, opts);
  // Prompt to share with friends only when value actually changed
  if (typeof promptShare === 'function') {
    const statusChanged = 'status' in patch && patch.status !== entry.status;
    const favChanged    = 'is_fav' in patch && patch.is_fav !== entry.is_fav;
    if (statusChanged || favChanged) {
      const action = {
        title: t.title, platform: t.platform, content_type: t.content_type,
        year: t.release_year || null, end_year: t.end_year || null,
        imdb_score: t.imdb_score || null,
      };
      if (statusChanged) action.status = merged.status;
      if (favChanged)    action.is_fav  = merged.is_fav;
      promptShare(action);
    }
  }
  // Ensure UI everywhere reflects the new state (cards, modal, dots)
  try { if (typeof window.syncUIForTitle === 'function') window.syncUIForTitle(titleKey(t)); } catch (e) { /* no-op */ }
}

// ── App init ─────────────────────────────────────────────────────────────────
async function loadApp() {
  // show overlay while we bootstrap data
  showGlobalLoader();
  try {
    // Detect country + fetch region list in parallel with auth/library bootstrap
    const [cacheData, libData, meData, geoData, regionsData] = await Promise.all([
      api('GET', '/api/posters/cache', null, {loader:false}),
      api('GET', '/api/library'),
      api('GET', '/api/auth/me'),
      fetch('/api/geoip').then(r => r.json()).catch(() => ({country:'US'})),
      api('GET', '/api/regions', null, {loader:false}),
    ]);

    // Set region before title load so the first request is already filtered.
    // Priority: 1) user's home country (saved in profile DB)  2) geoip  3) first DB region
    const detectedCountry = meData?.home_country || geoData?.country || '';
    activeRegion = detectedCountry;

    // Populate the region dropdown immediately using the full region list
    // (we can't derive this from a region-filtered title load)
    if (regionsData?.regions?.length) {
      allKnownRegions = regionsData.regions;
      // If detected country isn't in the DB, fall back to US or first available
      if (!allKnownRegions.includes(activeRegion)) {
        // Saved/detected region not in DB — pick US or first available, but don't
        // overwrite a valid user preference with a wrong guess
        activeRegion = allKnownRegions.includes('US') ? 'US' : allKnownRegions[0] || 'US';
      }
      buildRegionFilter();
    }

    if (cacheData?.cache) {
      Object.entries(cacheData.cache).forEach(([k, v]) => {
        if (v?.poster) {
          // Upgrade any stale w780 backdropURLs to w1280 in-memory
          if (v.backdrop) v.backdrop = v.backdrop.replace('/w780', '/w1280');
          posterCache[k] = v;
        } else {
          posterCache[k] = null;
        }
      });
    }
    if (libData) {
      libraryMap = {};
      (libData.library || []).forEach(r => {
        libraryMap[`${r.platform}::${r.title.toLowerCase().trim()}`] = {
          is_fav: !!r.is_fav, status: r.status || 'not-started', notes: r.notes || '',
          user_rating: r.user_rating || 0,
        };
      });
    }
    if (meData?.authenticated) {
      document.getElementById('statFav').textContent   = meData.favourites || 0;
      document.getElementById('statWatch').textContent = meData.watching   || 0;
      document.getElementById('statDone').textContent  = meData.finished   || 0;
      document.getElementById('usernameDisplay').textContent = meData.username;
      const initial = document.getElementById('headerAvatarInitial');
      if (initial) initial.textContent = (meData.username || '?')[0].toUpperCase();
      loadHeaderAvatar();
      loadPlatformLogos();
    }
    _isAdmin = !!meData?.is_admin;
    // Show admin-only UI elements
    if (_isAdmin) {
      const sidebar = document.getElementById('scraperSidebar');
      const toggle  = document.getElementById('sidebarToggle');
      if (sidebar) sidebar.style.display = '';
      if (toggle)  toggle.style.display  = '';
      document.getElementById('statsNavTab')?.style.setProperty('display', '');
      document.getElementById('statsDrawerItem')?.style.setProperty('display', '');
    }
    await loadTitles();
    // Seed history so the first back press pops state rather than exiting
    history.replaceState({ view: activeType }, '');
    // Background: silently populate runtime_mins/end_year for library entries missing it
    prefetchLibraryRuntimes();
    // Init friends & notifications (non-blocking)
    if (typeof _initFriends === 'function') _initFriends();
  } finally {
    hideGlobalLoader();
  }
}

async function loadLibrary() {
  const data = await api('GET', '/api/library', null, {loader:true});
  if (!data) return;
  libraryMap = {};
  (data.library || []).forEach(r => {
    libraryMap[`${r.platform}::${r.title.toLowerCase().trim()}`] = {
      is_fav: !!r.is_fav, status: r.status || 'not-started', notes: r.notes || '',
      user_rating: r.user_rating || 0,
    };
  });
}

// ── Background runtime prefetch ─────────────────────────────────────────────
// Fetches TMDB data for library entries that are still missing runtime_mins
// or (for TV shows) end_year. Already-enriched titles are skipped, so after
// the first pass this function fires zero requests on subsequent loads.
async function prefetchLibraryRuntimes() {
  const noLoad = {loader: false};
  const toFetch = [];

  for (const [key, entry] of Object.entries(libraryMap)) {
    if (entry.status !== 'finished' && entry.status !== 'watching' && entry.status !== 'watchlist' && !entry.is_fav) continue;
    const [platform, ...rest] = key.split('::');
    const titleLower = rest.join('::');
    const t = allTitles.find(x =>
      x.platform === platform && x.title.toLowerCase().trim() === titleLower
    );
    if (!t) continue;
    // Skip if we already have all the data we need
    const needsRuntime = !t.runtime_mins || t.runtime_mins === 0;
    const needsEndYear = t.content_type === 'tv' && !t.end_year;
    if (!needsRuntime && !needsEndYear) continue;
    toFetch.push(t);
  }
  if (!toFetch.length) return;

  const BATCH = 3;
  for (let i = 0; i < toFetch.length; i += BATCH) {
    await Promise.all(toFetch.slice(i, i + BATCH).map(async t => {
      try {
        const mt  = t.content_type === 'tv' ? 'tv' : 'movie';
        const qs  = new URLSearchParams({query: t.title, type: mt});
        if (t.release_year) qs.set('year', t.release_year);
        const sr  = await api('GET', `/api/tmdb/search?${qs}`, null, noLoad);
        const id  = sr?.results?.[0]?.id;
        if (!id) { return; }
        const det = await api('GET', `/api/tmdb/${mt}/${id}`, null, noLoad);
        if (!det) { return; }
        const mins = (t.content_type === 'tv')
          ? (det.episode_run_time?.[0] || det.last_episode_to_air?.runtime || det.next_episode_to_air?.runtime || 0)
          : (det.runtime || 0);
        if (mins > 0) {
          api('PATCH', '/api/titles/runtime', {platform: t.platform, title: t.title, runtime_mins: mins}, noLoad);
        }
        // Cache show data for year display + upcoming view
        if (t.content_type === 'tv') {
          const tvStatus = det.status || '';
          const ongoing  = ['Returning Series','In Production','Planned','Pilot'].includes(tvStatus);
          const endYear  = ongoing ? null : (det.last_air_date ? det.last_air_date.slice(0,4) : null);
          _tmdbShowData[titleKey(t)] = {
            tmdbId: id, ongoing, endYear,
            nextEp: det.next_episode_to_air || null,
            posterThumb: det.poster_path ? `https://image.tmdb.org/t/p/w92${det.poster_path}` : null,
          };
          // Persist end_year to DB so it appears on cards immediately on next load
          if (endYear && !t.end_year) {
            t.end_year = endYear; // update in-memory title object immediately
            api('PATCH', '/api/titles/end_year', {platform: t.platform, title: t.title, end_year: endYear}, noLoad);
          }
          // Persist is_ongoing so trailing dash shows on next load without TMDB fetch
          if (t.is_ongoing == null) {
            t.is_ongoing = ongoing ? 1 : 0;
            api('PATCH', '/api/titles/is_ongoing', {platform: t.platform, title: t.title, is_ongoing: ongoing}, noLoad);
          }
          // Update year span in any already-rendered card
          const yearEl = document.getElementById(`yeartext-${CSS.escape(titleKey(t))}`);
          if (yearEl && t.release_year) yearEl.textContent = _tvYearDisplay(t);
        }
      } catch (e) { /* silent */ }
    }));
    if (i + BATCH < toFetch.length) await new Promise(r => setTimeout(r, 800));
  }
  // If the profile overlay is currently open, silently refresh it with real runtimes
  if (typeof _profileOpen !== 'undefined' && _profileOpen && typeof loadProfile === 'function') {
    loadProfile();
  }
  // Now backfill per-episode runtimes (defined in library.js, available at runtime)
  if (typeof prefetchEpisodeRuntimes === 'function') prefetchEpisodeRuntimes();
}

async function refreshStats() {
  const data = await api('GET', '/api/auth/me', null, {loader:true});
  if (!data?.authenticated) return;
  document.getElementById('statFav').textContent   = data.favourites || 0;
  document.getElementById('statWatch').textContent = data.watching   || 0;
  document.getElementById('statDone').textContent  = data.finished   || 0;
  document.getElementById('usernameDisplay').textContent = data.username;
}

// ── Load titles from server (server-side GROUP BY dedup) ──────────────────────
// The API now returns one row per platform+title (deduped server-side via
// GROUP BY), with all regions aggregated into a comma-separated `regions`
// field.  This means 9k unique entries instead of 34k raw rows, so a batch
// size of 15000 covers the full catalog comfortably.
const SERVER_BATCH = 15000;
let _appLoading = false; // true while loadTitles is in progress — suppresses empty-state flashes
let _isAdmin    = false; // set from /me — controls admin-only hints in empty states

async function loadTitles() {
  _appLoading = true;
  const sort = activeSort || 'rank';
  const loaderWasHidden = document.getElementById('globalLoader').classList.contains('hidden');
  if (loaderWasHidden) showGlobalLoader();
  try {
    const isTrending   = activeType === 'trending';
    const regionParam   = isTrending && activeRegion !== 'all' ? `&region=${activeRegion}` : '';
    const trendingParam = isTrending ? '&trending=1'  : '';
    const uniqueParam   = '&unique=1';
    const typeParam     = (isTrending && trendingContentType !== 'all') ? `&type=${trendingContentType}` : '';
    const effectiveSort = isTrending ? 'rank'         : sort;
    const data = await api('GET', `/api/titles?limit=${SERVER_BATCH}&sort=${effectiveSort}${regionParam}${trendingParam}${uniqueParam}${typeParam}`);
    if (!data) return;

    const raw = data.titles || [];
    serverTotal = data.total || raw.length;

    allTitles = raw.map(t => {
      if (t.regions) t.regions = t.regions.split(',').map(r => r.trim()).sort().join(', ');
      // Parse platform→regions map from raw "netflix|US,disney_plus|GB,..." string
      if (t.platform_regions_raw) {
        const prMap = {};
        t.platform_regions_raw.split(',').forEach(pr => {
          const idx = pr.indexOf('|');
          if (idx === -1) return;
          const p = pr.slice(0, idx).trim();
          const r = pr.slice(idx + 1).trim();
          if (!prMap[p]) prMap[p] = [];
          if (!prMap[p].includes(r)) prMap[p].push(r);
        });
        t.platform_regions = prMap;
      } else {
        t.platform_regions = null;
      }
      // Parse platform→watch URL map from "netflix|https://...,disney_plus|https://..." string
      const _JW_API = 'apis.justwatch.com';
      if (t.platform_urls_raw) {
        const urlMap = {};
        t.platform_urls_raw.split(',').forEach(pu => {
          const idx = pu.indexOf('|');
          if (idx === -1) return;
          const p   = pu.slice(0, idx).trim();
          const url = pu.slice(idx + 1).trim();
          if (url && !url.includes(_JW_API)) urlMap[p] = url;
        });
        t.platform_urls = Object.keys(urlMap).length ? urlMap : null;
      } else if (t.source_url && !t.source_url.includes(_JW_API)) {
        t.platform_urls = { [t.platform]: t.source_url };
      } else {
        t.platform_urls = null;
      }
      cardDataStore[cardKey(t)] = t;
      return t;
    });

    raw.forEach(t => {
      const k = titleKey(t);
      // Only seed a default entry; never overwrite an existing libraryMap entry
      // (which was loaded from /api/library and may contain user_rating, notes, etc.)
      if (!libraryMap[k]) {
        libraryMap[k] = { is_fav: false, status: 'not-started', notes: '', user_rating: 0 };
      }
    });

    if (activeRegion === 'all') {
      allKnownRegions = [...new Set(raw.flatMap(t => (t.regions||'').split(',').map(r=>r.trim()).filter(Boolean)))].sort();
      buildRegionFilter();
    }
    buildPlatformFilters();
    activeGenres.clear(); excludedGenres.clear();
    buildGenreFilter(); buildExcludeFilter();
    applyFilters();

    // Always mark discover/stats dirty so they re-render after fresh data loads.
    // If the user is already on one of those views (they navigated there while
    // data was still fetching and saw the spinner), render them immediately.
    _discoverDirty = true;
    _statsDirty    = true;
    const _activeView = document.querySelector('.nav-tab.active, .nav-drawer-item.active')?.dataset?.view;
    if (_activeView === 'discover') { renderDiscover(); _discoverDirty = false; }
    if (_activeView === 'foryou')   { renderForYou();   _forYouDirty   = false; }
    if (_activeView === 'stats')    { renderStatsPanel(); _statsDirty = false; }

    const regionCount = data.region_count || allKnownRegions.length || 0;
    document.getElementById('statsCount').textContent = allTitles.length.toLocaleString();
    const statsWrapInit = document.querySelector('.header-stats');
    if (statsWrapInit) statsWrapInit.style.visibility = 'hidden';
    const statsLbl = document.getElementById('statsLabel');
    if (activeType === 'trending' && activeRegion !== 'all') {
      statsLbl.innerHTML = `trending in ${countryFlag(activeRegion)} ${countryLabel(activeRegion)}`;
    } else if (activeRegion !== 'all') {
      statsLbl.innerHTML = `titles in ${countryFlag(activeRegion)} ${countryLabel(activeRegion)}`;
    } else {
      statsLbl.textContent = `titles from ${regionCount} regions`;
    }
    const suffix = activeType === 'trending'
      ? ` trending in ${activeRegion}`
      : activeRegion !== 'all' ? ` for region ${activeRegion}` : ` from ${regionCount} regions`;
    appendLog(`Loaded ${allTitles.length} titles${suffix}.`, 'ok');
  } finally {
    _appLoading = false;
    if (loaderWasHidden) hideGlobalLoader();
  }
}

// ── Scraper ───────────────────────────────────────────────────────────────────
function runScraper() {
  const mode    = document.getElementById('modeSelect').value;
  const raw     = document.getElementById('regionsInput').value.trim();
  const regions = raw ? raw.replace(/\s+/g,'').toUpperCase() : 'ALL';
  const btn     = document.getElementById('runBtn');
  btn.disabled  = true; btn.innerHTML = '<span class="spinner"></span>Running…';
  clearLog();
  const minVotes  = document.getElementById('minVotesSelect').value;
  const multiSort = document.getElementById('multiSortCheck')?.checked ? '1' : '0';
  const proxyUrl  = document.getElementById('proxyInput')?.value.trim() || '';
  const qs = new URLSearchParams({min_votes: minVotes, multi_sort: multiSort});
  if (proxyUrl) qs.set('proxy_url', proxyUrl);
  const es = new EventSource(`/api/run/${mode}/${regions}?${qs}`);
  es.onmessage = e => {
    if (e.data === '__DONE__') {
      es.close(); btn.disabled=false; btn.textContent='Run Scraper';
      appendLog('Done! Loading results…','ok');
      setTimeout(() => loadTitles(), 800);
    } else {
      appendLog(e.data, e.data.includes('ERROR')?'err': e.data.includes('OK')||e.data.includes('Saved')?'ok':'');
    }
  };
  es.onerror = () => { es.close(); btn.disabled=false; btn.textContent='Run Scraper'; appendLog('Connection lost.','err'); };
}

function runEnrich() {
  const btn = document.getElementById('enrichBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Enriching…';
  clearLog();
  appendLog('Starting TMDB enrichment in background…', '');

  api('POST', '/api/enrich').then(data => {
    if (!data || !data.started) {
      appendLog(data?.message || 'Could not start enrichment.', 'err');
      btn.disabled = false; btn.textContent = 'Enrich Only';
      return;
    }
    appendLog('Enrichment running — this may take several minutes…', '');
    let _lastLogLen = 0;
    const _pollInterval = setInterval(async () => {
      const status = await api('GET', '/api/enrich/status');
      if (!status) return;
      // Append any new log lines
      const newLines = (status.log || []).slice(_lastLogLen);
      newLines.forEach(line => appendLog(line, line.includes('ERROR') ? 'err' : line.includes('complete') || line.includes('enriched') ? 'ok' : ''));
      _lastLogLen = (status.log || []).length;
      if (status.done) {
        clearInterval(_pollInterval);
        btn.disabled = false; btn.textContent = 'Enrich Only';
        if (status.error) {
          appendLog('Enrichment failed: ' + status.error, 'err');
        } else {
          appendLog('Enrichment complete! Refreshing…', 'ok');
          setTimeout(() => loadTitles(), 800);
        }
      }
    }, 3000);
  });
}

async function importJson() {
  appendLog('Importing existing JSON files…', '');
  const data = await api('POST', '/api/import-json', null, {loader:true});
  if (data) {
    appendLog(data.message || 'Done.', 'ok');
    await loadTitles();
  }
}

async function downloadDb() {
  const res = await fetch('/api/download-db', { credentials: 'same-origin' });
  if (!res.ok) { appendLog('Download failed: ' + res.status, 'err'); return; }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stream_intel.db';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Log ───────────────────────────────────────────────────────────────────────
function appendLog(msg, cls='') {
  const log = document.getElementById('log');
  const el  = document.createElement('div');
  el.className = 'log-line'+(cls?' '+cls:'');
  el.textContent = msg;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}
function clearLog() { document.getElementById('log').innerHTML=''; }

// ── Mobile header title dropdown ──────────────────────────────────────────────
function _toggleMptDropdown(e) {
  e.stopPropagation();
  const trigger = document.getElementById('mptTrigger');
  if (trigger.classList.contains('no-arrow')) return;
  const dd = document.getElementById('mptDropdown');
  const open = dd.classList.contains('hidden');
  dd.classList.toggle('hidden', !open);
  trigger.classList.toggle('open', open);
}
function _mptSelect(view) {
  document.getElementById('mptDropdown').classList.add('hidden');
  document.getElementById('mptTrigger').classList.remove('open');
  const tab = document.querySelector(`.nav-tab[data-view="${view}"]`);
  setView(view, tab || null);
}
document.addEventListener('click', () => {
  const dd = document.getElementById('mptDropdown');
  if (dd && !dd.classList.contains('hidden')) {
    dd.classList.add('hidden');
    document.getElementById('mptTrigger')?.classList.remove('open');
  }
});
window._toggleMptDropdown = _toggleMptDropdown;
window._mptSelect = _mptSelect;

// ── Image lightbox ────────────────────────────────────────────────────────────
function openImgLightbox(src) {
  if (!src) return;
  const lb  = document.getElementById('imgLightbox');
  const img = document.getElementById('imgLightboxImg');
  if (!lb || !img) return;
  img.src = src;
  lb.classList.remove('hidden');
  requestAnimationFrame(() => lb.classList.add('open'));
}
function closeImgLightbox() {
  const lb = document.getElementById('imgLightbox');
  if (!lb) return;
  lb.classList.remove('open');
  setTimeout(() => { lb.classList.add('hidden'); document.getElementById('imgLightboxImg').src = ''; }, 230);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeImgLightbox(); });
window.openImgLightbox  = openImgLightbox;
window.closeImgLightbox = closeImgLightbox;

// ── View / tab management ─────────────────────────────────────────────────────
const CONTENT_VIEWS = new Set(['all','movie','tv','trending','favourites','watchlist','watching','finished','library']);
let _lastLibraryView = 'library';
function gotoLibrary() { setView(_lastLibraryView, null); }
const SPECIAL_VIEWS = new Set(['discover','stats','upcoming','actors','foryou']);

// Cache for rendered discover/stats so we don't re-compute on every tab click
let _discoverDirty  = true;
let _statsDirty     = true;
let _upcomingDirty  = true;
let _forYouDirty    = true;
let _forYouSections    = []; // stores built sections for see-more navigation (For You)
let _discoverSections  = []; // stores built sections for see-more navigation (Discover)

// ── Actors panel state ────────────────────────────────────────────────────────────
let _actorCategory   = 'trending'; // 'trending' | 'popular'
let _actorPage       = 1;
let _actorTotalPages = 1;
let _actorSearchQ    = '';
let _actorSearchTimer = null;
let _actorGen        = 0;  // generation counter — incremented on each new load to cancel stale responses
const TMDB_IMG_BASE  = 'https://image.tmdb.org/t/p';

function setView(view, el, contentTypeFilter) {
  // Intercept status views: route to 'all' and set the status sub-filter instead
  const _STATUS_VIEWS = new Set(['favourites','watchlist','watching','finished']);
  if (_STATUS_VIEWS.has(view)) {
    setView('all', document.querySelector('.nav-tab[data-view="all"]'), contentTypeFilter);
    setStatusFilter(view, null);
    return;
  }
  // Reset content-type filter unless explicitly provided (e.g. from profile stat cards)
  activeContentTypeFilter = (contentTypeFilter !== undefined) ? contentTypeFilter : null;
  if (!_handlingPop) history.pushState({ view }, '');
  document.querySelectorAll('.nav-tab, .nav-drawer-item').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  // Sync bottom nav active tab
  const _LIBRARY_VIEWS = new Set(['library','watchlist','watching','finished','favourites']);
  const _bnvMap = { all:'home', movie:'home', tv:'home',
                    trending:'trending',
                    library:'library', watchlist:'library', watching:'library', finished:'library', favourites:'library',
                    discover:'more', foryou:'more', upcoming:'more', actors:'more', stats:'more' };
  document.querySelectorAll('.bottom-nav-btn[data-bnav]').forEach(b => {
    b.classList.toggle('active', b.dataset.bnav === (_bnvMap[view] || 'home'));
  });
  // Library sub-bar: show when a library view is active, highlight correct pill
  const isLibraryView = _LIBRARY_VIEWS.has(view);
  const librarySubBar = document.getElementById('librarySubBar');
  if (librarySubBar) {
    librarySubBar.style.display = isLibraryView ? 'flex' : 'none';
    librarySubBar.querySelectorAll('.library-sub-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.lsub === view);
    });
  }
  if (isLibraryView) _lastLibraryView = view;
  // Status sub-bar: show on main content views (All/Movies/TV/Trending), reset filter when switching away
  const statusSubBar = document.getElementById('statusSubBar');
  const isMainContent = ['all','movie','tv','trending'].includes(view);
  if (statusSubBar) {
    statusSubBar.style.display = isMainContent ? '' : 'none';
    if (!isMainContent) {
      activeStatusFilter = 'all';
      statusSubBar.querySelectorAll('.library-sub-tab').forEach(t => t.classList.toggle('active', t.dataset.sf === 'all'));
    }
  }
  // Mobile page title + optional content-type dropdown
  const _mpt = document.getElementById('mptLabel');
  if (_mpt) {
    const _PAGE_TITLES = { library: '📚 Library' };
    const _di = document.querySelector(`.nav-drawer-item[data-view="${view}"]`);
    const _label = _PAGE_TITLES[view] || (_di && _di.textContent.trim()) || '';
    _mpt.textContent = _label;
    // Show chevron only on content views that have a type sub-filter
    const _trigger = document.getElementById('mptTrigger');
    const _showArrow = view === 'all' || view === 'movie' || view === 'tv';
    if (_trigger) _trigger.classList.toggle('no-arrow', !_showArrow);
    // Highlight active option in dropdown
    document.querySelectorAll('.mpt-dropdown button[data-mpt]').forEach(b => {
      b.classList.toggle('active', b.dataset.mpt === view);
    });
  }

  const isContent = CONTENT_VIEWS.has(view);
  document.getElementById('subToolbar').style.display    = isContent ? '' : 'none';
  document.getElementById('gridWrap').style.display      = isContent ? '' : 'none';
  document.getElementById('pagination').style.display    = 'none';
  document.getElementById('discoverPanel').style.display = view==='discover' ? '' : 'none';
  document.getElementById('forYouPanel').style.display   = view==='foryou'   ? '' : 'none';
  document.getElementById('statsPanel').style.display    = view==='stats'    ? '' : 'none';
  document.getElementById('upcomingPanel').style.display = view==='upcoming' ? '' : 'none';
  document.getElementById('actorsPanel').style.display   = view==='actors'   ? '' : 'none';

  if (view === 'discover') { if (_discoverDirty) { renderDiscover(); _discoverDirty=false; } return; }
  if (view === 'foryou')   { if (_forYouDirty)   { renderForYou();   _forYouDirty=false;   } return; }
  if (view === 'stats')    { if (_statsDirty)    { renderStatsPanel(); _statsDirty=false; } return; }
  if (view === 'upcoming') { if (_upcomingDirty) { renderUpcoming(); } return; }
  if (view === 'actors')   { renderActorsPanel(); return; }

  const wasTrending = activeType === 'trending';
  activeType = view;

  // Show/hide region dropdown and type toggle — only relevant on the Trending tab
  const regionDd = document.getElementById('regionDropdown');
  if (regionDd) regionDd.style.display = (view === 'trending') ? '' : 'none';
  const trendingTypeDd = document.getElementById('trendingTypeFilter');
  if (trendingTypeDd) trendingTypeDd.style.display = (view === 'trending') ? '' : 'none';
  if (view !== 'trending') { trendingContentType = 'all'; _syncTrendingTypeBtns(); }
  // Show ongoing/ended filter only on the TV tab
  const ongoingDd = document.getElementById('ongoingFilter');
  if (ongoingDd) ongoingDd.style.display = (view === 'tv') ? '' : 'none';
  if (view !== 'tv' && activeOngoingFilter !== 'all') { activeOngoingFilter = 'all'; _syncOngoingFilterBtns(); }

  // Trending needs server reload (?trending=1 + region); other tabs are client-side
  if (view === 'trending' || wasTrending) {
    loadTitles();
  } else {
    applyFilters();
  }
}

function setTypeFilter(type, el) {
  const tab = document.querySelector(`.nav-tab[data-view="${type}"]`);
  setView(type, tab || el);
}

function setStatusFilter(status, el) {
  activeStatusFilter = status;
  document.querySelectorAll('#statusSubBar .library-sub-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.sf === status)
  );
  applyFilters();
}
window.setStatusFilter = setStatusFilter;

function setTrendingTypeFilter(type) {
  if (trendingContentType === type) return;
  trendingContentType = type;
  _syncTrendingTypeBtns();
  loadTitles();
}

function _syncTrendingTypeBtns() {
  document.querySelectorAll('#trendingTypeFilter .trend-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === trendingContentType);
  });
}

function setOngoingFilter(val) {
  activeOngoingFilter = val;
  _syncOngoingFilterBtns();
  applyFilters();
}
window.setOngoingFilter = setOngoingFilter;
window.loadApp = loadApp;

function _syncOngoingFilterBtns() {
  document.querySelectorAll('#ongoingFilter .trend-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ongoing === activeOngoingFilter);
  });
}

// ── Discover view ─────────────────────────────────────────────────────────────
function renderDiscover() {
  const wrap = document.getElementById('discoverWrap');
  if (!allTitles.length) {
    if (_appLoading) {
      wrap.innerHTML = `<div class="empty"><div class="empty-icon" style="font-size:0"><span class="spinner" style="width:36px;height:36px;border-width:3px;margin:0"></span></div><div class="empty-title" style="margin-top:20px">Loading…</div></div>`;
      return;
    }
    const discoverEmptySub = _isAdmin
      ? 'Run the scraper using the sidebar or import your existing JSON files.'
      : 'The library is being updated — check back soon.';
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">✦</div><div class="empty-title">Nothing here yet</div><div class="empty-sub">${discoverEmptySub}</div></div>`;
    return;
  }

  const sections = [
    { title: '🏆 Top Rated by IMDb',            score: t => t.imdb_score  || 0, fmt: s => s.toFixed(1),  label: 'IMDb',  min: t => (t.imdb_votes||0) >= 10000 },
    { title: '🍅 Top Rated by Rotten Tomatoes', score: t => t.tomatometer || 0, fmt: s => s + '%',        label: 'RT',    min: t => (t.tomatometer||0) > 0 },
    { title: '🎬 Top Rated Movies',             score: t => t.imdb_score  || 0, fmt: s => s.toFixed(1),  label: 'IMDb',  min: t => t.content_type==='movie' && (t.imdb_votes||0) >= 10000 },
    { title: '📺 Top Rated TV Shows',           score: t => t.imdb_score  || 0, fmt: s => s.toFixed(1),  label: 'IMDb',  min: t => t.content_type==='tv' && (t.imdb_votes||0) >= 10000 },
    { title: '🆕 Newest Releases',              score: t => parseInt(t.release_year)||0, fmt: s => String(s), label: 'Year', min: t => (parseInt(t.release_year)||0) > 2010 },
    { title: '🔥 Most Voted',                   score: t => t.imdb_votes  || 0, fmt: s => fmtVotes(s),   label: 'Votes', min: () => true },
  ];

  const DISC_PREVIEW = 8;
  _discoverSections = [];
  const allDiscoverItems = [];

  wrap.innerHTML = sections.map(sec => {
    const allItems = allTitles.filter(sec.min).sort((a,b) => sec.score(b)-sec.score(a)).slice(0, 50);
    if (!allItems.length) return '';
    _discoverSections.push({ title: sec.title, all: allItems });
    const secIdx = _discoverSections.length - 1;
    const previewItems = allItems.slice(0, DISC_PREVIEW);
    previewItems.forEach(t => allDiscoverItems.push(t));
    const more = allItems.length > DISC_PREVIEW;

    return `
      <div class="discover-section">
        <div class="discover-section-title">${sec.title}</div>
        <div class="discover-row">
          ${previewItems.map((t, i) => {
            const tk     = titleKey(t);
            const ck     = cardKey(t);
            const tkAttr = escAttr(tk);
            const tkJs   = jsEsc(tk);
            const plist  = (t.platforms || t.platform || '').split(',').map(p => p.trim()).filter(Boolean);
            const platHtml = plist.length
              ? `<div class="platform-badges">${plist.slice(0,3).map(p => `<span class="platform-badge ${p}" title="${formatPlatform(p)}">${platLogo(p)}</span>`).join('')}${plist.length>3?`<span class="platform-badge plat-overflow">+${plist.length-3}</span>`:''}</div>`
              : '';
            const sv = sec.fmt(sec.score(t));
            const scoreHtml = sec.label === 'IMDb'
              ? `<div class="card-scores"><div class="score-block"><div class="score-label">${_imdbStarSvg(11)} IMDb</div><div class="score-value imdb">${sv}</div></div></div>`
              : sec.label === 'RT'
              ? `<div class="card-scores"><div class="score-block"><div class="score-label">${_rtTomatoSvg(11)} RT</div><div class="score-value rt">${sv}</div></div></div>`
              : `<div class="card-scores"><div class="score-block"><div class="score-label">${sec.label}</div><div class="score-value imdb">${sv}</div></div></div>`;
            return `
              <div class="card" data-tk="${tkAttr}" onclick="openModal('${jsEsc(ck)}')">
                <div class="card-poster" data-disc-tk="${tkAttr}">
                  <div class="card-poster-placeholder"><div class="ph-icon">${t.content_type==='movie'?'🎬':'📺'}</div><div class="ph-title">${escHtml(t.title)}</div></div>
                  <div class="discover-rank-badge${i < 3 ? ' top3' : ''}">${i + 1}</div>
                  <div class="card-poster-overlay">
                    <div class="poster-top"></div>
                    <div class="poster-bottom"></div>
                  </div>
                </div>
                <div class="card-body">
                  <div class="card-title">${escHtml(t.title)}</div>
                  <div class="card-sub">
                    <span class="type-tag ${t.content_type}">${t.content_type==='movie'?'🎬 MOVIE':t.content_type==='tv'?'📺 TV':t.content_type||'?'}</span>
                    <span class="year-text">${t.release_year||'—'}</span>
                  </div>
                  ${scoreHtml}
                  ${platHtml}
                </div>
              </div>`;
          }).join('')}
        </div>
        ${more ? `<button class="foryou-see-more" onclick="openDiscoverSection(${secIdx})">See all ${allItems.length} titles →</button>` : ''}
      </div>`;
  }).join('');

  _loadDiscoverPosters(allDiscoverItems);
}

function openDiscoverSection(idx) {
  const sec = _discoverSections[idx];
  if (!sec) return;
  const overlay = document.getElementById('discoverDetailOverlay');
  const crumb   = document.getElementById('discoverDetailCrumb');
  const grid    = document.getElementById('discoverDetailGrid');
  if (!overlay || !grid) return;
  if (!_handlingPop) history.pushState({ overlay: 'discoverSection' }, '');
  crumb.textContent = sec.title;
  grid.innerHTML = sec.all.map(_forYouCard).join('');
  overlay.classList.add('open');
  _loadDiscoverPosters(sec.all);
}
window.openDiscoverSection = openDiscoverSection;

function closeDiscoverSection() {
  document.getElementById('discoverDetailOverlay')?.classList.remove('open');
}
window.closeDiscoverSection = closeDiscoverSection;

async function _loadDiscoverPosters(items) {
  // Deduplicate by titleKey so we only fetch each poster once,
  // then populate ALL matching cards (same title can appear in multiple sections).
  const seen = new Set();
  for (const t of items) {
    const tk = titleKey(t);
    if (seen.has(tk)) continue;
    seen.add(tk);

    const imgs = await fetchPosterUrl(t.title, t.release_year, t.content_type);
    if (!imgs) continue;

    // Find every card-poster with this title key (one per section it appears in)
    document.querySelectorAll(`[data-disc-tk="${CSS.escape(tk)}"]`).forEach(wrapper => {
      const placeholder = wrapper.querySelector('.card-poster-placeholder');
      if (wrapper.querySelector('img')) return; // already populated (shouldn't happen but guard)
      const img = document.createElement('img');
      img.src = imgs.poster; img.alt = t.title;
      img.onload  = () => { if (placeholder) placeholder.remove(); };
      img.onerror = () => img.remove();
      // Insert before rank badge so badge stays on top of the image
      const badge = wrapper.querySelector('.discover-rank-badge');
      wrapper.insertBefore(img, badge || wrapper.querySelector('.card-poster-overlay'));
    });
  }
}

// ── For You recommendations ───────────────────────────────────────────────────
function _forYouCard(t) {
  const tk      = titleKey(t);
  const tkAttr  = escAttr(tk);
  const tkJs    = jsEsc(tk);
  const plist   = (t.platforms || t.platform || '').split(',').map(p => p.trim()).filter(Boolean);
  const platHtml = plist.length
    ? `<div class="platform-badges">${plist.slice(0,3).map(p => `<span class="platform-badge ${p}" title="${formatPlatform(p)}">${platLogo(p)}</span>`).join('')}${plist.length>3?`<span class="platform-badge plat-overflow">+${plist.length-3}</span>`:''}</div>`
    : '';
  const imdbHtml = t.imdb_score
    ? `<div class="card-scores"><div class="score-block"><div class="score-label">${_imdbStarSvg(11)} IMDb</div><div class="score-value imdb">${t.imdb_score.toFixed(1)}</div></div></div>`
    : '';
  return `
    <div class="card" data-tk="${tkAttr}" onclick="openModal('${tkJs}')">
      <div class="card-poster" data-disc-tk="${tkAttr}">
        <div class="card-poster-placeholder"><div class="ph-icon">${t.content_type==='movie'?'🎬':'📺'}</div><div class="ph-title">${escHtml(t.title)}</div></div>
        <div class="card-poster-overlay"><div class="poster-top"></div><div class="poster-bottom"></div></div>
      </div>
      <div class="card-body">
        <div class="card-title">${escHtml(t.title)}</div>
        <div class="card-sub">
          <span class="type-tag ${t.content_type}">${t.content_type==='movie'?'🎬 MOVIE':t.content_type==='tv'?'📺 TV':t.content_type||'?'}</span>
          <span class="year-text">${t.release_year||'—'}</span>
        </div>
        ${imdbHtml}${platHtml}
      </div>
    </div>`;
}

function renderForYou() {
  const wrap = document.getElementById('forYouWrap');
  if (!wrap) return;
  if (!allTitles.length) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon" style="font-size:0"><span class="spinner" style="width:36px;height:36px;border-width:3px;margin:0"></span></div><div class="empty-title" style="margin-top:20px">Loading…</div></div>`;
    return;
  }

  // Build genre weight map from user's engaged library entries
  const genreWeights = {};
  let totalEngaged = 0;
  for (const t of allTitles) {
    const entry = getEntry(t);
    const engaged = entry.status !== 'not-started' || entry.is_fav;
    if (!engaged) continue;
    totalEngaged++;
    let w = 0;
    if (entry.status === 'finished')  w += 3;
    if (entry.status === 'watching')  w += 2;
    if (entry.status === 'watchlist') w += 1.5;
    if (entry.is_fav) w += 2;
    if ((entry.user_rating || 0) >= 8) w += 2;
    else if ((entry.user_rating || 0) >= 6) w += 1;
    for (const g of (t.genre || '').split(',').map(s => s.trim()).filter(Boolean)) {
      genreWeights[g] = (genreWeights[g] || 0) + w;
    }
  }

  if (totalEngaged === 0) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">✦</div><div class="empty-title">Nothing to recommend yet</div><div class="empty-sub">Add titles to your watchlist, mark things as watching or finished, and we’ll suggest what to watch next.</div></div>`;
    return;
  }

  // Titles the user hasn't engaged with yet (candidates)
  const eligible = allTitles.filter(t => {
    const entry = getEntry(t);
    return !entry.is_fav && entry.status === 'not-started' && (t.imdb_votes || 0) >= 5000;
  });

  // Score each eligible title by genre affinity × quality
  const scored = eligible.map(t => {
    const genres = (t.genre || '').split(',').map(s => s.trim()).filter(Boolean);
    let gs = genres.reduce((sum, g) => sum + (genreWeights[g] || 0), 0);
    if (genres.length > 0) gs /= Math.sqrt(genres.length);
    const qm = (1 + (t.imdb_score || 0) / 10 * 0.4) * (1 + (t.tomatometer || 0) / 100 * 0.2);
    return { t, score: gs * qm };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

  // Top genre names for "Because you enjoy X" sections
  const topGenres = Object.entries(genreWeights).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);

  const PREVIEW = 8;
  const mkSec = (title, all) => ({ title, all, preview: all.slice(0, PREVIEW) });

  const rawSections = [];
  const allScored = scored.map(s => s.t);
  if (allScored.length) rawSections.push(mkSec('✦ Top Picks for You', allScored.slice(0, 50)));
  const allMovies = scored.filter(s => s.t.content_type === 'movie').map(s => s.t);
  if (allMovies.length) rawSections.push(mkSec('🎬 Movies You Might Like', allMovies.slice(0, 50)));
  const allTV = scored.filter(s => s.t.content_type === 'tv').map(s => s.t);
  if (allTV.length) rawSections.push(mkSec('📺 TV Shows You Might Like', allTV.slice(0, 50)));
  const gems = eligible
    .filter(t => (t.imdb_score || 0) >= 7.5 && (t.imdb_votes || 0) < 150000)
    .sort((a, b) => (b.imdb_score || 0) - (a.imdb_score || 0))
    .slice(0, 50);
  if (gems.length >= 3) rawSections.push(mkSec('💎 Hidden Gems', gems));
  for (const genre of topGenres) {
    const gItems = scored
      .filter(s => (s.t.genre || '').split(',').map(g => g.trim()).includes(genre))
      .map(s => s.t).slice(0, 50);
    if (gItems.length >= 3) {
      const displayName = formatGenre(genre);
      const em = genreEmoji(displayName);
      rawSections.push(mkSec(`Because you enjoy ${em} ${displayName}`, gItems));
    }
  }

  _forYouSections = rawSections;

  const allForYouItems = [];
  wrap.innerHTML = rawSections.map((sec, idx) => {
    allForYouItems.push(...sec.all);
    const more = sec.all.length > sec.preview.length;
    return `
      <div class="discover-section">
        <div class="discover-section-title">${sec.title}</div>
        <div class="discover-row">${sec.preview.map(_forYouCard).join('')}</div>
        ${more ? `<button class="foryou-see-more" onclick="openForYouSection(${idx})">See all ${sec.all.length} titles →</button>` : ''}
      </div>`;
  }).join('');

  _loadDiscoverPosters(allForYouItems);
}

function openForYouSection(idx) {
  const sec = _forYouSections[idx];
  if (!sec) return;
  const overlay = document.getElementById('forYouDetailOverlay');
  const crumb   = document.getElementById('forYouDetailCrumb');
  const grid    = document.getElementById('forYouDetailGrid');
  if (!overlay || !grid) return;
  if (!_handlingPop) history.pushState({ overlay: 'forYouSection' }, '');
  crumb.textContent = sec.title;
  grid.innerHTML = sec.all.map(_forYouCard).join('');
  overlay.classList.add('open');
  _loadDiscoverPosters(sec.all);
}
window.openForYouSection = openForYouSection;

function closeForYouSection() {
  document.getElementById('forYouDetailOverlay')?.classList.remove('open');
}
window.closeForYouSection = closeForYouSection;

// ── Stats view ────────────────────────────────────────────────────────────────
function renderStatsPanel() {
  const wrap = document.getElementById('statsPanelWrap');
  if (!allTitles.length) {
    if (_appLoading) {
      wrap.innerHTML = `<div class="empty"><div class="empty-icon" style="font-size:0"><span class="spinner" style="width:36px;height:36px;border-width:3px;margin:0"></span></div><div class="empty-title" style="margin-top:20px">Loading…</div></div>`;
      return;
    }
    const statsEmptySub = _isAdmin
      ? 'Run the scraper to populate your library.'
      : 'The library is being updated — check back soon.';
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">📊</div><div class="empty-title">Nothing here yet</div><div class="empty-sub">${statsEmptySub}</div></div>`;
    return;
  }

  const movies   = allTitles.filter(t => t.content_type==='movie');
  const tv       = allTitles.filter(t => t.content_type==='tv');
  const trending = allTitles.filter(t => t.is_trending);
  const favs      = allTitles.filter(t => getEntry(t).is_fav);
  const watchlist = allTitles.filter(t => getEntry(t).status==='watchlist');
  const watching  = allTitles.filter(t => getEntry(t).status==='watching');
  const finished  = allTitles.filter(t => getEntry(t).status==='finished');

  const platforms = {};
  allTitles.forEach(t => { platforms[t.platform] = (platforms[t.platform]||0)+1; });
  const platMax = Math.max(...Object.values(platforms));
  const platColors = { netflix:'#e50914', disney_plus:'#006e99', hbo_max:'#7b2df5', apple_tv:'#a2aaad', prime_video:'#00a8e1', hulu:'#1ce783', peacock:'#f8be00', paramount_plus:'#0064ff' };

  const genres = {};
  allTitles.forEach(t => { (t.genre||'').split(',').forEach(g=>{ const s=g.trim(); if(s&&s!=='Unknown') genres[s]=(genres[s]||0)+1; }); });
  const topGenres = Object.entries(genres).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const genreMax  = topGenres[0]?.[1] || 1;

  const years = {};
  allTitles.forEach(t => { const y=parseInt(t.release_year); if(y>=1990&&y<=2030) years[y]=(years[y]||0)+1; });
  const yearEntries = Object.entries(years).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const yearMax = yearEntries[0]?.[1] || 1;

  const topImdb = [...allTitles].filter(t=>(t.imdb_votes||0)>=10000).sort((a,b)=>(b.imdb_score||0)-(a.imdb_score||0)).slice(0,8);

  wrap.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-title">Total Titles</div>
      <div class="stat-big">${allTitles.length.toLocaleString()}</div>
      <div class="stat-sub">${movies.length.toLocaleString()} movies · ${tv.length.toLocaleString()} TV shows</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">Your Library</div>
      <div class="stat-big" style="color:var(--fav)">${favs.length}</div>
      <div class="stat-sub">favourites · ${watchlist.length} watchlist · ${watching.length} watching · ${finished.length} finished</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">Trending Now</div>
      <div class="stat-big" style="color:var(--accent2)">${trending.length.toLocaleString()}</div>
      <div class="stat-sub">titles in trending charts</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">By Platform</div>
      <div class="stat-bar-list">
        ${Object.entries(platforms).sort((a,b)=>b[1]-a[1]).map(([p,n])=>`
          <div class="stat-bar-row">
            <div class="stat-bar-label"><span>${formatPlatform(p)}</span><span class="stat-bar-val">${n.toLocaleString()}</span></div>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(n/platMax*100).toFixed(1)}%;background:${platColors[p]||'var(--accent)'}"></div></div>
          </div>`).join('')}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">Top Genres</div>
      <div class="stat-bar-list">
        ${topGenres.map(([g,n])=>`
          <div class="stat-bar-row">
            <div class="stat-bar-label"><span>${formatGenre(g)}</span><span class="stat-bar-val">${n.toLocaleString()}</span></div>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(n/genreMax*100).toFixed(1)}%;background:var(--accent)"></div></div>
          </div>`).join('')}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-card-title">Top Release Years</div>
      <div class="stat-bar-list">
        ${yearEntries.map(([y,n])=>`
          <div class="stat-bar-row">
            <div class="stat-bar-label"><span>${y}</span><span class="stat-bar-val">${n.toLocaleString()}</span></div>
            <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${(n/yearMax*100).toFixed(1)}%;background:var(--watching)"></div></div>
          </div>`).join('')}
      </div>
    </div>
    <div class="stat-card" style="grid-column: span 2">
      <div class="stat-card-title">Highest Rated (IMDb, 10K+ votes)</div>
      <div class="stat-top-list">
        ${topImdb.map((t,i)=>`
          <div class="stat-top-row" data-stk="${escAttr(cardKey(t))}">
            <div class="stat-top-num">${i+1}</div>
            <div class="stat-top-title">${escHtml(t.title)}</div>
            <div style="font-size:11px;color:var(--muted);margin-right:8px">${formatPlatform(t.platform)}</div>
            <div class="stat-top-score">${t.imdb_score.toFixed(1)}</div>
          </div>`).join('')}
      </div>
    </div>`;

  wrap.querySelectorAll('[data-stk]').forEach(el => {
    const tk = el.getAttribute('data-stk');
    if (cardDataStore[tk]) el.onclick = () => openModal(tk);
  });
}

// ── TV year display helper ───────────────────────────────────────────────────
function _tvYearDisplay(t) {
  if (t.content_type !== 'tv') return t.release_year || '—';
  // end_year stored in DB: same year = single-year show, different = range
  if (t.end_year) {
    if (t.end_year === String(t.release_year)) return t.release_year || '—';
    return `${t.release_year}–${t.end_year}`;
  }
  // is_ongoing stored in DB: show trailing dash immediately, no TMDB needed
  if (t.is_ongoing === 1 || t.is_ongoing === true) return t.release_year ? `${t.release_year}–` : '—';
  // Fall back to freshly-fetched TMDB cache
  const d = _tmdbShowData[titleKey(t)];
  if (!d) return t.release_year || '—';
  if (d.ongoing) return t.release_year ? `${t.release_year}–` : '—';
  if (d.endYear && d.endYear !== String(t.release_year)) return `${t.release_year}–${d.endYear}`;
  return t.release_year || '—';
}

// ── Upcoming view ─────────────────────────────────────────────────────────────
async function renderUpcoming(force = false) {
  const wrap = document.getElementById('upcomingWrap');
  _upcomingDirty = false;

  const hasTracked = allTitles.some(t => {
    if (t.content_type !== 'tv') return false;
    const e = getEntry(t);
    return e.is_fav || e.status === 'watching' || e.status === 'finished';
  });

  if (!hasTracked) {
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">📅</div><div class="empty-title">Nothing tracked yet</div><div class="empty-sub">Add TV shows to your Favourites, Watching or Finished list to see upcoming episodes here.</div></div>`;
    return;
  }

  wrap.innerHTML = `<div class="upcoming-fetching"><span class="spinner"></span> Checking for upcoming episodes…</div>`;

  const data = await api('GET', `/api/upcoming${force ? '?force=1' : ''}`, null, {loader: false});
  if (!data) { wrap.innerHTML = `<div class="upcoming-fetching">Failed to load.</div>`; return; }

  // Update _tmdbShowData cache from the response
  for (const [titleStr, sd] of Object.entries(data.show_data || {})) {
    const normalize = s => s.toLowerCase().trim();
    const t = allTitles.find(x => normalize(x.title) === normalize(titleStr));
    if (t) {
      const tk = titleKey(t);
      _tmdbShowData[tk] = {
        tmdbId: sd.tmdb_id,
        ongoing: sd.is_ongoing,
        endYear: sd.end_year,
        posterThumb: sd.poster_thumb,
        nextEp: null,
      };
    }
  }

  const episodes = data.episodes || [];
  if (!episodes.length) {
    wrap.innerHTML = `
      <div class="upcoming-toolbar">
        <button class="upcoming-refresh-btn" onclick="_refreshUpcoming()">↺ Refresh</button>
      </div>
      <div class="empty"><div class="empty-icon">📅</div><div class="empty-title">No upcoming episodes</div><div class="empty-sub">None of your tracked shows have announced upcoming episodes yet.</div></div>`;
    return;
  }

  // Build lookup: title string (lowercase) → first matching title object
  const normalize = s => s.toLowerCase().trim();
  const titleByName = {};
  for (const t of allTitles) {
    const k = normalize(t.title);
    if (!titleByName[k]) titleByName[k] = t;
  }

  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const buckets = {};
  const bucketOrder = [];

  for (const ep of episodes) {
    const t = titleByName[normalize(ep.title_key)];
    const sd = data.show_data[ep.title_key] || {};
    const airDate = new Date(ep.air_date + 'T12:00:00');
    const diffDays = ep.diff_days;

    let label;
    if      (diffDays === 0) label = 'Today';
    else if (diffDays === 1) label = 'Tomorrow';
    else {
      label = `${MONTH_SHORT[airDate.getMonth()]} ${airDate.getDate()}, ${airDate.getFullYear()}`;
    }
    if (!buckets[label]) { buckets[label] = []; bucketOrder.push(label); }
    const epKey = `${ep.title_key}::S${ep.season_number}E${ep.episode_number}`;
    _upcomingEpStore[epKey] = {ep, t, sd};
    buckets[label].push({t, sd, airDate, diffDays, ep, epKey});
  }

  const html = [
    `<div class="upcoming-toolbar"><button class="upcoming-refresh-btn" onclick="_refreshUpcoming()">↺ Refresh</button></div>`,
    ...bucketOrder.map(label => `
      <div class="upcoming-group">
        <div class="upcoming-day-pill${label==='Today'?' upc-pill-today':label==='Tomorrow'?' upc-pill-tomorrow':''}">${label}</div>
        <div class="upcoming-list">
          ${buckets[label].map(_renderUpcomingEpCard).join('')}
        </div>
      </div>`)
  ].join('');

  wrap.innerHTML = html;
  wrap.querySelectorAll('[data-epkey]').forEach(el => {
    const epKey = el.getAttribute('data-epkey');
    el.addEventListener('click', () => openEpisodeDetail(epKey));
  });
}

function _refreshUpcoming() {
  _upcomingDirty = true;
  Object.keys(_tmdbShowData).forEach(k => delete _tmdbShowData[k]);
  // Pass force=1 so the server discards its cache for this user's shows
  renderUpcoming(true);
}

// ── Actors panel ──────────────────────────────────────────────────────────────
async function renderActorsPanel(resetPage = true) {
  const grid    = document.getElementById('actorsGrid');
  const moreBtn = document.getElementById('actorsLoadMore');
  if (!grid) return;

  // Cancel any in-flight load by bumping a generation counter
  const myGen = ++_actorGen;

  if (resetPage) {
    _actorPage = 1;
    grid.innerHTML = `<div class="actors-loading"><span class="spinner"></span><div>Loading…</div></div>`;
    if (moreBtn) moreBtn.style.display = 'none';
  } else {
    const spinner = document.createElement('div');
    spinner.className = 'actors-loading'; spinner.id = '_actorAppendSpinner';
    spinner.innerHTML = `<span class="spinner"></span>`;
    grid.appendChild(spinner);
  }

  let data;
  if (_actorSearchQ) {
    const qs = new URLSearchParams({ q: _actorSearchQ, page: _actorPage });
    data = await api('GET', `/api/people/search?${qs}`, null, {loader: false});
  } else {
    const qs = new URLSearchParams({ page: _actorPage });
    data = await api('GET', `/api/people/${_actorCategory}?${qs}`, null, {loader: false});
  }

  // Stale response — a newer call was made while this was in flight
  if (myGen !== _actorGen) return;

  document.getElementById('_actorAppendSpinner')?.remove();

  if (!data) {
    if (resetPage) grid.innerHTML = `<div class="actors-no-results">Failed to load.</div>`;
    return;
  }

  const results = data.results || [];
  _actorTotalPages = data.total_pages || 1;

  if (!results.length) {
    if (resetPage) {
      const msg = _actorSearchQ ? `No results for "${escHtml(_actorSearchQ)}"` : 'No actors found.';
      grid.innerHTML = `<div class="actors-no-results">${msg}</div>`;
    }
    if (moreBtn) moreBtn.style.display = 'none';
    return;
  }

  const html = results.map(p => _renderActorCard(p)).join('');
  if (resetPage) grid.innerHTML = html;
  else           grid.insertAdjacentHTML('beforeend', html);

  if (moreBtn) moreBtn.style.display = _actorPage < _actorTotalPages ? '' : 'none';

  // Lazy-load photos
  grid.querySelectorAll('.actor-card[data-pid]').forEach(card => {
    const ph = card.querySelector('.actor-card-photo');
    if (ph && ph.dataset.src) {
      const img = new Image();
      img.onload  = () => { ph.innerHTML = `<img src="${ph.dataset.src}" alt="" loading="lazy">`; };
      img.src = ph.dataset.src;
    }
  });
}

function _renderActorCard(p) {
  const esc   = s => String(s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const photo = p.profile_path ? `${TMDB_IMG_BASE}/w185${p.profile_path}` : '';
  const dept  = esc(p.known_for_department || 'Acting');
  const known = (p.known_for||[]).map(k => esc(k.title||'')).filter(Boolean).join(', ');
  const ph    = photo
    ? `<div class="actor-card-photo" data-src="${photo}">\ud83c\udfad</div>`
    : `<div class="actor-card-photo">\ud83c\udfad</div>`;
  return `<div class="actor-card" data-pid="${p.id}" onclick="openActorModal(${p.id},'${jsEsc(p.name)}','')">
    ${ph}
    <div class="actor-card-info">
      <div class="actor-card-name">${esc(p.name)}</div>
      <div class="actor-card-dept">${dept}</div>
      ${known ? `<div class="actor-card-known">${known}</div>` : ''}
    </div>
  </div>`;
}

function setActorCategory(cat, el) {
  if (_actorCategory === cat && !_actorSearchQ) return;
  _actorCategory = cat;
  _actorSearchQ  = '';
  document.getElementById('actorSearchInput').value = '';
  document.getElementById('actorSearchClear').style.display = 'none';
  document.querySelectorAll('.actors-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  renderActorsPanel(true);
}

function actorPanelSearch(q) {
  const clearBtn = document.getElementById('actorSearchClear');
  if (clearBtn) clearBtn.style.display = q ? '' : 'none';
  clearTimeout(_actorSearchTimer);
  _actorSearchTimer = setTimeout(() => {
    _actorSearchQ = q.trim();
    _actorPage    = 1;
    // Deactivate category buttons when searching
    document.querySelectorAll('.actors-cat-btn').forEach(b => b.classList.toggle('active', !_actorSearchQ && b.dataset.cat === _actorCategory));
    renderActorsPanel(true);
  }, 280);
}

function actorPanelLoadMore() {
  if (_actorPage >= _actorTotalPages) return;
  _actorPage++;
  renderActorsPanel(false);
}

function _renderUpcomingEpCard({t, sd, diffDays, airDate, ep, epKey}) {
  const entry     = t ? getEntry(t) : {};
  const tk        = t ? titleKey(t) : ep.title_key;
  const tkAttr    = escAttr(tk);
  const sLabel    = `S${String(ep.season_number).padStart(2,'0')} · E${String(ep.episode_number).padStart(2,'0')}`;
  const statusCls = entry.status === 'watching' ? ' watching' : entry.status === 'finished' ? ' finished' : entry.is_fav ? ' fav' : '';
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAY_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let dateCls = '', dateStr;
  if (diffDays === 0) {
    dateCls = ' upc-date-today';    dateStr = 'Today';
  } else if (diffDays === 1) {
    dateCls = ' upc-date-tomorrow'; dateStr = 'Tomorrow';
  } else {
    dateStr = `${DAY_SHORT[airDate.getDay()]} ${MONTH_SHORT[airDate.getMonth()]} ${airDate.getDate()}`;
  }
  const thumb = ep.still_path
    ? `<img src="https://image.tmdb.org/t/p/w185${ep.still_path}" alt="" loading="lazy">`
    : sd.poster_thumb
    ? `<img src="${sd.poster_thumb}" alt="" loading="lazy">`
    : `<div class="upc-thumb-ph">📺</div>`;
  const showTitle = t ? t.title : ep.title_key;
  const epKeyAttr = escAttr(epKey || `${ep.title_key}::S${ep.season_number}E${ep.episode_number}`);
  return `
    <div class="upcoming-ep-card" data-epkey="${epKeyAttr}">
      <div class="upc-thumb">${thumb}</div>
      <div class="upc-info">
        <div class="upc-show-pill${statusCls}" onclick="event.stopPropagation();openModal('${jsEsc(tk)}')">${escHtml(showTitle)} ›</div>
        <div class="upc-ep-label">${sLabel}</div>
        ${ep.name ? `<div class="upc-ep-name">${escHtml(ep.name)}</div>` : ''}
        ${ep.overview ? `<div class="upc-ep-overview">${escHtml(ep.overview.slice(0,130))}${ep.overview.length>130?'…':''}</div>` : ''}
      </div>
      <div class="upc-date${dateCls}">${dateStr}</div>
    </div>`;
}

function setPlatformFilter(plat, el) {
  activePlatform = plat;
  document.querySelectorAll('#platformFilter .pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  applyFilters();
}

const PLATFORM_LOGOS = {
  netflix:        `<svg class="plat-logo" viewBox="0 0 18 18" aria-hidden="true"><rect width="18" height="18" rx="3" fill="#e50914"/><text x="9" y="13.5" text-anchor="middle" font-size="13" font-weight="900" font-family="Georgia,serif" fill="white">N</text></svg>`,
  disney_plus:    `<svg class="plat-logo" viewBox="0 0 18 18" aria-hidden="true"><rect width="18" height="18" rx="3" fill="#113CCF"/><text x="9" y="12.5" text-anchor="middle" font-size="8" font-weight="900" font-family="Arial,sans-serif" fill="white">D+</text></svg>`,
  hbo_max:        `<svg class="plat-logo" viewBox="0 0 18 18" aria-hidden="true"><rect width="18" height="18" rx="3" fill="#6a23e2"/><text x="9" y="12" text-anchor="middle" font-size="6" font-weight="900" font-family="Arial,sans-serif" fill="white">MAX</text></svg>`,
  apple_tv:       `<svg class="plat-logo" viewBox="0 0 18 18" aria-hidden="true"><rect width="18" height="18" rx="3" fill="#1c1c1e" stroke="rgba(255,255,255,.2)" stroke-width="1"/><text x="9" y="10.5" text-anchor="middle" font-size="4.5" font-weight="400" font-family="Arial,sans-serif" fill="white">Apple</text><text x="9" y="15.5" text-anchor="middle" font-size="5" font-weight="700" font-family="Arial,sans-serif" fill="white">TV+</text></svg>`,
  prime_video:    `<svg class="plat-logo" viewBox="0 0 18 18" aria-hidden="true"><rect width="18" height="18" rx="3" fill="#00a8e1"/><text x="9" y="10.5" text-anchor="middle" font-size="4.5" font-weight="700" font-family="Arial,sans-serif" fill="white">prime</text><text x="9" y="15.5" text-anchor="middle" font-size="5.5" font-weight="700" font-family="Arial,sans-serif" fill="#ff9900">video</text></svg>`,
  hulu:           `<svg class="plat-logo" viewBox="0 0 18 18" aria-hidden="true"><rect width="18" height="18" rx="3" fill="#1CE783"/><text x="9" y="12" text-anchor="middle" font-size="6.5" font-weight="900" font-family="Arial,sans-serif" fill="#0a0a0a">hulu</text></svg>`,
  peacock:        `<svg class="plat-logo" viewBox="0 0 18 18" aria-hidden="true"><rect width="18" height="18" rx="3" fill="#0d0d0d"/><g transform="translate(9,14)"><ellipse cx="0" cy="-4" rx="1" ry="4.2" transform="rotate(-75)" fill="#E8001D"/><ellipse cx="0" cy="-4" rx="1" ry="4.2" transform="rotate(-45)" fill="#FA8B1D"/><ellipse cx="0" cy="-4" rx="1" ry="4.2" transform="rotate(-15)" fill="#FDD900"/><ellipse cx="0" cy="-4" rx="1" ry="4.2" transform="rotate(15)"  fill="#00B050"/><ellipse cx="0" cy="-4" rx="1" ry="4.2" transform="rotate(45)"  fill="#0065BE"/><ellipse cx="0" cy="-4" rx="1" ry="4.2" transform="rotate(75)"  fill="#7B2D8B"/></g></svg>`,
  paramount_plus: `<svg class="plat-logo" viewBox="0 0 18 18" aria-hidden="true"><rect width="18" height="18" rx="3" fill="#0064FF"/><path d="M0 18 L0 13 C3 8 6 6 9 5.5 C12 6 15 8 18 13 L18 18 Z" fill="white"/><text x="2.5" y="11" font-size="2.6" fill="white" font-family="Arial,sans-serif">★★★★★</text><text x="9" y="16.5" text-anchor="middle" font-size="4.5" font-weight="900" font-family="Arial,sans-serif" fill="#0064FF">P+</text></svg>`,
};
// Overridden once real TMDB logos are loaded
let _realLogoUrls = {};

function platLogo(p) {
  if (_realLogoUrls[p]) {
    return `<img class="plat-logo" src="${_realLogoUrls[p]}" alt="${formatPlatform(p)}" loading="lazy">`;
  }
  return PLATFORM_LOGOS[p] || '';
}

// Load real platform logos from TMDB (via our backend cache)
async function loadPlatformLogos() {
  try {
    const data = await api('GET', '/api/platform-logos', null, {loader: false});
    if (data && typeof data === 'object') {
      _realLogoUrls = data;
      // Re-render platform filter pills if they've already been built
      if (allTitles.length) buildPlatformFilters();
      // Re-render current page so card badges show real logos
      if (filteredTitles.length) renderPage();
    }
  } catch (e) { /* logos are optional */ }
}

function buildPlatformFilters() {
  const platforms = ['all', ...new Set(allTitles.map(t=>t.platform))];
  const VISIBLE = 5; // "All" + 4 platforms visible before collapse
  const pills = platforms.map((p,i)=>
    `<button class="pill${i===0?' active':''}${i>=VISIBLE?' plat-extra hidden':''}" onclick="setPlatformFilter('${p}',this)">${p==='all'?'All Platforms':platLogo(p)+formatPlatform(p)}</button>`
  ).join('');
  const showMore = platforms.length > VISIBLE
    ? `<button class="pill plat-expand-btn" onclick="togglePlatformExpand(this)">+${platforms.length-VISIBLE} more</button>`
    : '';
  document.getElementById('platformFilter').innerHTML = pills + showMore;
}

function togglePlatformExpand(btn) {
  const hidden = document.querySelectorAll('#platformFilter .plat-extra');
  const expanded = btn.dataset.expanded === '1';
  hidden.forEach(el => el.classList.toggle('hidden', expanded));
  btn.dataset.expanded = expanded ? '0' : '1';
  btn.textContent = expanded ? `+${hidden.length} more` : 'Show less';
}

const COUNTRY_NAMES = {
  US:'United States',GB:'United Kingdom',BR:'Brazil',MX:'Mexico',CA:'Canada',
  AU:'Australia',DE:'Germany',FR:'France',ES:'Spain',IT:'Italy',JP:'Japan',
  KR:'South Korea',IN:'India',AR:'Argentina',CO:'Colombia',CL:'Chile',
  PL:'Poland',NL:'Netherlands',SE:'Sweden',NO:'Norway',DK:'Denmark',
  FI:'Finland',PT:'Portugal',ZA:'South Africa',SG:'Singapore',TH:'Thailand',
  ID:'Indonesia',PH:'Philippines',TR:'Turkey',SA:'Saudi Arabia',
};
function countryLabel(code) { return COUNTRY_NAMES[code] ? `${code} – ${COUNTRY_NAMES[code]}` : code; }
function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  return `<img src="https://flagcdn.com/16x12/${code.toLowerCase()}.png" alt="${code}" class="country-flag">`;
}

function buildRegionFilter() {
  const menu = document.getElementById('regionDropdownMenu');
  // No "Show all" button — a country is always required
  menu.innerHTML = [
    `<input class="dropdown-search" id="regionSearch" placeholder="Search country…"`,
    ` oninput="filterRegionDropdown(this.value)" onclick="event.stopPropagation()">`,
  ].join('');
  allKnownRegions.forEach(code => {
    const el = document.createElement('div');
    el.className = 'genre-option' + (activeRegion===code?' checked':'');
    el.dataset.code = code;
    el.innerHTML = `<span class="genre-checkbox"></span>${countryFlag(code)} ${countryLabel(code)}`;
    el.onclick = () => setRegion(code, el);
    menu.appendChild(el);
  });
  updateRegionBtn();
}

function filterRegionDropdown(q) {
  const lq = q.trim().toLowerCase();
  document.querySelectorAll('#regionDropdownMenu .genre-option').forEach(el => {
    const code = el.dataset.code || '';
    const name = (COUNTRY_NAMES[code] || '').toLowerCase();
    el.style.display = (!lq || code.toLowerCase().includes(lq) || name.includes(lq)) ? '' : 'none';
  });
}

function setRegion(code, el) {
  if (activeRegion === code) {
    // Already selected — just close the dropdown, don't deselect
    document.getElementById('regionDropdownMenu').classList.remove('open');
    return;
  }
  activeRegion = code;
  document.querySelectorAll('#regionDropdownMenu .genre-option').forEach(e => e.classList.remove('checked'));
  el.classList.add('checked');
  updateRegionBtn();
  document.getElementById('regionDropdownMenu').classList.remove('open');
  loadTitles(); // reload from server with region filter
}

function clearRegion() {
  activeRegion = 'all';
  document.querySelectorAll('#regionDropdownMenu .genre-option').forEach(e => e.classList.remove('checked'));
  updateRegionBtn();
  loadTitles(); // reload full catalog
}

function updateRegionBtn() {
  const b = document.getElementById('regionDropdownBtn');
  if (!b) return;
  if (activeRegion === 'all') {
    b.textContent = 'All Countries ▾'; b.style.color=''; b.style.borderColor='';
  } else {
    b.innerHTML = `${countryFlag(activeRegion)} ${activeRegion} ▾`;
    b.style.color='var(--accent)'; b.style.borderColor='var(--accent)';
  }
}

function toggleRegionDropdown(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const menu = document.getElementById('regionDropdownMenu');
  _placeMenu(menu, btn);
  document.querySelectorAll('.genre-dropdown-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
  document.querySelectorAll('.sort-select.dropdown-open').forEach(b => { if (b !== btn) b.classList.remove('dropdown-open'); });
  menu.classList.toggle('open');
  btn.classList.toggle('dropdown-open', menu.classList.contains('open'));
  if (!menu.classList.contains('open')) btn.blur();
}


// ── applyFilters — with 150ms debounce on search input ───────────────────────
let _filterTimer = null;
function applyFilters(immediate=false) {
  if (_filterTimer) clearTimeout(_filterTimer);
  const delay = immediate ? 0 : 150;
  _filterTimer = setTimeout(_applyFiltersNow, delay);
}

// Cached sort key to avoid re-sorting when only the page changes
let _lastSort = null;
let _lastActiveType = null;  // also track view so switching views always re-sorts
let _sortedTitles = [];

function _applyFiltersNow() {
  const q        = document.getElementById('searchBox').value.toLowerCase();
  const sort     = activeSort || 'rank';
  const minVotes = activeVotes || 0;

  let filtered = allTitles.filter(t => {
    const entry = getEntry(t);
    if (activePlatform!=='all' && t.platform!==activePlatform) return false;
    if (activeType==='movie'      && t.content_type!=='movie') return false;
    if (activeType==='tv'         && t.content_type!=='tv')    return false;
    // Secondary content-type filter (e.g. when navigating from profile "Movies Finished")
    if (activeContentTypeFilter === 'movie' && t.content_type !== 'movie') return false;
    if (activeContentTypeFilter === 'tv'    && t.content_type !== 'tv')    return false;
    // Trending titles are filtered server-side (?trending=1); this is a safety-net fallback
    if (activeType==='trending'   && !(t.ranking_position > 0)) return false;
    // Ongoing/Ended filter (TV only)
    if (activeOngoingFilter === 'ongoing' && !(t.content_type === 'tv' && t.is_ongoing == 1)) return false;
    if (activeOngoingFilter === 'ended'   && !(t.content_type === 'tv' && t.is_ongoing == 0)) return false;
    // Use activeStatusFilter (from status sub-bar) when set, otherwise fall back to activeType
    const _effectiveSF = activeStatusFilter !== 'all' ? activeStatusFilter : activeType;
    if (_effectiveSF==='favourites' && !entry.is_fav)              return false;
    if (_effectiveSF==='watchlist'  && entry.status!=='watchlist')  return false;
    if (_effectiveSF==='watching'   && entry.status!=='watching')   return false;
    if (_effectiveSF==='finished'   && entry.status!=='finished')   return false;
    if (_effectiveSF==='library'    && !entry.is_fav && entry.status!=='watchlist' && entry.status!=='watching' && entry.status!=='finished') return false;
    // Hide low-vote titles unless user is searching or browsing their personal lists
    const isPersonalView = activeStatusFilter !== 'all' || ['library','favourites','watchlist','watching','finished'].includes(activeType);
    if (!q && !isPersonalView && (t.imdb_votes||0) < 10000) return false;
    if (q && !t.title.toLowerCase().includes(q) && !_actorEnrichedTitleKeys.has(titleKey(t))) return false;
    if (minVotes>0 && (t.imdb_votes||0)<minVotes) return false;
    if (activeGenres.size>0) {
      const tg=(t.genre||'').split(',').map(g=>g.trim());
      if (!tg.some(g=>activeGenres.has(g))) return false;
    }
    if (excludedGenres.size>0) {
      const tg=(t.genre||'').split(',').map(g=>g.trim());
      if (tg.some(g=>excludedGenres.has(g))) return false;
    }
    return true;
  });

  // Re-sort when sort key changes, view changes, or result count changes.
  // Checking activeType prevents the stale-intersection bug where two different views
  // have the same filtered count but completely different titles.
  if (sort !== _lastSort || activeType !== _lastActiveType || _sortedTitles.length !== filtered.length) {
    _lastSort = sort;
    _lastActiveType = activeType;
    filtered.sort((a,b) => {
      if (sort==='rank')  return (a.ranking_position||999)-(b.ranking_position||999);
      if (sort==='imdb')  return (b.imdb_score||0)-(a.imdb_score||0);
      if (sort==='rt')    return (b.tomatometer||0)-(a.tomatometer||0);
      if (sort==='year')  return (b.release_year||0)-(a.release_year||0);
      if (sort==='title') return a.title.localeCompare(b.title);
      return 0;
    });
    _sortedTitles = filtered;
  } else {
    // Re-filter but reuse sort order from previous run
    const sortedKeys = new Set(_sortedTitles.map(titleKey));
    filtered = _sortedTitles.filter(t => filtered.some(f => titleKey(f)===titleKey(t)));
    _sortedTitles = filtered;
  }

  // Mark discover/stats/forYou as dirty so they refresh next time their tab is opened
  _discoverDirty = true;
  _statsDirty    = true;
  _forYouDirty   = true;

  renderGrid(filtered);
  const _SF_VIEWS = new Set(['favourites','watchlist','watching','finished']);
  const statsWrap = document.querySelector('.header-stats');
  if (statsWrap) statsWrap.style.visibility = (_SF_VIEWS.has(activeType) || _SF_VIEWS.has(activeStatusFilter)) ? '' : 'hidden';
  document.getElementById('statsCount').textContent = filtered.length.toLocaleString();

  // People search — run async whenever user types a query of 3+ chars
  if (q.length >= 3) {
    _searchPeopleForCatalog(q);
  } else {
    clearTimeout(_peopleSearchTimer);
    _lastPeopleQuery = '';
    _actorEnrichedTitleKeys.clear();
    _actorEnrichedLabel = '';
    const strip = document.getElementById('catalogPeopleStrip');
    if (strip) strip.style.display = 'none';
  }

  const statsLbl2 = document.getElementById('statsLabel');
  if (filtered.length !== allTitles.length) {
    statsLbl2.textContent = _isAdmin
      ? `of ${allTitles.length.toLocaleString()} titles`
      : `titles`;
  } else if (activeType === 'trending' && activeRegion !== 'all') {
    statsLbl2.innerHTML = `trending in ${countryFlag(activeRegion)} ${countryLabel(activeRegion)}`;
  } else if (activeRegion !== 'all') {
    statsLbl2.innerHTML = `titles in ${countryFlag(activeRegion)} ${countryLabel(activeRegion)}`;
  } else {
    statsLbl2.textContent = `titles from ${new Set(allTitles.flatMap(t => (t.regions||'').split(',').map(r=>r.trim()))).size} regions`;
  }
  _updateClearUI();
  _updateFilterToggleBtn();
}

function _updateClearUI() {
  const q     = document.getElementById('searchBox')?.value || '';
  const xBtn  = document.getElementById('searchClearBtn');
  const cfBtn = document.getElementById('clearFiltersBtn');
  if (xBtn)  xBtn.style.display  = q ? '' : 'none';
  // Region is always set so never count it as a "clear-able" filter
  const hasFilters = activePlatform !== 'all'
    || activeGenres.size > 0
    || excludedGenres.size > 0
    || activeVotes > 0
    || activeOngoingFilter !== 'all'
    || (activeType === 'trending' && trendingContentType !== 'all');
  if (cfBtn) cfBtn.style.display = hasFilters ? '' : 'none';
}

function clearSearch() {
  document.getElementById('searchBox').value = '';
  applyFilters(true);
}

// Compute top genres client-side from allTitles + libraryMap.
// Guarantees the chip count matches the library genre filter exactly.
function computeTopGenres(n) {
  const freq = {};
  for (const t of allTitles) {
    const entry = getEntry(t);
    const inLib = entry.is_fav || entry.status === 'watchlist' || entry.status === 'watching' || entry.status === 'finished';
    if (!inLib) continue;
    const genre = t.genre || '';
    if (!genre || genre === 'Unknown') continue;
    for (const g of genre.split(',')) {
      const gn = g.trim();
      if (gn) freq[gn] = (freq[gn] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n || 6)
    .map(([genre, count]) => ({ genre, count }));
}
window.computeTopGenres = computeTopGenres;

// ── Mobile card status menu ──────────────────────────────────────────────────
function openCardMenu(tk, btn) {
  const existing = document.getElementById('cardMenuPopup');
  if (existing) { existing.remove(); return; }
  const t = cardDataStore[tk];
  if (!t) return;
  const status = getEntry(t).status || 'not-started';
  const items = [
    { label: '🔖 Watchlist', s: 'watchlist' },
    { label: '▶️ Watching',  s: 'watching'  },
    { label: '✅ Finished',  s: 'finished'  },
  ];
  const popup = document.createElement('div');
  popup.id = 'cardMenuPopup';
  popup.className = 'card-menu-popup';
  const tkEsc = tk.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  popup.innerHTML = items.map(item => `
    <button class="card-menu-item${status === item.s ? ' active' : ''}" onclick="event.stopPropagation();setCardStatus('${tkEsc}','${item.s}')">${item.label}</button>
  `).join('') + (status !== 'not-started'
    ? `<button class="card-menu-item remove" onclick="event.stopPropagation();setCardStatus('${tkEsc}','not-started')">🗑️ Remove</button>`
    : '');
  const rect = btn.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.zIndex   = '3000';
  popup.style.top      = (rect.bottom + 6) + 'px';
  if (rect.left + rect.width / 2 < window.innerWidth / 2) {
    popup.style.left  = Math.max(6, rect.left) + 'px';
    popup.style.right = 'auto';
  } else {
    popup.style.right = Math.max(6, window.innerWidth - rect.right) + 'px';
    popup.style.left  = 'auto';
  }
  document.body.appendChild(popup);
  setTimeout(() => { document.addEventListener('click', closeCardMenu, { once: true }); }, 0);
}
function closeCardMenu() { document.getElementById('cardMenuPopup')?.remove(); }
function setCardStatus(tk, status) {
  const t = cardDataStore[tk];
  if (!t) return;
  const cur = getEntry(t).status || 'not-started';
  setStatus(t, cur === status ? 'not-started' : status);
  closeCardMenu();
}
window.openCardMenu  = openCardMenu;
window.closeCardMenu = closeCardMenu;
window.setCardStatus = setCardStatus;

function clearAllFilters() {
  // Reset search box
  const sb = document.getElementById('searchBox');
  if (sb) sb.value = '';
  document.getElementById('searchClearBtn')?.style && (document.getElementById('searchClearBtn').style.display = 'none');
  // Reset sort to default
  if (typeof setSortFilter === 'function') setSortFilter('rank', 'By Rank');
  // Reset status sub-filter
  if (activeStatusFilter !== 'all') setStatusFilter('all', null);
  // Reset platform
  activePlatform = 'all';
  document.querySelectorAll('#platformFilter .pill').forEach((p, i) => p.classList.toggle('active', i === 0));
  // Region is never reset to 'all' — country is always required
  // Reset trending content-type pill
  if (activeType === 'trending' && trendingContentType !== 'all') {
    trendingContentType = 'all';
    _syncTrendingTypeBtns();
    // Reload from server then return — clearGenres/clearExcluded called above will
    // have already cleared client-side state; votes reset too
    setVotesFilter(0, 'Any votes');
    if (typeof clearGenres   === 'function') clearGenres();
    if (typeof clearExcluded === 'function') clearExcluded();
    loadTitles();
    return;
  }
  // Reset votes
  activeContentTypeFilter = null;
  setVotesFilter(0, 'Any votes');
  if (typeof clearGenres   === 'function') clearGenres();
  if (typeof clearExcluded === 'function') clearExcluded();
  if (activeOngoingFilter !== 'all') { activeOngoingFilter = 'all'; _syncOngoingFilterBtns(); }
  applyFilters(true);
  _updateFilterToggleBtn();
}

// ── Render ────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 100;
let currentPage = 1;
let filteredTitles = [];

function renderGrid(titles) {
  filteredTitles = titles;
  currentPage = 1;
  renderPage();
}

function renderPage() {
  const wrap = document.getElementById('gridWrap');
  const pgEl = document.getElementById('pagination');
  if (!filteredTitles.length) {
    if (_appLoading) {
      wrap.innerHTML = `<div class="empty"><div class="empty-icon" style="font-size:0"><span class="spinner" style="width:36px;height:36px;border-width:3px;margin:0"></span></div><div class="empty-title" style="margin-top:20px">Loading titles…</div></div>`;
      pgEl.style.display = 'none';
      return;
    }
    if (!allTitles.length) {
      const gridEmptySub = _isAdmin
        ? 'Run the scraper using the sidebar or import your existing JSON files.'
        : 'The library is being updated — check back soon.';
      wrap.innerHTML = `<div class="empty"><div class="empty-icon">📡</div><div class="empty-title">Nothing here yet</div><div class="empty-sub">${gridEmptySub}</div></div>`;
      pgEl.style.display = 'none';
      return;
    }
    wrap.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">No results</div><div class="empty-sub">Try adjusting your filters.</div></div>`;
    pgEl.style.display = 'none';
    return;
  }
  const totalPages = Math.ceil(filteredTitles.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const page  = filteredTitles.slice(start, start + PAGE_SIZE);

  // Flat grid — no platform sections
  const frag = document.createDocumentFragment();
  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.innerHTML = page.map((t, i) => renderCard(t, i)).join('');
  frag.appendChild(grid);

  wrap.innerHTML = '';
  wrap.appendChild(frag);
  page.forEach(t => loadCardPoster(t));
  wrap.parentElement.scrollTop = 0;

  if (totalPages <= 1) { pgEl.style.display = 'none'; return; }
  pgEl.style.display = 'flex';
  const buttons = [];
  const addBtn = (label, p, isActive=false, disabled=false) =>
    buttons.push(`<button class="pg-btn${isActive?' active':''}" ${disabled?'disabled':''} onclick="goToPage(${p})">${label}</button>`);
  const addDots = () => buttons.push(`<span class="pg-ellipsis">…</span>`);
  addBtn('‹', currentPage-1, false, currentPage===1);
  if (totalPages <= 7) {
    for (let i=1; i<=totalPages; i++) addBtn(i, i, i===currentPage);
  } else {
    addBtn(1, 1, currentPage===1);
    if (currentPage > 3) addDots();
    for (let i=Math.max(2,currentPage-1); i<=Math.min(totalPages-1,currentPage+1); i++) addBtn(i, i, i===currentPage);
    if (currentPage < totalPages-2) addDots();
    addBtn(totalPages, totalPages, currentPage===totalPages);
  }
  addBtn('›', currentPage+1, false, currentPage===totalPages);
  buttons.push(`<span class="pg-info">${start+1}–${Math.min(start+PAGE_SIZE,filteredTitles.length)} of ${filteredTitles.length.toLocaleString()}</span>`);
  pgEl.innerHTML = buttons.join('');
}

function goToPage(page) {
  const total = Math.ceil(filteredTitles.length / PAGE_SIZE);
  if (page < 1 || page > total) return;
  currentPage = page;
  renderPage();
  // Scroll to top of page on mobile and desktop
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderCard(t, i) {
  const entry  = getEntry(t);
  const isFav  = entry.is_fav;
  const status = entry.status || 'not-started';
  const delay  = Math.min(i*0.02, 0.4);
  const tk     = titleKey(t);   // used for data-tk, DOM sync, libraryMap
  const ck     = cardKey(t);    // used for cardDataStore lookups & openModal
  const tkAttr = escAttr(tk);

  // Rank badge only shown on Trending tab (inside hover overlay)
  const rankHtml = activeType === 'trending' && t.ranking_position > 0
    ? `<div class="rank-badge">#${t.ranking_position}${t.ranking_region ? ` <span class="rank-region">${t.ranking_region}</span>` : ''}</div>`
    : '';
  // Always-visible watch-time rank badge (set by _renderWhList, never mutates allTitles)
  const whRankHtml = t._wh_rank != null
    ? `<div class="wh-rank-badge${t._wh_rank <= 3 ? ' top3' : ''}">#${t._wh_rank}</div>`
    : '';

  const statusHtml = status==='watching'
    ? `<div class="status-indicator watching"><span class="s-dot"></span>Watching</div>`
    : status==='finished'
    ? `<div class="status-indicator finished"><span class="s-dot"></span>Finished</div>` : '';

  const imdb = t.imdb_score ? `<div class="score-block"><div class="score-label">${_imdbStarSvg(11)} IMDb</div><div class="score-value imdb">${t.imdb_score.toFixed(1)}</div><div class="score-votes">${fmtVotes(t.imdb_votes)}</div></div>` : '';
  const rt   = t.tomatometer ? `<div class="score-block"><div class="score-label">${_rtTomatoSvg(11)} RT</div><div class="score-value rt">${t.tomatometer}%</div></div>` : '';
  const genres = (t.genre&&t.genre!=='Unknown') ? t.genre.split(',').slice(0,2).map(g=>`<span class="genre-chip">${genreEmoji(formatGenre(g))} ${formatGenre(g)}</span>`).join('') : '';

  // Platform badges — show when platform filter is 'all' (otherwise obvious)
  let platformBadgesHtml = '';
  if (activePlatform === 'all') {
    const plist = (t.platforms || t.platform || '').split(',').map(p => p.trim()).filter(Boolean);
    platformBadgesHtml = plist.length
      ? `<div class="platform-badges">${plist.slice(0,3).map(p => `<span class="platform-badge ${p}" title="${formatPlatform(p)}">${platLogo(p)}</span>`).join('')}${plist.length>3?`<span class="platform-badge plat-overflow">+${plist.length-3}</span>`:''}</div>`
      : '';
  }

  return `
    <div class="card" style="animation-delay:${delay}s" data-tk="${tkAttr}" onclick="if(!event.target.closest('button'))openModal('${jsEsc(ck)}')" ontouchstart="if(!event.target.closest('button'))this.classList.add('card-tapped')" ontouchend="this.classList.remove('card-tapped')" ontouchcancel="this.classList.remove('card-tapped')" >
      <div class="card-poster" id="poster-${CSS.escape(tk)}">
        <div class="card-poster-placeholder"><div class="ph-icon">${t.content_type==='movie'?'🎬':'📺'}</div><div class="ph-title">${escHtml(t.title)}</div></div>
        ${whRankHtml}
        <div class="card-poster-overlay">
          <div class="poster-top">${rankHtml}</div>
          <div class="poster-bottom">${statusHtml}<div></div></div>
        </div>
        <div class="card-actions" data-active="${isFav && status==='watchlist' ? 'both' : isFav ? 'fav' : status==='watchlist' ? 'wl' : 'none'}">
          <button class="action-btn fav-btn${isFav?' active':''}" title="Favourite" onclick="event.stopPropagation();toggleFav('${jsEsc(ck)}',this)">${isFav?'♥':'♡'}</button>
          <button class="action-btn wl-btn${status==='watchlist'?' active':''}" title="Add to Watchlist" onclick="event.stopPropagation();toggleWatchlist('${jsEsc(ck)}',this)">🔖</button>
        </div>
        <button class="action-btn menu-btn" title="Set status" onclick="event.stopPropagation();openCardMenu('${jsEsc(ck)}',this)">⋮</button>
      </div>
      ${status!=='not-started'?`<div class="card-status-bar ${status}"></div>`:''}
      <div class="card-body">
        <div class="card-title">${escHtml(t.title)}</div>
        <div class="card-sub">
          <span class="type-tag ${t.content_type}">${t.content_type==='movie'?'🎬 MOVIE':t.content_type==='tv'?'📺 TV':t.content_type||'?'}</span>
          <span class="year-text" id="yeartext-${CSS.escape(tk)}">${_tvYearDisplay(t)}</span>
        </div>
        ${t.content_type==='tv'&&(t.num_seasons>0||t.is_ongoing!=null)?`<div class="card-seasons">${[t.num_seasons>0?`${t.num_seasons} season${t.num_seasons!==1?'s':''}`:null,t.is_ongoing!=null?`<span class="ongoing-tag ${t.is_ongoing?'ongoing':'ended'}">${t.is_ongoing?'Ongoing':'Ended'}</span>`:null].filter(Boolean).join(' ')}</div>`:t.content_type==='movie'&&t.runtime_mins>0?`<div class="card-seasons">${t.runtime_mins} min</div>`:''}
        ${(imdb||rt||t.maturity_rating)?`<div class="card-scores">${imdb}${rt}${t.maturity_rating?`<span class="rating-tag">${t.maturity_rating}</span>`:''}</div>`:''}
        ${genres?`<div class="genres">${genres}</div>`:''}
        ${platformBadgesHtml}
      </div>
    </div>`;
}

async function loadCardPoster(t) {
  const tk      = titleKey(t);
  const wrapper = document.getElementById(`poster-${CSS.escape(tk)}`);
  if (!wrapper) return;
  const imgs = await fetchPosterUrl(t.title, t.release_year, t.content_type);
  if (!imgs) return;
  const placeholder = wrapper.querySelector('.card-poster-placeholder');
  const img = document.createElement('img');
  img.src = imgs.poster; img.alt = t.title;
  img.onload  = () => { if (placeholder) placeholder.remove(); };
  img.onerror = () => img.remove();
  wrapper.insertBefore(img, wrapper.querySelector('.card-poster-overlay'));
}

// ── Episode detail overlay ───────────────────────────────────────────────────
function openEpisodeDetail(epKey) {
  const stored = _upcomingEpStore[epKey];
  if (!stored) return;
  const {ep, t, sd} = stored;

  const overlay   = document.getElementById('epDetailOverlay');
  const stillHero = document.getElementById('epStillHero');
  const bodyEl    = document.getElementById('epDetailBody');
  const crumbEl   = document.getElementById('epDetailCrumb');

  const tk        = t ? titleKey(t) : ep.title_key;
  const showTitle = t ? t.title    : ep.title_key;
  const sNum      = String(ep.season_number).padStart(2,'0');
  const eNum      = String(ep.episode_number).padStart(2,'0');
  const sLabel    = `S${sNum} · E${eNum}`;

  // Hero still image
  const stillUrl = ep.still_path ? `https://image.tmdb.org/t/p/w780${ep.still_path}` : null;
  stillHero.className = 'ep-still-hero';
  if (stillUrl) {
    stillHero.style.backgroundImage = `url(${stillUrl})`;
    stillHero.classList.add('has-img');
  } else if (sd.poster_thumb) {
    stillHero.style.backgroundImage = `url(${sd.poster_thumb})`;
    stillHero.classList.add('has-img', 'is-poster');
  } else {
    stillHero.style.backgroundImage = '';
  }

  // Air date
  const MONTH = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const airDate  = new Date(ep.air_date + 'T12:00:00');
  const dateStr  = `${DAY[airDate.getDay()]}, ${MONTH[airDate.getMonth()]} ${airDate.getDate()}, ${airDate.getFullYear()}`;
  const diffDays = ep.diff_days;
  const diffLabel = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `In ${diffDays} days`;
  const diffCls   = diffDays === 0 ? 'ep-badge-today' : diffDays === 1 ? 'ep-badge-tomorrow' : 'ep-badge-future';

  crumbEl.textContent = `${showTitle} — ${sLabel}`;

  let html = `
    <div class="ep-detail-top">
      <button class="ep-detail-show-pill" onclick="closeEpisodeDetail();openModal('${jsEsc(tk)}')">${escHtml(showTitle)} ›</button>
      <div class="ep-detail-se-badge">${sLabel}</div>
    </div>
    ${ep.name ? `<div class="ep-detail-title">${escHtml(ep.name)}</div>` : ''}
    <div class="ep-detail-meta">
      <span class="ep-meta-date">📅 ${dateStr}</span>
      <span class="ep-countdown ${diffCls}">${diffLabel}</span>
      ${ep.runtime ? `<span class="ep-meta-item">⏱ ${ep.runtime} min</span>` : ''}
      ${ep.vote_average ? `<span class="ep-meta-item">⭐ ${parseFloat(ep.vote_average).toFixed(1)} <span class="ep-meta-votes">(${(ep.vote_count||0).toLocaleString()} ratings)</span></span>` : ''}
    </div>
    ${ep.overview
      ? `<div class="ep-detail-overview">${escHtml(ep.overview)}</div>`
      : sd.show_overview
        ? `<div class="ep-detail-overview ep-overview-fallback">${escHtml(sd.show_overview)}<span class="ep-overview-note"> — episode details not yet available</span></div>`
        : `<div class="ep-detail-no-data">Episode details are not yet available for this upcoming episode.</div>`
    }
  `;

  if (ep.crew && ep.crew.length) {
    html += `
    <div class="ep-detail-section">
      <div class="ep-detail-section-title">Episode Crew</div>
      <div class="ep-crew-list">
        ${ep.crew.map(cm => `
          <div class="ep-crew-item">
            <div class="ep-crew-name">${escHtml(cm.name)}</div>
            <div class="ep-crew-role">${escHtml(cm.job)}</div>
          </div>`).join('')}
      </div>
    </div>`;
  }

  const showCast = sd && sd.cast && sd.cast.length ? sd.cast : [];
  if (showCast.length) {
    html += `
    <div class="ep-detail-section">
      <div class="ep-detail-section-title">Top Cast</div>
      <div class="ep-guest-grid">
        ${showCast.map(m => {
          const img = m.profile_path
            ? `<img src="https://image.tmdb.org/t/p/w185${m.profile_path}" alt="${escHtml(m.name)}" loading="lazy">`
            : `<div class="ep-guest-ph">🎭</div>`;
          return `
          <div class="ep-guest-item">
            <div class="ep-guest-photo">${img}</div>
            <div class="ep-guest-name">${escHtml(m.name)}</div>
            ${m.character ? `<div class="ep-guest-char">${escHtml(m.character)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  if (ep.guest_stars && ep.guest_stars.length) {
    html += `
    <div class="ep-detail-section">
      <div class="ep-detail-section-title">Guest Stars</div>
      <div class="ep-guest-grid">
        ${ep.guest_stars.map(g => {
          const img = g.profile_path
            ? `<img src="https://image.tmdb.org/t/p/w185${g.profile_path}" alt="${escHtml(g.name)}" loading="lazy">`
            : `<div class="ep-guest-ph">🎭</div>`;
          return `
          <div class="ep-guest-item">
            <div class="ep-guest-photo">${img}</div>
            <div class="ep-guest-name">${escHtml(g.name)}</div>
            ${g.character ? `<div class="ep-guest-char">${escHtml(g.character)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  html += `
    <div class="ep-detail-show-btn-wrap">
      <button class="ep-detail-show-btn" onclick="closeEpisodeDetail();openModal('${jsEsc(tk)}')">View all of ${escHtml(showTitle)} →</button>
      <button class="ep-detail-refresh-btn" onclick="closeEpisodeDetail();_refreshUpcoming()" title="Reload episode data from TMDB">↺ Refresh data</button>
    </div>`;

  bodyEl.innerHTML = html;
  if (!_handlingPop) history.pushState({ epDetail: epKey }, '');
  overlay.classList.add('open');
  document.getElementById('epDetailScroll').scrollTop = 0;
}

function closeEpisodeDetail() {
  document.getElementById('epDetailOverlay').classList.remove('open');
}

// ── Navigation drawer (mobile) ────────────────────────────────────────────────
function toggleNavDrawer() {
  const drawer = document.getElementById('navDrawer');
  const bg     = document.getElementById('navDrawerOverlay');
  const open   = drawer.classList.toggle('open');
  bg.classList.toggle('open', open);
  document.body.classList.toggle('nav-drawer-open', open);
  const moreBtn = document.querySelector('.bottom-nav-btn[data-bnav="more"]');
  if (moreBtn) moreBtn.classList.toggle('panel-open', open);
}

function closeNavDrawer() {
  const drawer = document.getElementById('navDrawer');
  const bg     = document.getElementById('navDrawerOverlay');
  drawer.style.transform = ''; // clear any mid-swipe transform
  drawer.style.transition = '';
  drawer.classList.remove('open');
  bg.classList.remove('open');
  document.body.classList.remove('nav-drawer-open');
  const moreBtn = document.querySelector('.bottom-nav-btn[data-bnav="more"]');
  if (moreBtn) moreBtn.classList.remove('panel-open');
}

// ── Swipe-down-to-close for bottom-sheet nav drawer ───────────────────────────
(function () {
  let startY = 0, startScrollTop = 0, dragging = false;
  const getDrawer = () => document.getElementById('navDrawer');
  const getBg     = () => document.getElementById('navDrawerOverlay');

  document.addEventListener('touchstart', e => {
    const drawer = getDrawer();
    if (!drawer || !drawer.classList.contains('open')) return;
    if (!drawer.contains(e.target)) return;
    const body = drawer.querySelector('.nav-drawer-body');
    startScrollTop = body ? body.scrollTop : 0;
    startY = e.touches[0].clientY;
    dragging = false;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    const drawer = getDrawer();
    if (!drawer || !drawer.classList.contains('open')) return;
    if (!drawer.contains(e.target)) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) return; // swiping up — not our gesture
    // Only hijack if body is scrolled to top (or touch started on handle)
    const body = drawer.querySelector('.nav-drawer-body');
    const onHandle = e.target.closest('.nav-drawer-handle, .nav-drawer-header');
    if (!onHandle && startScrollTop > 0) return;
    if (!onHandle && body && body.scrollTop > 0) return;
    dragging = true;
    drawer.style.transition = 'none';
    drawer.style.transform = `translateY(${dy}px)`;
    getBg().style.opacity = Math.max(0, 1 - dy / 300);
  }, { passive: true });

  document.addEventListener('touchend', e => {
    const drawer = getDrawer();
    if (!drawer || !dragging) return;
    dragging = false;
    const dy = e.changedTouches[0].clientY - startY;
    drawer.style.transition = '';
    drawer.style.transform = '';
    if (dy > 80) {
      closeNavDrawer();
      getBg().style.opacity = '';
    } else {
      getBg().style.opacity = '';
    }
  }, { passive: true });
}());

// ── User avatar dropdown ───────────────────────────────────────────────────────
function toggleUserMenu() {
  const dropdown = document.getElementById('userMenuDropdown');
  const btn = document.getElementById('userAvatarBtn');
  const isOpen = dropdown.classList.toggle('open');
  if (btn) btn.classList.toggle('menu-open', isOpen);
}
function closeUserMenu() {
  document.getElementById('userMenuDropdown')?.classList.remove('open');
  document.getElementById('userAvatarBtn')?.classList.remove('menu-open');
}
// Close when clicking outside the menu
document.addEventListener('click', e => {
  const wrap = document.getElementById('userMenuWrap');
  if (wrap && !wrap.contains(e.target)) closeUserMenu();
});
// Close any open genre-dropdown menus when clicking outside them
document.addEventListener('click', e => {
  if (!e.target.closest('.genre-dropdown')) {
    document.querySelectorAll('.genre-dropdown-menu.open').forEach(m => m.classList.remove('open'));
  }
});

// ── Scroll-to-top button (mobile only) ──────────────────────────────────
// On mobile, .main has overflow:visible so the window itself scrolls.
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('scrollTopBtn');
  if (!btn) return;
  let lastY       = window.pageYOffset;
  let upTravel    = 0;          // accumulated upward px since last direction flip
  const UP_THRESHOLD = 40;      // must scroll up this many px before button appears

  function hideScrollBtn() {
    upTravel = 0;
    btn.classList.remove('visible');
  }

  window.addEventListener('scroll', () => {
    const y    = window.pageYOffset;
    const diff = y - lastY;
    lastY      = y;

    if (y <= 0) { hideScrollBtn(); return; }

    if (diff < 0) {               // scrolling up
      upTravel += -diff;
      if (upTravel >= UP_THRESHOLD) btn.classList.add('visible');
    } else if (diff > 0) {        // scrolling down — hide immediately
      hideScrollBtn();
    }
  }, { passive: true });

  // Hide the button whenever any overlay/modal opens
  const overlayIds = ['overlay','actorOverlay','watchHistoryOverlay','profileOverlay',
    'friendLibraryOverlay','friendProfileOverlay','friendsOverlay',
    'peopleAllOverlay','filmographyAllOverlay','epDetailOverlay'];
  const observer = new MutationObserver(() => {
    const anyOpen = overlayIds.some(id => document.getElementById(id)?.classList.contains('open'));
    if (anyOpen) hideScrollBtn();
  });
  overlayIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributeFilter: ['class'] });
  });
});

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Filter bottom sheet (mobile) ─────────────────────────────────────────────
// On mobile, the Filters button opens a bottom-sheet overlay instead of the
// inline toolbar. #toolbarFilters is "teleported" into the sheet body so that
// all existing filter JS (toggleGenre, setVotesFilter, etc.) keeps working
// with the same element IDs — no duplication required.

window.openFilterSheet = function () {
  const sheet    = document.getElementById('filterSheet');
  const backdrop = document.getElementById('filterSheetBackdrop');
  const body     = document.getElementById('filterSheetBody');
  const filters  = document.getElementById('toolbarFilters');
  if (!sheet || !filters) return;
  // Teleport filter panel into sheet and make it visible
  filters.classList.remove('filters-hidden');
  body.appendChild(filters);
  backdrop.classList.add('open');
  sheet.classList.add('open');
  // Close any open dropdown menus that may have been left open
  document.querySelectorAll('.genre-dropdown-menu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.sort-select.dropdown-open').forEach(b => b.classList.remove('dropdown-open'));
};

window.closeFilterSheet = function () {
  const sheet    = document.getElementById('filterSheet');
  const backdrop = document.getElementById('filterSheetBackdrop');
  const toolbar  = document.getElementById('subToolbar');
  const filters  = document.getElementById('toolbarFilters');
  if (!sheet || !filters) return;
  // Close any open dropdown menus before teleporting back
  document.querySelectorAll('.genre-dropdown-menu.open').forEach(m => m.classList.remove('open'));
  document.querySelectorAll('.sort-select.dropdown-open').forEach(b => b.classList.remove('dropdown-open'));
  // Teleport filter panel back to toolbar (hidden)
  toolbar.appendChild(filters);
  filters.classList.add('filters-hidden');
  backdrop.classList.remove('open');
  sheet.classList.remove('open');
};

window.applyFilterSheet = function () {
  applyFilters(true);
  window.closeFilterSheet();
};

// ── Filter sheet drag-to-dismiss ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const sheet  = document.getElementById('filterSheet');
  const handle = sheet?.querySelector('.filter-sheet-handle');
  const header = sheet?.querySelector('.filter-sheet-header');
  if (!sheet || !handle) return;

  let startY = 0, currentY = 0, startTime = 0, dragging = false;

  function onStart(e) {
    if (!sheet.classList.contains('open')) return;
    startY    = e.touches[0].clientY;
    currentY  = startY;
    startTime = Date.now();
    dragging  = true;
    sheet.style.transition = 'none';
  }

  function onMove(e) {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    if (dy < 0) return; // don't allow dragging up past natural position
    currentY = e.touches[0].clientY;
    sheet.style.transform = `translateY(${dy}px)`;
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';

    const dy       = currentY - startY;
    const elapsed  = Date.now() - startTime;
    const velocity = dy / Math.max(elapsed, 1); // px/ms
    const threshold = sheet.offsetHeight * 0.35;

    if (dy > threshold || velocity > 0.5) {
      sheet.style.transform = '';
      window.closeFilterSheet();
    } else {
      sheet.style.transform = ''; // snap back — CSS transition handles it
    }
  }

  // Attach to both the handle pill and the header bar
  [handle, header].forEach(el => {
    el.addEventListener('touchstart', onStart, { passive: true });
  });
  document.addEventListener('touchmove', onMove,  { passive: true });
  document.addEventListener('touchend',  onEnd,   { passive: true });
});

function _updateFilterToggleBtn() {
  const btn = document.getElementById('filterToggleBtn');
  if (!btn) return;
  const hasAny = activePlatform !== 'all'
    || activeGenres.size > 0
    || excludedGenres.size > 0
    || activeVotes > 0;
  btn.classList.toggle('filters-active', hasAny);
}


// ── Centralized body-scroll lock ─────────────────────────────────────────────
// Prevents the background page from scrolling whenever any overlay is open.
// Handles all overlays in one place, including dynamically-created ones.
document.addEventListener('DOMContentLoaded', () => {
  const OVERLAY_IDS = [
    'overlay', 'actorOverlay', 'watchHistoryOverlay', 'profileOverlay',
    'friendLibraryOverlay', 'friendProfileOverlay', 'friendsOverlay',
    'peopleAllOverlay', 'epDetailOverlay', 'filterSheet',
    'forYouDetailOverlay', 'discoverDetailOverlay',
  ];

  function syncBodyScroll() {
    const anyOpen = OVERLAY_IDS.some(id => document.getElementById(id)?.classList.contains('open'))
      || document.getElementById('filmographyAllOverlay')?.classList.contains('open');
    document.body.style.overflow = anyOpen ? 'hidden' : '';
  }

  const observer = new MutationObserver(syncBodyScroll);
  OVERLAY_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributeFilter: ['class'] });
  });

  // filmographyAllOverlay is appended dynamically — watch for it
  new MutationObserver(() => {
    const filmOv = document.getElementById('filmographyAllOverlay');
    if (filmOv && !filmOv._scrollLockObserved) {
      filmOv._scrollLockObserved = true;
      observer.observe(filmOv, { attributeFilter: ['class'] });
    }
  }).observe(document.body, { childList: true });
});

// Sub-bar scroll fade: remove right-edge gradient when user reaches the end
document.addEventListener('DOMContentLoaded', () => {
  ['statusSubBar', 'librarySubBar'].forEach(id => {
    const bar = document.getElementById(id);
    if (!bar) return;
    function updateFade() {
      const atEnd = bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 2;
      bar.classList.toggle('sub-bar-end', atEnd);
    }
    bar.addEventListener('scroll', updateFade, { passive: true });
    // Also re-check whenever tabs change (view switches may resize the bar)
    new MutationObserver(updateFade).observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    updateFade();
  });
});

// Sync the header avatar circle: show photo if available, else show initial
async function loadHeaderAvatar() {
  const data = await api('GET', '/api/profile', null, {loader: false}).catch(() => null);
  if (!data) return;
  _applyHeaderAvatar(data.profile_pic || null);
}
function _applyHeaderAvatar(picUrl) {
  const img     = document.getElementById('headerAvatarImg');
  const initial = document.getElementById('headerAvatarInitial');
  if (!img || !initial) return;
  if (picUrl) {
    img.src = picUrl; img.style.display = 'block'; initial.style.display = 'none';
  } else {
    img.style.display = 'none'; initial.style.display = '';
  }
}

// ── Actor-enriched catalog search ────────────────────────────────────────────
// When user searches by a person name, we find their filmography and highlight
// matching titles in the database. No person chips shown — results are titles only.
let _peopleSearchTimer = null;
let _lastPeopleQuery   = '';
let _actorEnrichedTitleKeys = new Set(); // titleKeys currently added via person search
let _actorEnrichedLabel     = '';        // label shown in the strip

function _searchPeopleForCatalog(q) {
  clearTimeout(_peopleSearchTimer);
  _peopleSearchTimer = setTimeout(async () => {
    const strip = document.getElementById('catalogPeopleStrip');
    if (!strip) return;
    if (q === _lastPeopleQuery) return;
    _lastPeopleQuery = q;

    // Search for the person
    const data = await api('GET', `/api/tmdb/search?${new URLSearchParams({ query: q, type: 'person' })}`, null, {loader: false}).catch(() => null);
    const people = (data?.results || []);
    if (!people.length) {
      _actorEnrichedTitleKeys.clear();
      strip.style.display = 'none';
      return;
    }

    const person = people[0]; // top TMDB result
    // Fetch their combined credits
    const credits = await api('GET', `/api/tmdb/person/${person.id}/combined_credits`, null, {loader: false}).catch(() => null);
    if (!credits) { strip.style.display = 'none'; return; }

    // Build a set of lowercase title names from their credits
    const creditTitles = new Set([...(credits.cast || []), ...(credits.crew || [])].map(c => (c.title || c.name || '').toLowerCase().trim()).filter(Boolean));

    // Find titles in allTitles that match any of those credits
    const matched = allTitles.filter(t => creditTitles.has(t.title.toLowerCase().trim()));

    if (!matched.length) {
      _actorEnrichedTitleKeys.clear();
      strip.style.display = 'none';
      return;
    }

    // Store enriched title keys and re-apply filters so they show in the grid
    _actorEnrichedTitleKeys = new Set(matched.map(t => titleKey(t)));
    _actorEnrichedLabel     = person.name;

    // Show label strip
    strip.innerHTML = `<div class="catalog-people-label">Titles featuring <strong>${escHtml(person.name)}</strong></div>`;
    strip.style.display = '';

    // Re-apply filters to include the enriched titles
    applyFilters(true);
  }, 500);
}

// ── Back-button / History API ─────────────────────────────────────────────────
// Push a state on every view/modal change so the hardware back button on mobile
// (or browser back) navigates within the app instead of closing it.
window.addEventListener('popstate', e => {
  _handlingPop = true;
  try {
    const epDetailOverlay       = document.getElementById('epDetailOverlay');
    const forYouDetailOverlay   = document.getElementById('forYouDetailOverlay');
    const discoverDetailOverlay = document.getElementById('discoverDetailOverlay');
    const friendLibraryOverlay  = document.getElementById('friendLibraryOverlay');
    const friendProfileOverlay  = document.getElementById('friendProfileOverlay');
    const filmographyAllOverlay = document.getElementById('filmographyAllOverlay');
    const actorOverlay          = document.getElementById('actorOverlay');
    const overlay               = document.getElementById('overlay');
    const peopleAllOverlay      = document.getElementById('peopleAllOverlay');
    const profileOverlay        = document.getElementById('profileOverlay');
    const friendsOverlay        = document.getElementById('friendsOverlay');
    const watchHistoryOverlay   = document.getElementById('watchHistoryOverlay');
    if (epDetailOverlay && epDetailOverlay.classList.contains('open')) {
      closeEpisodeDetail();
    } else if (overlay && overlay.classList.contains('open')) {
      closeModalDirect();
    } else if (forYouDetailOverlay && forYouDetailOverlay.classList.contains('open')) {
      closeForYouSection();
    } else if (discoverDetailOverlay && discoverDetailOverlay.classList.contains('open')) {
      closeDiscoverSection();
    } else if (friendLibraryOverlay && friendLibraryOverlay.classList.contains('open')) {
      closeFriendLibrary();
    } else if (friendProfileOverlay && friendProfileOverlay.classList.contains('open')) {
      closeFriendProfile();
    } else if (filmographyAllOverlay && filmographyAllOverlay.classList.contains('open')) {
      closeFilmographyAllOverlay();
    } else if (actorOverlay && actorOverlay.classList.contains('open')) {
      closeActorModalDirect();
    } else if (peopleAllOverlay && peopleAllOverlay.classList.contains('open')) {
      closePeopleAll();
    } else if (watchHistoryOverlay && watchHistoryOverlay.classList.contains('open')) {
      closeWatchHistory();
    } else if (profileOverlay && profileOverlay.classList.contains('open')) {
      closeProfile();
    } else if (friendsOverlay && !friendsOverlay.classList.contains('hidden')) {
      closeFriends();
    } else if (e.state?.view) {
      const tab = document.querySelector(`.nav-tab[data-view="${e.state.view}"]`);
      setView(e.state.view, tab || null);
    }
  } finally {
    _handlingPop = false;
  }
});