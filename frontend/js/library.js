// ── Favourites & status ───────────────────────────────────────────────────────
function _syncCardActions(tk) {
  const card = document.querySelector(`[data-tk="${CSS.escape(tk)}"]`);
  if (!card) return;
  const acts = card.querySelector('.card-actions');
  if (!acts) return;
  const entry = libraryMap[tk] || {};
  const isFav = !!entry.is_fav;
  const isWl  = entry.status === 'watchlist';
  acts.dataset.active = isFav && isWl ? 'both' : isFav ? 'fav' : isWl ? 'wl' : 'none';
}

// Synchronize all UI elements for a given title across the app (cards, dots, modal buttons)
function syncUIForTitle(t) {
  const tk = typeof t === 'string' ? t : titleKey(t);
  const entry = libraryMap[tk] || {};
  // Update card-level fav / wl buttons and dots
  document.querySelectorAll(`[data-tk="${CSS.escape(tk)}"]`).forEach(card => {
    const favBtn = card.querySelector('.fav-btn');
    if (favBtn) {
      favBtn.textContent = entry.is_fav ? '♥' : '♡';
      favBtn.classList.toggle('active', !!entry.is_fav);
    }
    const wlBtn = card.querySelector('.wl-btn');
    if (wlBtn) wlBtn.classList.toggle('active', entry.status === 'watchlist');
    const favDot = card.querySelector('.card-fav-dot, #favdot-' + CSS.escape(tk));
    if (favDot) favDot.classList.toggle('visible', !!entry.is_fav);
    const wlDot = card.querySelector('.card-wl-dot, #wldot-' + CSS.escape(tk));
    if (wlDot) wlDot.classList.toggle('visible', entry.status === 'watchlist');
    // Sync status bar / poster bottom
    const cardStatusBar = card.querySelector('.card-status-bar');
    if (cardStatusBar) cardStatusBar.remove();
    if (entry.status && entry.status !== 'not-started') {
      const bar = document.createElement('div');
      bar.className = `card-status-bar ${entry.status}`;
      card.insertBefore(bar, card.querySelector('.card-body'));
    }
    const pb = card.querySelector('.poster-bottom');
    if (pb) {
      pb.innerHTML = entry.status === 'watching'
        ? `<div class="status-indicator watching"><span class="s-dot"></span>Watching</div><div></div>`
        : entry.status === 'finished'
        ? `<div class="status-indicator finished"><span class="s-dot"></span>Finished</div><div></div>`
        : entry.status === 'watchlist'
        ? `<div class="status-indicator watchlist"><span class="s-dot"></span>Watchlist</div><div></div>`
        : `<div></div><div></div>`;
    }
  });

  // Update modal buttons if modal open for this title
  if (currentModalTitle && titleKey(currentModalTitle) === tk) {
    updateModalFavBtn(!!entry.is_fav);
    updateModalStatusBtns(entry.status || 'not-started');
  }

  // Update card-actions dataset for any matching cards
  _syncCardActions(tk);
}

// Expose for other modules
window.syncUIForTitle = syncUIForTitle;

async function toggleFav(cardIdOrObj, btn) {
  const t = typeof cardIdOrObj==='string' ? cardDataStore[cardIdOrObj] : cardIdOrObj;
  if (!t) return;
  const current = getEntry(t).is_fav;
  await syncLibrary(t, {is_fav: !current}, {loader:true});

  if (btn) { btn.textContent=!current?'♥':'♡'; btn.classList.toggle('active',!current); }
  const tk  = titleKey(t);
  const dot = document.getElementById(`favdot-${CSS.escape(tk)}`);
  if (dot) { dot.textContent='♥'; dot.classList.toggle('visible',!current); }
  _syncCardActions(tk);
  if (activeType==='favourites') applyFilters();
  refreshStats();
}

async function toggleWatchlist(cardIdOrObj, btn) {
  const t = typeof cardIdOrObj === 'string' ? cardDataStore[cardIdOrObj] : cardIdOrObj;
  if (!t) return;
  const current = getEntry(t).status;
  const newStatus = current === 'watchlist' ? 'not-started' : 'watchlist';
  await setStatus(t, newStatus);
  if (btn) btn.classList.toggle('active', newStatus === 'watchlist');
  const tk  = titleKey(t);
  const dot = document.getElementById(`wldot-${CSS.escape(tk)}`);
  if (dot) dot.classList.toggle('visible', newStatus === 'watchlist');
}

async function setStatus(t, status) {
  await syncLibrary(t, {status}, {loader:true});
  const tk   = titleKey(t);
  const card = document.querySelector(`[data-tk="${CSS.escape(tk)}"]`);
  if (!card) return;
  card.querySelectorAll('.card-status-bar').forEach(el=>el.remove());
  if (status!=='not-started') {
    const bar = document.createElement('div');
    bar.className=`card-status-bar ${status}`;
    card.insertBefore(bar, card.querySelector('.card-body'));
  }
  const pb = card.querySelector('.poster-bottom');
  if (pb) {
    pb.innerHTML = status==='watching'
      ? `<div class="status-indicator watching"><span class="s-dot"></span>Watching</div><div></div>`
      : status==='finished'
      ? `<div class="status-indicator finished"><span class="s-dot"></span>Finished</div><div></div>`
      : status==='watchlist'
      ? `<div class="status-indicator watchlist"><span class="s-dot"></span>Watchlist</div><div></div>`
      : `<div></div><div></div>`;
  }
  // Sync wl-dot and wl-btn with the new status
  const wlDot = card.querySelector('.card-wl-dot');
  if (wlDot) wlDot.classList.toggle('visible', status === 'watchlist');
  const wlBtn = card.querySelector('.wl-btn');
  if (wlBtn) wlBtn.classList.toggle('active', status === 'watchlist');
  _syncCardActions(titleKey(t));
  if (activeType==='watching'||activeType==='finished'||activeType==='watchlist') applyFilters();
  refreshStats();
}

// ── TMDB helpers ──────────────────────────────────────────────────────────────
// TMDB calls are routed through the server-side proxy at /api/tmdb/*
// to keep the API key off the client.
const TMDB_IMG  = 'https://image.tmdb.org/t/p';

// ── OMDb ratings (IMDb + RT) ──────────────────────────────────────────────────
// Free key from omdbapi.com — users can replace with their own
const OMDB_KEY   = 'trilogy';
const omdbCache  = {};   // imdbId → { imdb, rt } | null
const omdbQueue  = [];
let   omdbActive = 0;
const OMDB_CONCURRENCY = 2;
const OMDB_DELAY_MS    = 300;

async function fetchOmdbRatings(imdbId) {
  if (imdbId in omdbCache) return omdbCache[imdbId];
  return new Promise(resolve => {
    omdbQueue.push({ imdbId, resolve });
    drainOmdbQueue();
  });
}
function drainOmdbQueue() {
  while (omdbActive < OMDB_CONCURRENCY && omdbQueue.length > 0) {
    const { imdbId, resolve } = omdbQueue.shift();
    omdbActive++;
    _doOmdbFetch(imdbId).then(result => {
      omdbCache[imdbId] = result;
      resolve(result);
      omdbActive--;
      setTimeout(drainOmdbQueue, OMDB_DELAY_MS);
    });
  }
}
async function _doOmdbFetch(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_KEY}`);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.Response === 'False') return null;
    const imdb = d.imdbRating && d.imdbRating !== 'N/A' ? d.imdbRating : null;
    const rtObj = (d.Ratings || []).find(r => r.Source === 'Rotten Tomatoes');
    const rt = rtObj ? rtObj.Value : null; // e.g. "94%"
    return (imdb || rt) ? { imdb, rt } : null;
  } catch { return null; }
}

// Fetch IMDb ID for a TMDB title, then pull OMDb ratings
async function fetchFilmographyRatings(tmdbId, mediaType, rowEl) {
  const scoresEl = rowEl.querySelector('.filmography-scores');
  if (!scoresEl) return;

  function showRatingsFallback() {
    const epsEl = scoresEl.querySelector('.filmography-eps');
    scoresEl.innerHTML = `
      <div class="filmography-score-pair">
        <div class="filmography-score-lbl">IMDb</div>
        <div class="filmography-score-na" title="Rating unavailable">—</div>
      </div>
      <div class="filmography-score-pair">
        <div class="filmography-score-lbl">RT</div>
        <div class="filmography-score-na" title="Rating unavailable">—</div>
      </div>
      ${epsEl ? epsEl.outerHTML : ''}`;
  }

  try {
    // TMDB external_ids gives us the imdb_id
    const ext = await tmdbGet(`/${mediaType}/${tmdbId}/external_ids`);
    const imdbId = ext?.imdb_id;
    if (!imdbId) { showRatingsFallback(); return; }
    const ratings = await fetchOmdbRatings(imdbId);
    if (!ratings) { showRatingsFallback(); return; }
    // Replace score content with IMDb + RT
    let html = '';
    const epsEl = scoresEl.querySelector('.filmography-eps');
    if (ratings.imdb) html += `<div class="filmography-score-pair"><div class="filmography-score-lbl">IMDb</div><div class="filmography-score" style="color:var(--gold)">${ratings.imdb}</div></div>`;
    else              html += `<div class="filmography-score-pair"><div class="filmography-score-lbl">IMDb</div><div class="filmography-score-na" title="Rating unavailable">—</div></div>`;
    if (ratings.rt)   html += `<div class="filmography-score-pair"><div class="filmography-score-lbl">RT</div><div class="filmography-score" style="color:var(--tomato)">${ratings.rt}</div></div>`;
    else              html += `<div class="filmography-score-pair"><div class="filmography-score-lbl">RT</div><div class="filmography-score-na" title="Rating unavailable">—</div></div>`;
    scoresEl.innerHTML = html + (epsEl ? epsEl.outerHTML : '');
  } catch { showRatingsFallback(); }
}

async function tmdbGet(path) {
  // All TMDB requests go through our server proxy so the API key stays server-side
  return api('GET', '/api/tmdb' + path, null, {loader:true});
}

async function tmdbFindId(title, year, type) {
  const mt  = type === 'movie' ? 'movie' : 'tv';
  const qs  = new URLSearchParams({ query: title, type: mt });
  if (year) qs.set('year', year);
  const d = await api('GET', `/api/tmdb/search?${qs}`, null, {loader:true});
  return d?.results?.[0]?.id ?? null;
}

// ── Watched state (in-memory mirror of /api/watched) ─────────────────────────
// key: "platform::title::season_num::episode_num"  value: true
// season keys: "platform::title::S::season_num"
let watchedSet = {};

function wKey(platform, title, sNum, eNum) {
  return `${platform}::${title.toLowerCase()}::${sNum}::${eNum}`;
}
function wSeasonKey(platform, title, sNum) {
  return `${platform}::${title.toLowerCase()}::S::${sNum}`;
}

async function loadWatched(t) {
  const data = await api('GET', `/api/watched?platform=${encodeURIComponent(t.platform)}&title=${encodeURIComponent(t.title)}`, null, {loader:true});
  if (!data) return;
  (data.watched || []).forEach(r => {
    if (r.item_type === 'episode') {
      watchedSet[wKey(t.platform, t.title, r.season_num, r.episode_num)] = true;
    } else {
      watchedSet[wSeasonKey(t.platform, t.title, r.season_num)] = true;
    }
  });
}

async function toggleWatched(platform, title, itemType, seasonNum, episodeNum, el) {
  // Prevent marking future episodes as watched
  if (itemType === 'episode') {
    const airDate = el?.dataset?.airDate;
    if (airDate && new Date(airDate) > new Date()) {
      showToast('This episode hasn\'t aired yet');
      return;
    }
  }
  const key     = itemType === 'season'
    ? wSeasonKey(platform, title, seasonNum)
    : wKey(platform, title, seasonNum, episodeNum);
  const nowWatched = !watchedSet[key];
  if (nowWatched) watchedSet[key] = true; else delete watchedSet[key];
  el.classList.toggle('watched', nowWatched);
  el.textContent = nowWatched ? '✓' : '';
  await api('POST', '/api/watched', { platform, title, item_type: itemType, season_num: seasonNum, episode_num: episodeNum, watched: nowWatched, runtime_mins: parseInt(el?.dataset?.runtime) || 0 }, {loader:true});

  // If toggling a season, bulk-set all episodes (fetching from TMDB if not yet rendered)
  if (itemType === 'season') {
    const block = el.closest('.season-block');
    if (block) await bulkMarkSeasonEpisodes(block, platform, title, seasonNum, nowWatched);
    // Update partial/full state of header check
    updateSeasonCheck(el, platform, title, seasonNum);
  }
  if (itemType === 'episode') {
    // Re-evaluate the parent season header
    const block = el.closest('.season-block');
    if (block) {
      const headerCheck = block.querySelector('.season-check');
      if (headerCheck) updateSeasonCheck(headerCheck, platform, title, seasonNum);
    }
  }
  // Keep the mark-all button label in sync
  updateToggleAllBtn();

  // Auto-set Watching status when first episode/season is marked watched
  if (nowWatched && currentModalTitle && currentModalTitle.content_type === 'tv') {
    const currentStatus = getEntry(currentModalTitle).status;
    if (!currentStatus || currentStatus === 'not-started' || currentStatus === 'watchlist') {
      await setStatus(currentModalTitle, 'watching');
      updateModalStatusBtns('watching');
    }
  }

  // Auto-set Finished when all non-future episodes are now watched
  if (nowWatched && currentModalTitle && currentModalTitle.content_type === 'tv') {
    const isOngoing = currentModalTitle.is_ongoing === 1 || currentModalTitle.is_ongoing === true;
    if (!isOngoing) {
      const allChecks = [...document.querySelectorAll('#seasonsContent .ep-check:not(.ep-future)')];
      if (allChecks.length > 0 && allChecks.every(epEl => epEl.classList.contains('watched'))) {
        const curStatus = getEntry(currentModalTitle).status;
        if (curStatus !== 'finished') {
          await setStatus(currentModalTitle, 'finished');
          updateModalStatusBtns('finished');
        }
      }
    }
  }
}

// ── Bulk-mark all episodes in a season ───────────────────────────────────────
// Works whether or not the episode list has been expanded/rendered.
async function bulkMarkSeasonEpisodes(block, platform, title, seasonNum, nowWatched) {
  const seasonEpisodes = [];
  let seasonRuntime = 0;

  // 1. Update any already-rendered episode checkboxes immediately
  block.querySelectorAll('.ep-check').forEach(epEl => {
    const s = parseInt(epEl.dataset.s), e = parseInt(epEl.dataset.e);
    const epKey = wKey(platform, title, s, e);
    if (nowWatched) {
      watchedSet[epKey] = true;
      seasonEpisodes.push(e);
      seasonRuntime += parseInt(epEl.dataset.runtime) || 0;
    } else {
      delete watchedSet[epKey];
    }
    epEl.classList.toggle('watched', nowWatched);
    epEl.textContent = nowWatched ? '✓' : '';
  });

  // 2. If episodes haven't been fetched yet (season never opened), fetch them
  //    to include them in the batch rather than skipping them entirely.
  if (!episodeFetchedSeasons.has(seasonNum)) {
    const sl = block.closest('.seasons-list');
    const tmdbId = sl ? parseInt(sl.dataset.tmdbId) : 0;
    const mt     = sl ? sl.dataset.mt : '';
    if (tmdbId && mt) {
      const data = await tmdbGet(`/${mt}/${tmdbId}/season/${seasonNum}`);
      if (data?.episodes?.length) {
        data.episodes.forEach(ep => {
          const e = ep.episode_number;
          const epKey = wKey(platform, title, seasonNum, e);
          // Only process episodes not already handled via DOM above
          const alreadyDone = block.querySelector(`.ep-check[data-s="${seasonNum}"][data-e="${e}"]`);
          if (!alreadyDone) {
            if (nowWatched) {
              watchedSet[epKey] = true;
              seasonEpisodes.push(e);
              seasonRuntime += ep.runtime || 0;
            } else {
              delete watchedSet[epKey];
            }
          }
        });
      }
    }
  }

  // One request for the whole season instead of one per episode.
  // episodes:[] for the unwatch case tells the backend to clear the whole season row.
  api('POST', '/api/watched/batch', {
    platform, title, watched: nowWatched,
    seasons: [{
      season_num: seasonNum,
      episodes: nowWatched ? seasonEpisodes : [],
      runtime_mins: seasonRuntime,
    }],
  });
}

function updateSeasonCheck(checkEl, platform, title, seasonNum) {
  const block = checkEl.closest('.season-block');
  if (!block) return;
  const epChecks = [...block.querySelectorAll('.ep-check')];
  if (!epChecks.length) return;
  const watchedCount = epChecks.filter(e => watchedSet[wKey(platform, title, parseInt(e.dataset.s), parseInt(e.dataset.e))]).length;
  const all = watchedCount === epChecks.length;
  const some = watchedCount > 0 && !all;
  checkEl.classList.toggle('watched', all);
  checkEl.classList.toggle('partial', some && !all);
  checkEl.textContent = all ? '✓' : some ? '–' : '';
  const prog = block.querySelector('.season-progress');
  if (prog) prog.textContent = watchedCount > 0 ? `${watchedCount}/${epChecks.length}` : '';
  if (all) watchedSet[wSeasonKey(platform, title, seasonNum)] = true;
  else delete watchedSet[wSeasonKey(platform, title, seasonNum)];
}

// ── Modal tabs ────────────────────────────────────────────────────────────────
function switchModalTab(panel, tabEl) {
  document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.modal-panel').forEach(p => p.classList.remove('active'));
  tabEl.classList.add('active');
  document.getElementById('panel-' + panel).classList.add('active');
}

// ── Modal open / close ────────────────────────────────────────────────────────
let tmdbCache = {};  // cache TMDB details per "type::id"

async function openModal(cardIdOrObj, fromHistory = false) {
  // cardIdOrObj can be a titleKey string (from cardDataStore), a legacy random ID, or a plain object
  const t = typeof cardIdOrObj === 'string' ? (cardDataStore[cardIdOrObj] || cardDataStore[cardIdOrObj]) : cardIdOrObj;
  if (!t) return;
  if (!fromHistory) {
    navStack.length = 0; // fresh navigation only clears when not coming from history
    history.pushState({ modal: 'title' }, '');
  }
  currentModalTitle = t;
  const entry = getEntry(t);
  const isTV  = t.content_type === 'tv';

  // Reset tabs to Overview
  switchModalTab('overview', document.querySelector('[data-panel="overview"]'));
  document.getElementById('seasonsTab').style.display = isTV ? '' : 'none';

  // Static header
  // Platform + region selector
  _modalSelectedRegion = null;
  _buildModalPlatformUI(t);
  document.getElementById('mTitle').textContent    = t.title;
  document.getElementById('mTags').innerHTML = [
    t.content_type ? `<span class="type-tag ${t.content_type}">${t.content_type}</span>` : '',
    t.release_year ? `<span class="year-text" style="font-size:13px">${t.release_year}</span>` : '',
    t.maturity_rating ? `<span class="rating-tag">${t.maturity_rating}</span>` : '',
    t.ranking_position > 0 ? `<span class="rating-tag" style="color:var(--accent);border-color:var(--accent)">#${t.ranking_position}${t.ranking_region ? ' · ' + t.ranking_region : ''}</span>` : '',
  ].join('');
  document.getElementById('mShowMeta').innerHTML = '';
  document.getElementById('mTagline').textContent = '';

  // Images
  document.getElementById('mHeroImg').style.display  = 'none';
  document.getElementById('mHeroPlaceholder').style.display = 'flex';
  document.getElementById('mHeroPlaceholder').textContent   = isTV ? '📺' : '🎬';
  document.getElementById('mPosterImg').style.display = 'none';
  document.getElementById('mPosterPh').style.display  = 'flex';
  document.getElementById('mPosterPh').textContent    = isTV ? '📺' : '🎬';
  fetchPosterUrl(t.title, t.release_year, t.content_type).then(imgs => {
    if (!imgs) return;
    if (imgs.backdrop) {
      const hi = document.getElementById('mHeroImg'); hi.src = imgs.backdrop; hi.alt = t.title;
      hi.onload = () => { hi.style.display='block'; document.getElementById('mHeroPlaceholder').style.display='none'; };
    }
    const pi = document.getElementById('mPosterImg'); pi.src = imgs.poster; pi.alt = t.title;
    pi.onload = () => { pi.style.display='block'; document.getElementById('mPosterPh').style.display='none'; };
  });

  // Fav / status / notes
  updateModalFavBtn(entry.is_fav);
  updateModalStatusBtns(entry.status || 'not-started');
  updateModalRating(entry.user_rating || 0);
  document.getElementById('notesInput').value = entry.notes || '';
  document.getElementById('notesSavedMsg').style.opacity = '0';

  // Static scores from DB
  const _imdbIcon = `<svg class="modal-score-icon-svg" viewBox="0 0 24 24" fill="var(--gold)"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
  const _rtIcon   = `<svg class="modal-score-icon-svg" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="18" r="10" fill="var(--tomato)"/><path d="M16 8 Q19 4 23 5 Q20 8 19 11 Q17 8 15 11 Q14 8 11 5 Q15 4 16 8Z" fill="#56ab2f"/></svg>`;
  document.getElementById('mScores').innerHTML = [
    { label:'IMDb',            value: t.imdb_score  ? t.imdb_score.toFixed(1)  : '—', sub: t.imdb_votes ? fmtVotes(t.imdb_votes)+' votes' : 'no data', color:'var(--gold)',   icon: _imdbIcon },
    { label:'Rotten Tomatoes', value: t.tomatometer ? t.tomatometer+'%'        : '—', sub: t.tomatometer ? 'tomatometer' : 'no data',              color:'var(--tomato)', icon: _rtIcon },
  ].map(s => `
    <div class="modal-score-block">
      ${s.icon}
      <div class="modal-score-left">
        <div class="modal-score-label">${s.label}</div>
        <div class="modal-score-sub">${s.sub}</div>
      </div>
      <div class="modal-score-value" style="color:${s.color}">${s.value}</div>
    </div>`).join('');

  const syn = document.getElementById('mSynopsis');
  if (t.synopsis && t.synopsis.trim()) { syn.textContent = t.synopsis; syn.className = 'synopsis-text'; }
  else { syn.textContent = 'No synopsis available.'; syn.className = 'synopsis-text empty-synopsis'; }
  document.getElementById('mGenres').innerHTML = (t.genre && t.genre !== 'Unknown')
    ? t.genre.split(',').map(g => `<span class="genre-chip">${formatGenre(g)}</span>`).join('') : '';
  document.getElementById('mDetailTable').innerHTML = '';

  // Show detail page immediately — TMDB data loads asynchronously
  const page = document.getElementById('overlay');
  page.classList.add('open');
  document.getElementById('detailScroll').scrollTop = 0;
  document.getElementById('detailCrumb').textContent = t.title;
  document.body.style.overflow = 'hidden';

  // Reset lazy panels
  document.getElementById('castContent').className    = 'panel-loading';
  document.getElementById('castContent').textContent  = 'Loading cast…';
  document.getElementById('seasonsContent').className = 'panel-loading';
  document.getElementById('seasonsContent').textContent = 'Loading seasons…';
  document.getElementById('seasonsToolbar').style.display = isTV ? '' : 'none';

  // Reset watched state so stale markers from other titles don't bleed through,
  // then await it so the season skeleton is rendered with correct check states.
  watchedSet = {};
  await loadWatched(t);

  // Fetch TMDB rich data (seasons skeleton now reads a fully-populated watchedSet)
  loadTmdbData(t);
}

async function loadTmdbData(t) {
  const isTV = t.content_type === 'tv';
  const mt   = isTV ? 'tv' : 'movie';
  const cacheKey = mt + '::' + t.title + '::' + (t.release_year || '');

  let details = tmdbCache[cacheKey];
  if (!details) {
    const id = await tmdbFindId(t.title, t.release_year, t.content_type);
    if (!id) {
      document.getElementById('castContent').className = 'panel-err';
      document.getElementById('castContent').textContent = 'No TMDB data found for this title.';
      document.getElementById('seasonsContent').className = 'panel-err';
      document.getElementById('seasonsContent').textContent = 'No TMDB data found for this title.';
      return;
    }
    const [det, creds] = await Promise.all([
      tmdbGet(`/${mt}/${id}?append_to_response=external_ids`),
      tmdbGet(`/${mt}/${id}/credits`),
    ]);
    details = { id, det, creds };
    tmdbCache[cacheKey] = details;

    // Silently save runtime to backend for accurate watch time
    const runtimeMins = isTV
      ? (det?.episode_run_time?.[0] || det?.last_episode_to_air?.runtime || det?.next_episode_to_air?.runtime || 0)
      : (det?.runtime || 0);
    if (runtimeMins > 0) {
      api('PATCH', '/api/titles/runtime', {platform: t.platform, title: t.title, runtime_mins: runtimeMins}, {loader:false});
    }
  }

  const { id, det, creds } = details;
  if (!det) return;

  // ── Backfill card year display from modal TMDB fetch ─────────────────────
  if (isTV && typeof _tmdbShowData !== 'undefined') {
    const tvStatus = det.status || '';
    const ongoing  = ['Returning Series','In Production','Planned','Pilot'].includes(tvStatus);
    const endYear  = ongoing ? null : (det.last_air_date ? det.last_air_date.slice(0,4) : null);
    const tk = titleKey(t);
    _tmdbShowData[tk] = {
      tmdbId: id, ongoing, endYear,
      nextEp: det.next_episode_to_air || null,
      posterThumb: det.poster_path ? `https://image.tmdb.org/t/p/w92${det.poster_path}` : null,
    };
    // Persist end_year to DB so it appears on cards without TMDB on next load
    if (endYear && !t.end_year) {
      t.end_year = endYear;
      api('PATCH', '/api/titles/end_year', {platform: t.platform, title: t.title, end_year: endYear}, {loader: false});
    }
    // Persist is_ongoing so trailing dash shows on next load without TMDB fetch
    if (t.is_ongoing == null) {
      t.is_ongoing = ongoing ? 1 : 0;
      api('PATCH', '/api/titles/is_ongoing', {platform: t.platform, title: t.title, is_ongoing: ongoing}, {loader: false});
    }
    const yearEl = document.getElementById(`yeartext-${CSS.escape(tk)}`);
    if (yearEl && t.release_year) yearEl.textContent = _tvYearDisplay(t);
  }

  // ── Tagline ───────────────────────────────────────────────────────────────
  if (det.tagline) {
    document.getElementById('mTagline').textContent = `"${det.tagline}"`;
  }

  // ── Synopsis upgrade (TMDB overview is usually better than DB synopsis) ──
  if (det.overview) {
    const syn = document.getElementById('mSynopsis');
    syn.textContent = det.overview;
    syn.className = 'synopsis-text';
  }

  // ── Genres upgrade ────────────────────────────────────────────────────────
  if (det.genres?.length) {
    document.getElementById('mGenres').innerHTML =
      det.genres.map(g => `<span class="genre-chip">${escHtml(g.name)}</span>`).join('');
  }

  // ── Detail table ─────────────────────────────────────────────────────────
  const rows = [];
  const addRow = (key, val) => { if (val) rows.push(`<div class="detail-row"><div class="detail-key">${key}</div><div class="detail-val">${val}</div></div>`); };

  if (isTV) {
    const creators = (det.created_by || []).map(c => escHtml(c.name)).join(', ');
    addRow('Created by', creators);
    const networks = (det.networks || []).map(n => escHtml(n.name)).join(', ');
    addRow('Network', networks);
    addRow('Status', det.status || '');
    addRow('First aired', det.first_air_date || '');
    addRow('Last aired', det.last_air_date || '');
    const episodeRuntime = det.episode_run_time?.[0] || det.last_episode_to_air?.runtime || det.next_episode_to_air?.runtime;
    addRow('Episode length', episodeRuntime ? `${episodeRuntime} min` : '');
    const countries = (det.origin_country || []).join(', ');
    addRow('Country', countries);
    const langs = (det.spoken_languages || []).map(l => l.english_name).join(', ');
    addRow('Languages', langs);
    if (det.homepage) addRow('Website', `<a href="${escAttr(det.homepage)}" target="_blank" rel="noopener">Official site ↗</a>`);
  } else {
    // directors
    const directors = (creds?.crew || []).filter(c => c.job === 'Director').map(c => escHtml(c.name)).join(', ');
    addRow('Director', directors);
    const writers = (creds?.crew || []).filter(c => ['Screenplay','Writer','Story'].includes(c.job)).slice(0,3).map(c => escHtml(c.name)).join(', ');
    addRow('Writer', writers);
    const studios = (det.production_companies || []).slice(0,3).map(c => escHtml(c.name)).join(', ');
    addRow('Studio', studios);
    addRow('Release date', det.release_date || '');
    addRow('Runtime', det.runtime ? `${det.runtime} min` : '');
    const countries = (det.production_countries || []).map(c => c.name).join(', ');
    addRow('Country', countries);
    const langs = (det.spoken_languages || []).map(l => l.english_name).join(', ');
    addRow('Languages', langs);
    addRow('Box office', det.revenue > 0 ? '$' + det.revenue.toLocaleString() : '');
    addRow('Budget', det.budget > 0 ? '$' + det.budget.toLocaleString() : '');
    if (det.homepage) addRow('Website', `<a href="${escAttr(det.homepage)}" target="_blank" rel="noopener">Official site ↗</a>`);
  }

  if (rows.length) {
    document.getElementById('mDetailTable').innerHTML =
      `<div class="section-label" style="margin-top:28px">Details</div><div class="detail-table">${rows.join('')}</div>`;
  }

  // ── Show meta bar (TV) ────────────────────────────────────────────────────
  if (isTV && det) {
    const seasons    = (det.seasons || []).filter(s => s.season_number > 0);
    const seasonCount = seasons.length;
    const status      = det.status || '';
    const ongoing     = ['Returning Series','In Production','Planned'].includes(status);
    const badge       = ongoing
      ? `<span class="badge-ongoing">● Ongoing</span>`
      : status ? `<span class="badge-ended">${status}</span>` : '';
    const startYear   = det.first_air_date ? det.first_air_date.slice(0, 4) : '';
    const endYear     = ongoing ? '' : (det.last_air_date ? det.last_air_date.slice(0, 4) : '');
    const yearRange   = startYear ? (endYear ? `${startYear}–${endYear}` : `${startYear}–`) : '';
    document.getElementById('mShowMeta').innerHTML = `
      <span>📅 ${seasonCount} season${seasonCount !== 1 ? 's' : ''}</span>
      ${det.number_of_episodes ? `<span>🎬 ${det.number_of_episodes} episodes</span>` : ''}
      ${yearRange ? `<span>${yearRange}</span>` : ''}
      ${badge}`;
  } else if (!isTV && det) {
    document.getElementById('mShowMeta').innerHTML = [
      det.runtime ? `<span>⏱ ${det.runtime} min</span>` : '',
      det.release_date ? `<span>📅 ${det.release_date.slice(0,4)}</span>` : '',
      det.production_countries?.[0] ? `<span>🌍 ${det.production_countries[0].name}</span>` : '',
    ].filter(Boolean).join('');
  }

  // ── Cast panel ────────────────────────────────────────────────────────────
  const cast = (creds?.cast || []).slice(0, 20);
  if (!cast.length) {
    document.getElementById('castContent').className = 'panel-err';
    document.getElementById('castContent').textContent = 'No cast information available.';
  } else {
    const castHTML = `<div class="cast-grid">${cast.map(a => `
      <div class="cast-card" data-actor-id="${a.id}" data-actor-name="${escAttr(a.name)}" data-actor-char="${escAttr(a.character||'')}">
        ${a.profile_path
          ? `<img class="cast-photo" src="${TMDB_IMG}/w185${a.profile_path}" alt="${escHtml(a.name)}" loading="lazy">`
          : `<div class="cast-photo-ph">🎭</div>`}
        <div class="cast-info">
          <div class="cast-name">${escHtml(a.name)}</div>
          <div class="cast-role">${escHtml(a.character || '—')}</div>
        </div>
      </div>`).join('')}</div>`;
    document.getElementById('castContent').className = '';
    document.getElementById('castContent').innerHTML = castHTML;
    document.getElementById('castContent').querySelectorAll('.cast-card').forEach(card => {
      card.addEventListener('click', () => {
        openActorModal(
          Number(card.dataset.actorId),
          card.dataset.actorName,
          card.dataset.actorChar
        );
      });
    });
  }

  // ── Seasons panel (TV only) ────────────────────────────────────────────────
  if (!isTV) return;
  const seasons = (det.seasons || []).filter(s => s.season_number > 0);
  if (!seasons.length) {
    document.getElementById('seasonsContent').className = 'panel-err';
    document.getElementById('seasonsContent').textContent = 'No season data available.';
    return;
  }

  // Render skeleton first, then fill episode lists lazily as seasons are opened
  const platform = currentModalTitle.platform;
  const title    = currentModalTitle.title;

  const seasonsHTML = `<div class="seasons-list" data-tmdb-id="${id}" data-mt="${mt}">${seasons.map(s => {
    // Derive watched state from individual episode keys (covers case where episodes
    // were marked one-by-one rather than via the season checkbox).
    const epPrefix       = `${platform}::${title.toLowerCase()}::${s.season_number}::`;
    const watchedEpCount = Object.keys(watchedSet).filter(k => k.startsWith(epPrefix)).length;
    const seasonAll      = !!(watchedSet[wSeasonKey(platform, title, s.season_number)] ||
                           (s.episode_count > 0 && watchedEpCount >= s.episode_count));
    const seasonPartial  = !seasonAll && watchedEpCount > 0;
    const checkCls       = seasonAll ? 'watched' : seasonPartial ? 'partial' : '';
    const checkTxt       = seasonAll ? '✓' : seasonPartial ? '–' : '';
    const progressTxt    = watchedEpCount > 0 ? `${watchedEpCount}/${s.episode_count}` : '';
    return `
    <div class="season-block" id="sblock-${s.season_number}">
      <div class="season-header" onclick="toggleSeasonBlock(${s.season_number},${id},'${mt}')">
        <div class="season-check ${checkCls}"
             onclick="event.stopPropagation();toggleWatched('${escAttr(platform)}','${escAttr(title)}','season',${s.season_number},0,this)"
             title="Mark whole season watched">
          ${checkTxt}
        </div>
        <span class="season-title">${escHtml(s.name||'Season '+s.season_number)}</span>
        <span class="season-ep-count">${s.episode_count} eps</span>
        <span class="season-progress" id="sprogress-${s.season_number}">${progressTxt}</span>
        <span class="season-chevron">▼</span>
      </div>
      <div class="episodes-list" id="elist-${s.season_number}" style="display:none">
        <div class="panel-loading">Loading episodes…</div>
      </div>
    </div>`;
  }).join('')}</div>`;

  document.getElementById('seasonsContent').className = '';
  document.getElementById('seasonsContent').innerHTML = seasonsHTML;
  // Show the mark-all toolbar now that we have real season data
  document.getElementById('seasonsToolbar').style.display = '';
  updateToggleAllBtn();
}

// Toggle a season open/closed, fetching episodes lazily
const episodeFetchedSeasons = new Set();
async function toggleSeasonBlock(seasonNum, tmdbId, mt) {
  const block  = document.getElementById('sblock-' + seasonNum);
  const elist  = document.getElementById('elist-' + seasonNum);
  if (!block || !elist) return;
  const isOpen = block.classList.toggle('open');
  elist.style.display = isOpen ? 'block' : 'none';

  if (!isOpen) return;
  if (episodeFetchedSeasons.has(seasonNum)) return;
  episodeFetchedSeasons.add(seasonNum);

  const platform = currentModalTitle.platform;
  const title    = currentModalTitle.title;

  const data = await tmdbGet(`/${mt}/${tmdbId}/season/${seasonNum}`);
  if (!data?.episodes?.length) {
    elist.innerHTML = '<div class="panel-err">No episode data.</div>';
    return;
  }

  elist.innerHTML = data.episodes.map(ep => {
    const isWatched = !!watchedSet[wKey(platform, title, seasonNum, ep.episode_number)];
    const isFuture  = ep.air_date && new Date(ep.air_date) > new Date();
    return `
      <div class="episode-row">
        <div class="ep-check${isWatched?' watched':''}${isFuture?' ep-future':''}"
             data-s="${seasonNum}" data-e="${ep.episode_number}" data-runtime="${ep.runtime||0}" data-air-date="${ep.air_date||''}"
             onclick="toggleWatched('${escAttr(platform)}','${escAttr(title)}','episode',${seasonNum},${ep.episode_number},this)"
             title="${isFuture?'Not aired yet — '+ep.air_date:'Mark episode watched'}">
          ${isWatched?'✓':isFuture?'🔒':''}
        </div>
        <div class="ep-num">E${ep.episode_number}</div>
        <div class="ep-info">
          <div class="ep-name">${escHtml(ep.name||'Episode '+ep.episode_number)}</div>
          <div class="ep-meta">
            ${ep.air_date?`<span>📅 ${ep.air_date}</span>`:''}
            ${ep.runtime?`<span>⏱ ${ep.runtime}m</span>`:''}
            ${ep.vote_average?`<span>⭐ ${ep.vote_average.toFixed(1)}</span>`:''}
          </div>
          ${ep.overview?`<div class="ep-overview">${escHtml(ep.overview)}</div>`:''}
        </div>
      </div>`;
  }).join('');

  // Refresh season-level check after loading real episode count
  const hc = block.querySelector('.season-check');
  if (hc) updateSeasonCheck(hc, platform, title, seasonNum);
}


// ── Mark all / unmark all episodes ────────────────────────────────────────────
function allEpisodesWatched() {
  // Returns true only if every *rendered* ep-check is watched
  const allChecks = [...document.querySelectorAll('#seasonsContent .ep-check')];
  if (!allChecks.length) return false;
  return allChecks.every(el => el.classList.contains('watched'));
}

function updateToggleAllBtn() {
  const btn = document.getElementById('seasonsToggleAllBtn');
  if (!btn) return;
  const allWatched = allEpisodesWatched();
  btn.textContent = allWatched ? '✕ Unmark all watched' : '✓ Mark all watched';
  btn.classList.toggle('all-watched', allWatched);
}

async function toggleAllWatched() {
  if (!currentModalTitle) return;
  const { platform, title } = currentModalTitle;

  // Decide direction BEFORE expanding — based on what is currently stored in
  // watchedSet for all seasons, not just rendered episodes.
  // If every season-level key is marked we treat it as "all watched".
  const seasonBlocks = [...document.querySelectorAll('#seasonsContent .season-block')];
  if (!seasonBlocks.length) return;

  // Read tmdbId and mt from the data attributes we stored on .seasons-list
  const seasonsList = document.querySelector('#seasonsContent .seasons-list');
  const tmdbId = seasonsList ? seasonsList.dataset.tmdbId : null;
  const mt     = seasonsList ? seasonsList.dataset.mt     : null;
  if (!tmdbId || !mt) return;

  // Determine toggle direction: if everything rendered is watched → unwatch, else → watch
  const nowWatched = !allEpisodesWatched();

  // Show a brief loading state on the button while we expand all seasons
  const btn = document.getElementById('seasonsToggleAllBtn');
  if (btn) { btn.textContent = 'Loading episodes…'; btn.disabled = true; }

  // Fetch every season that hasn't been loaded yet, in parallel.
  // Episodes are rendered into their elist divs but the rows are NOT expanded —
  // display state is left exactly as the user had it.
  const expandPromises = seasonBlocks.map(block => {
    const seasonNum = parseInt(block.id.replace('sblock-', ''));
    if (episodeFetchedSeasons.has(seasonNum)) {
      // Already loaded — nothing to fetch, leave visual state untouched
      return Promise.resolve();
    }
    episodeFetchedSeasons.add(seasonNum);
    return (async () => {
      const data = await tmdbGet(`/${mt}/${tmdbId}/season/${seasonNum}`);
      const elist = document.getElementById('elist-' + seasonNum);
      if (!elist) return;
      if (!data?.episodes?.length) {
        elist.innerHTML = '<div class="panel-err">No episode data.</div>';
        return;
      }
      // Render episodes but keep the elist hidden — don't touch display or .open
      elist.innerHTML = data.episodes.map(ep => {
        const isWatched = !!watchedSet[wKey(platform, title, seasonNum, ep.episode_number)];
        const isFuture  = ep.air_date && new Date(ep.air_date) > new Date();
        return `
          <div class="episode-row">
            <div class="ep-check${isWatched ? ' watched' : ''}${isFuture ? ' ep-future' : ''}"
                 data-s="${seasonNum}" data-e="${ep.episode_number}" data-runtime="${ep.runtime||0}" data-air-date="${ep.air_date||''}"
                 onclick="toggleWatched('${escAttr(platform)}','${escAttr(title)}','episode',${seasonNum},${ep.episode_number},this)"
                 title="${isFuture ? 'Not aired yet — '+ep.air_date : 'Mark episode watched'}">
              ${isWatched ? '✓' : isFuture ? '🔒' : ''}
            </div>
            <div class="ep-num">E${ep.episode_number}</div>
            <div class="ep-info">
              <div class="ep-name">${escHtml(ep.name || 'Episode ' + ep.episode_number)}</div>
              <div class="ep-meta">
                ${ep.air_date  ? `<span>📅 ${ep.air_date}</span>`                    : ''}
                ${ep.runtime   ? `<span>⏱ ${ep.runtime}m</span>`                    : ''}
                ${ep.vote_average ? `<span>⭐ ${ep.vote_average.toFixed(1)}</span>` : ''}
              </div>
              ${ep.overview ? `<div class="ep-overview">${escHtml(ep.overview)}</div>` : ''}
            </div>
          </div>`;
      }).join('');
      // Refresh season progress counter without opening the row
      const hc = block.querySelector('.season-check');
      if (hc) updateSeasonCheck(hc, platform, title, seasonNum);
    })();
  });

  // Wait for every season to finish loading before marking
  await Promise.all(expandPromises);

  // Collect all episode updates across all seasons into a single batch request.
  const allBlocks = [...document.querySelectorAll('#seasonsContent .season-block')];
  const batchSeasons = [];
  for (const block of allBlocks) {
    const epChecks = [...block.querySelectorAll('.ep-check')];
    if (!epChecks.length) continue;
    const seasonNum = parseInt(epChecks[0].dataset.s);

    const seasonEpisodes = [];
    let seasonRuntime = 0;
    for (const epEl of epChecks) {
      const s = parseInt(epEl.dataset.s);
      const e = parseInt(epEl.dataset.e);
      // Skip future episodes when marking all watched
      if (nowWatched) {
        const airDate = epEl.dataset.airDate;
        if (airDate && new Date(airDate) > new Date()) continue;
      }
      const epKey = wKey(platform, title, s, e);
      if (nowWatched) {
        watchedSet[epKey] = true;
        seasonEpisodes.push(e);
        seasonRuntime += parseInt(epEl.dataset.runtime) || 0;
      } else {
        delete watchedSet[epKey];
      }
      epEl.classList.toggle('watched', nowWatched);
      epEl.textContent = nowWatched ? '✓' : '';
    }

    // Update season-level checkbox + progress
    const seasonCheck = block.querySelector('.season-check');
    const seasonKey   = wSeasonKey(platform, title, seasonNum);
    if (nowWatched) watchedSet[seasonKey] = true; else delete watchedSet[seasonKey];
    if (seasonCheck) {
      seasonCheck.classList.toggle('watched', nowWatched);
      seasonCheck.classList.remove('partial');
      seasonCheck.textContent = nowWatched ? '✓' : '';
    }
    const prog = block.querySelector('.season-progress');
    if (prog) prog.textContent = nowWatched ? `${epChecks.length}/${epChecks.length}` : '';

    if (nowWatched && seasonEpisodes.length > 0) {
      batchSeasons.push({ season_num: seasonNum, episodes: seasonEpisodes, runtime_mins: seasonRuntime });
    }
    // For unwatching, seasons:[] below triggers a single DELETE for the whole title.
  }

  // One network request replaces N×M individual episode requests.
  // Unwatching uses seasons=[] so the backend clears the whole title in one DELETE.
  api('POST', '/api/watched/batch', { platform, title, watched: nowWatched, seasons: nowWatched ? batchSeasons : [] });

  if (btn) btn.disabled = false;
  updateToggleAllBtn();

  // Auto-set status after bulk toggle
  if (currentModalTitle && currentModalTitle.content_type === 'tv') {
    const isOngoing = currentModalTitle.is_ongoing === 1 || currentModalTitle.is_ongoing === true;
    if (nowWatched && !isOngoing) {
      await setStatus(currentModalTitle, 'finished');
      updateModalStatusBtns('finished');
    } else if (!nowWatched) {
      const curStatus = getEntry(currentModalTitle).status;
      if (curStatus === 'finished') {
        await setStatus(currentModalTitle, 'watching');
        updateModalStatusBtns('watching');
      }
    }
  }
}

// ── Actor sub-modal ───────────────────────────────────────────────────────────
const actorCache = {};
async function openActorModal(actorId, name, character) {
  document.getElementById('actorName').textContent      = name;
  document.getElementById('actorCharacter').textContent = character ? `as ${character}` : '';
  document.getElementById('actorMetaTable').innerHTML   = '';
  document.getElementById('actorBio').textContent       = '';
  document.getElementById('actorFilmography').innerHTML = '';
  document.getElementById('actorCrumb').textContent     = name;
  // Reset photo
  const col = document.getElementById('actorPhotoCol');
  col.innerHTML = '<div class="actor-photo-ph" id="actorPhotoPh">🎭</div>';
  const overlay = document.getElementById('actorOverlay');
  history.pushState({ modal: 'actor' }, '');
  overlay.classList.add('open');
  overlay.querySelector('.actor-scroll').scrollTop = 0;
  const loader = document.getElementById('actorLoader');
  loader.classList.remove('hidden');

  let details = actorCache[actorId];
  if (!details) {
    details = await tmdbGet(`/person/${actorId}`);
    if (details) actorCache[actorId] = details;
  }

  if (!details) { loader.classList.add('hidden'); return; }

  document.getElementById('actorName').textContent = details.name || name;

  // Meta table
  const metaRows = [];
  const addMeta = (k, v) => { if (v) metaRows.push(`<div class="actor-meta-row"><div class="actor-meta-key">${k}</div><div class="actor-meta-val">${escHtml(String(v))}</div></div>`); };
  if (details.birthday) addMeta('Born', details.birthday + (details.place_of_birth ? ' · ' + details.place_of_birth : ''));
  if (details.deathday) addMeta('Died', details.deathday);
  addMeta('Known for', details.known_for_department);
  if (metaRows.length) {
    document.getElementById('actorMetaTable').innerHTML = `<div class="actor-meta-table" style="margin-bottom:24px">${metaRows.join('')}</div>`;
  }

  // Biography
  const bioEl = document.getElementById('actorBio');
  const bioText = details.biography || 'No biography available.';
  const BIO_LIMIT = 600;
  if (bioText.length > BIO_LIMIT) {
    const short = bioText.slice(0, BIO_LIMIT).replace(/\s+\S*$/, '') + '…';
    bioEl.innerHTML = `<span class="bio-short">${escHtml(short)}</span><span class="bio-full" style="display:none">${escHtml(bioText)}</span> <button class="bio-toggle" onclick="toggleBio(this)">read more</button>`;
  } else {
    bioEl.textContent = bioText;
  }

  // Photo
  if (details.profile_path) {
    col.innerHTML = `<img src="${TMDB_IMG}/w300${details.profile_path}" alt="${escHtml(details.name)}" style="width:100%;border-radius:14px;display:block;box-shadow:0 20px 60px rgba(0,0,0,.7);">`;
  }

  // Filmography — fetch full combined credits
  const credits = await tmdbGet(`/person/${actorId}/combined_credits`);
  const cast = (credits?.cast || []);

  // Dedupe by id+media_type, sort newest first
  const seen = new Set();
  const films = cast
    .filter(c => {
      const key = `${c.media_type}:${c.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return (c.title || c.name) && c.media_type !== 'person';
    })
    .sort((a, b) => {
      const ya = parseInt((a.release_date || a.first_air_date || '0').slice(0,4)) || 0;
      const yb = parseInt((b.release_date || b.first_air_date || '0').slice(0,4)) || 0;
      return yb - ya;
    })
    .slice(0, 60);

  if (films.length) {
    const filmEl = document.getElementById('actorFilmography');
    const rows = films.map(c => {
      const title    = c.title || c.name || '';
      const isMovie  = c.media_type === 'movie';
      const typeLabel = isMovie ? 'Movie' : 'TV';
      const typeCls   = isMovie ? 'movie' : 'tv';
      const character = c.character || '';

      // Year / year-range
      const startYear = (c.release_date || c.first_air_date || '').slice(0, 4);
      const endYear   = (!isMovie && c.last_air_date) ? c.last_air_date.slice(0, 4) : '';
      let yearDisplay = startYear;
      if (!isMovie && startYear) {
        yearDisplay = endYear && endYear !== startYear ? `${startYear}–${endYear}` : `${startYear}–`;
      }

      // Episode count (TV only)
      const epCount = (!isMovie && c.episode_count) ? c.episode_count : null;

      const thumb = c.poster_path
        ? `<img src="${TMDB_IMG}/w92${c.poster_path}" alt="${escAttr(title)}" loading="lazy">`
        : `<div class="filmography-thumb-ph">${isMovie ? '🎬' : '📺'}</div>`;

      // Build a synthetic title object for openModal
      const syntheticObj = JSON.stringify({
        title, platform: currentModalTitle?.platform || '',
        content_type: isMovie ? 'movie' : 'tv',
        release_year: startYear, genre: '', synopsis: '',
        imdb_score: 0, imdb_votes: 0, tomatometer: 0,
        tmdb_score: c.vote_average || 0,
        maturity_rating: '', is_trending: false, ranking_position: 0,
      }).replace(/'/g, '&#39;');

      // Scores column — shimmer placeholders while OMDb loads; episode count always shown for TV
      const scoresHtml = `
        <div class="filmography-scores">
          <div class="filmography-score-pair">
            <div class="filmography-score-lbl">IMDb</div>
            <div class="filmography-score-loading"></div>
          </div>
          <div class="filmography-score-pair">
            <div class="filmography-score-lbl">RT</div>
            <div class="filmography-score-loading"></div>
          </div>
          ${epCount ? `<div class="filmography-eps">${epCount} ep${epCount !== 1 ? 's' : ''}</div>` : ''}
        </div>`;

      return `
        <div class="filmography-row" data-tmdb-id="${c.id}" data-media-type="${c.media_type}">
          <div class="filmography-thumb" data-synthetic='${syntheticObj}'>${thumb}</div>
          <div class="filmography-info">
            <div class="filmography-title" data-synthetic='${syntheticObj}'>${escHtml(title)}</div>
            <div class="filmography-sub">
              ${yearDisplay ? `<span class="filmography-year">${yearDisplay}</span>` : ''}
              <span class="filmography-type ${typeCls}">${typeLabel}</span>
            </div>
            ${character ? `<div class="filmography-character">as ${escHtml(character)}</div>` : ''}
          </div>
          ${scoresHtml}
        </div>`;
    }).join('|SEP|').split('|SEP|'); // array of row HTML strings

    const PREVIEW = 12;
    const visibleHTML = rows.slice(0, PREVIEW).join('');
    const total       = films.length;

    const seeAllBtn = total > PREVIEW
      ? `<button class="filmography-see-all" id="filmSeeAll">↗ Show all ${total} titles</button>`
      : '';

    filmEl.innerHTML = `
      <div class="filmography-label">Filmography (${total})</div>
      <div class="filmography-list" id="filmographyList">
        ${visibleHTML}
        ${seeAllBtn}
      </div>`;

    // Lazy-load IMDb + RT ratings via OMDb as rows scroll into view
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const row = entry.target;
        obs.unobserve(row);
        const tmdbId    = row.dataset.tmdbId;
        const mediaType = row.dataset.mediaType;
        if (tmdbId && mediaType) fetchFilmographyRatings(tmdbId, mediaType, row);
      });
    }, { rootMargin: '200px' });

    filmEl.querySelectorAll('.filmography-row[data-tmdb-id]').forEach(row => observer.observe(row));

    // Wire up clicks — push actor onto nav stack, open title detail on top
    function wireFilmographyClicks(container) {
      container.querySelectorAll('[data-synthetic]').forEach(el => {
        el.addEventListener('click', () => {
          const obj = JSON.parse(el.dataset.synthetic);
          navStack.push({ type: 'actor' });
          document.getElementById('actorOverlay').classList.remove('open');
          setTimeout(() => openModal(obj, true), 60);
        });
      });
    }
    wireFilmographyClicks(filmEl);

    // See-all button — open full filmography overlay
    const seeAllEl = filmEl.querySelector('#filmSeeAll');
    if (seeAllEl) {
      seeAllEl.addEventListener('click', () => {
        openFilmographyAllOverlay(details.name || name, films, currentModalTitle?.platform);
      });
    }
  }
  loader.classList.add('hidden');
}
function closeActorModal(e) { /* no-op kept for compatibility */ }
function closeActorModalDirect() { document.getElementById('actorOverlay').classList.remove('open'); }

// ── Full filmography overlay ───────────────────────────────────────────────────
function openFilmographyAllOverlay(actorName, films, platform) {
  let ov = document.getElementById('filmographyAllOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'filmographyAllOverlay';
    ov.className = 'actor-overlay';
    ov.innerHTML = `
      <div class="actor-back-bar">
        <button class="actor-back-btn" onclick="closeFilmographyAllOverlay()">← Back</button>
        <span class="actor-back-crumb" id="filmAllCrumb"></span>
        <div class="header-search bar-search">
          <span class="header-search-icon">⌕</span>
          <input class="header-search-input hs-input" type="text"
                 placeholder="Search filmography…" autocomplete="off"
                 oninput="_filterFilmographyList(this.value)"
                 onkeydown="if(event.key==='Escape'){this.value='';_filterFilmographyList('');}">
        </div>
      </div>
      <div class="actor-scroll">
        <div style="padding:20px 24px;max-width:860px;margin:0 auto">
          <div id="filmAllContent"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
  }
  document.getElementById('filmAllCrumb').textContent = actorName + ' — Full Filmography';
  history.pushState({ modal: 'filmographyAll' }, '');
  ov.classList.add('open');
  ov.querySelector('.actor-scroll').scrollTop = 0;
  // Clear search on open
  const searchInput = ov.querySelector('.hs-input');
  if (searchInput) searchInput.value = '';

  const filmContent = document.getElementById('filmAllContent');
  filmContent.innerHTML = `
    <div class="filmography-label" style="margin-bottom:16px">Filmography (${films.length} titles)</div>
    <div class="filmography-list" id="filmAllList">
      ${films.map(c => {
        const title      = c.title || c.name || '';
        const isMovie    = c.media_type === 'movie';
        const typeLabel  = isMovie ? 'Movie' : 'TV';
        const typeCls    = isMovie ? 'movie' : 'tv';
        const character  = c.character || '';
        const startYear  = (c.release_date || c.first_air_date || '').slice(0, 4);
        const endYear    = (!isMovie && c.last_air_date) ? c.last_air_date.slice(0, 4) : '';
        let yearDisplay  = startYear;
        if (!isMovie && startYear) {
          yearDisplay = endYear && endYear !== startYear ? `${startYear}–${endYear}` : `${startYear}–`;
        }
        const epCount = (!isMovie && c.episode_count) ? c.episode_count : null;
        const thumb = c.poster_path
          ? `<img src="${TMDB_IMG}/w92${c.poster_path}" alt="${escAttr(title)}" loading="lazy">`
          : `<div class="filmography-thumb-ph">${isMovie ? '🎬' : '📺'}</div>`;
        const syntheticObj = JSON.stringify({
          title, platform: platform || '', content_type: isMovie ? 'movie' : 'tv',
          release_year: startYear, genre: '', synopsis: '',
          imdb_score: 0, imdb_votes: 0, tomatometer: 0,
          tmdb_score: c.vote_average || 0, maturity_rating: '', is_trending: false, ranking_position: 0,
        }).replace(/'/g, '&#39;');
        const scoresHtml = `
          <div class="filmography-scores">
            <div class="filmography-score-pair"><div class="filmography-score-lbl">IMDb</div><div class="filmography-score-loading"></div></div>
            <div class="filmography-score-pair"><div class="filmography-score-lbl">RT</div><div class="filmography-score-loading"></div></div>
            ${epCount ? `<div class="filmography-eps">${epCount} ep${epCount !== 1 ? 's' : ''}</div>` : ''}
          </div>`;
        return `
          <div class="filmography-row" data-tmdb-id="${c.id}" data-media-type="${c.media_type}">
            <div class="filmography-thumb" data-synthetic='${syntheticObj}'>${thumb}</div>
            <div class="filmography-info">
              <div class="filmography-title" data-synthetic='${syntheticObj}'>${escHtml(title)}</div>
              <div class="filmography-sub">
                ${yearDisplay ? `<span class="filmography-year">${yearDisplay}</span>` : ''}
                <span class="filmography-type ${typeCls}">${typeLabel}</span>
              </div>
              ${character ? `<div class="filmography-character">as ${escHtml(character)}</div>` : ''}
            </div>
            ${scoresHtml}
          </div>`;
      }).join('')}
    </div>`;

  // Wire title clicks → open modal
  filmContent.querySelectorAll('[data-synthetic]').forEach(el => {
    el.addEventListener('click', () => {
      const obj = JSON.parse(el.dataset.synthetic);
      closeFilmographyAllOverlay();
      document.getElementById('actorOverlay')?.classList.remove('open');
      setTimeout(() => openModal(obj, true), 60);
    });
  });

  // Lazy-load IMDb / RT ratings
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      obs.unobserve(entry.target);
      const row = entry.target;
      if (row.dataset.tmdbId && row.dataset.mediaType) {
        fetchFilmographyRatings(row.dataset.tmdbId, row.dataset.mediaType, row);
      }
    });
  }, { rootMargin: '200px' });
  filmContent.querySelectorAll('.filmography-row[data-tmdb-id]').forEach(r => observer.observe(r));
}

function closeFilmographyAllOverlay() {
  document.getElementById('filmographyAllOverlay')?.classList.remove('open');
}

function _filterFilmographyList(q) {
  const lq = q.trim().toLowerCase();
  document.querySelectorAll('#filmAllList .filmography-row').forEach(row => {
    const titleEl = row.querySelector('.filmography-title');
    const text = (titleEl?.textContent || '').toLowerCase();
    row.style.display = (!lq || text.includes(lq)) ? '' : 'none';
  });
}
function toggleBio(btn) {
  var bioEl = document.getElementById('actorBio');
  var short = bioEl.querySelector('.bio-short');
  var full  = bioEl.querySelector('.bio-full');
  var expanded = full.style.display !== 'none';
  short.style.display = expanded ? '' : 'none';
  full.style.display  = expanded ? 'none' : '';
  btn.textContent = expanded ? 'read more' : 'read less';
}

// ── updateModalFavBtn / status ────────────────────────────────────────────────
function updateModalFavBtn(isFav) {
  const btn = document.getElementById('modalFavBtn');
  btn.textContent = isFav ? '❤️ Favourite' : '❤️ Add to Favourites';
  btn.classList.toggle('active', isFav);
}
function updateModalStatusBtns(status) {
  ['sBtn1','sBtn2','sBtn3'].forEach(id => {
    const el = document.getElementById(id); if (el) el.className='status-btn-lg';
  });
  if (status==='watchlist')   document.getElementById('sBtn3').classList.add('active-watchlist');
  if (status==='watching')    document.getElementById('sBtn1').classList.add('active-watching');
  if (status==='finished')    document.getElementById('sBtn2').classList.add('active-finished');

  // Disable the Finished button for ongoing TV shows
  const sBtn2 = document.getElementById('sBtn2');
  if (sBtn2 && currentModalTitle) {
    const isOngoing = currentModalTitle.is_ongoing === 1 || currentModalTitle.is_ongoing === true;
    const isTV = currentModalTitle.content_type === 'tv';
    sBtn2.disabled = !!(isTV && isOngoing);
    sBtn2.title = (isTV && isOngoing) ? 'Show is still ongoing' : '';
  }
}

async function toggleFavFromModal() {
  if (!currentModalTitle) return;
  const current = getEntry(currentModalTitle).is_fav;
  await syncLibrary(currentModalTitle, {is_fav: !current}, {loader:true});
  updateModalFavBtn(!current);
  const tk  = titleKey(currentModalTitle);
  const btn = document.querySelector(`[data-tk="${CSS.escape(tk)}"] .fav-btn`);
  if (btn) { btn.textContent=!current?'♥':'♡'; btn.classList.toggle('active',!current); }
  const dot = document.getElementById(`favdot-${CSS.escape(tk)}`);
  if (dot) { dot.textContent='♥'; dot.classList.toggle('visible',!current); }
  if (activeType==='favourites') applyFilters();
  refreshStats();
}

async function setStatusFromModal(status) {
  if (!currentModalTitle) return;
  const isTV = currentModalTitle.content_type === 'tv';
  const currentStatus = getEntry(currentModalTitle).status;

  // Block "Finished" for ongoing TV shows
  if (status === 'finished' && isTV) {
    const isOngoing = currentModalTitle.is_ongoing === 1 || currentModalTitle.is_ongoing === true;
    if (isOngoing) {
      showToast('This show is still ongoing — it can\'t be marked as Finished yet');
      return;
    }
  }

  // Clicking the already-active status clears it
  if (currentStatus === status) {
    if (status === 'finished' && isTV && allWatchedInMemory()) {
      await toggleAllWatched();
    }
    updateModalStatusBtns('not-started');
    await setStatus(currentModalTitle, 'not-started');
    return;
  }

  if (status === 'finished' && isTV) {
    updateModalStatusBtns('finished');
    await setStatus(currentModalTitle, 'finished');
    await toggleAllWatched();
    return;
  }

  updateModalStatusBtns(status);
  await setStatus(currentModalTitle, status);
}

// Returns true if every season we know about (from watchedSet) is fully watched.
// Works even before episodes are rendered — checks the in-memory watchedSet directly.
function allWatchedInMemory() {
  const seasonBlocks = [...document.querySelectorAll('#seasonsContent .season-block')];
  if (!seasonBlocks.length) return false;
  return seasonBlocks.every(block => {
    const seasonNum = parseInt(block.id.replace('sblock-', ''));
    return !!watchedSet[wSeasonKey(currentModalTitle.platform, currentModalTitle.title, seasonNum)];
  });
}

async function saveNotes() {
  if (!currentModalTitle) return;
  const notes = document.getElementById('notesInput').value;
  await syncLibrary(currentModalTitle, {notes});
  const msg = document.getElementById('notesSavedMsg');
  msg.style.opacity='1';
  setTimeout(()=>msg.style.opacity='0', 2000);
}

// ── Star rating ───────────────────────────────────────────────────────────────
function updateModalRating(rating) {
  document.querySelectorAll('.star-btn').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.v) <= rating);
  });
  const clearBtn = document.getElementById('mRatingClear');
  if (clearBtn) clearBtn.style.display = rating > 0 ? '' : 'none';
}

// Fill stars up-to-hovered on mouseenter, clear on container mouseleave
(function initStarHover() {
  const container = document.getElementById('mStarRating');
  if (!container) return;
  container.addEventListener('mouseover', e => {
    const btn = e.target.closest('.star-btn');
    const hv  = btn ? parseInt(btn.dataset.v) : 0;
    container.querySelectorAll('.star-btn').forEach(s => {
      s.classList.toggle('star-pre', parseInt(s.dataset.v) <= hv);
    });
  });
  container.addEventListener('mouseleave', () => {
    container.querySelectorAll('.star-btn').forEach(s => s.classList.remove('star-pre'));
  });
})();

async function setRatingFromModal(stars) {
  if (!currentModalTitle) return;
  const current = getEntry(currentModalTitle).user_rating || 0;
  const newRating = (stars === current) ? 0 : stars; // tap same star = clear
  await syncLibrary(currentModalTitle, {user_rating: newRating}, {loader: false});
  updateModalRating(newRating);
}

function toggleModalRegions(e) { /* legacy no-op */ }

let _modalSelectedRegion = null;  // currently selected region filter (null = all)
let _modalPreferredRegion = null;  // user/browser detected region (may not be in allRegions)
let _modalTitleRegions    = [];    // all regions this title is available in

/** Returns the 2-letter ISO country code from the browser's language setting. */
function _getBrowserRegion() {
  const lang = navigator.language || (navigator.languages && navigator.languages[0]) || '';
  const m = lang.match(/[-_]([A-Za-z]{2})$/);
  return m ? m[1].toUpperCase() : null;
}

function _buildModalPlatformUI(t) {
  const prMap = t.platform_regions;  // { netflix: ['US','GB',...], ... } or null
  const selectorEl = document.getElementById('mRegionSelector');
  const menuEl     = document.getElementById('mRegionMenu');

  if (!prMap) {
    // Fallback: no per-platform region data — just show platform pills, no region selector
    selectorEl.style.display = 'none';
    _modalTitleRegions    = [];
    _modalPreferredRegion = null;
    _renderModalPlatformPills(t, null);
    return;
  }

  // Collect all unique regions across all platforms, sorted by country name
  const allRegions = [...new Set(Object.values(prMap).flat())].sort((a, b) => {
    const na = typeof COUNTRY_NAMES !== 'undefined' ? (COUNTRY_NAMES[a] || a) : a;
    const nb = typeof COUNTRY_NAMES !== 'undefined' ? (COUNTRY_NAMES[b] || b) : b;
    return na.localeCompare(nb);
  });
  _modalTitleRegions = allRegions;

  // Determine smart default — priority: app region → browser locale → all
  const userRegion    = typeof activeRegion !== 'undefined' && activeRegion !== 'all' ? activeRegion : null;
  const browserRegion = _getBrowserRegion();
  const preferred     = userRegion || browserRegion || null;
  _modalPreferredRegion = preferred;

  let defaultRegion = null;
  if (preferred && allRegions.includes(preferred)) {
    defaultRegion = preferred;  // title is available in the user's region — pre-select it
  }
  // If preferred exists but title isn't in that region, defaultRegion stays null (all)
  // and _renderModalPlatformPills will display an unavailability note.

  _modalSelectedRegion = defaultRegion;

  const _flag  = typeof countryFlag === 'function' ? countryFlag : c => c;
  const _names = typeof COUNTRY_NAMES !== 'undefined' ? COUNTRY_NAMES : {};

  // Build region dropdown menu, pre-marking the active option
  menuEl.innerHTML =
    `<div class="modal-region-option${!defaultRegion ? ' active' : ''}" data-region="" onclick="setModalRegion('', event)">🌍 All regions</div>` +
    allRegions.map(r =>
      `<div class="modal-region-option${defaultRegion === r ? ' active' : ''}" data-region="${r}" onclick="setModalRegion('${r}', event)">${_flag(r)}<span>${_names[r] || r}</span></div>`
    ).join('');

  selectorEl.style.display = '';
  _updateModalRegionBtn();
  _renderModalPlatformPills(t, defaultRegion);
}

function _updateModalRegionBtn() {
  const btn = document.getElementById('mRegionBtn');
  if (!btn) return;
  const r = _modalSelectedRegion;
  if (!r) {
    btn.textContent = '🌍 All regions ▾';
  } else {
    const _names = typeof COUNTRY_NAMES !== 'undefined' ? COUNTRY_NAMES : {};
    const _flag  = typeof countryFlag === 'function' ? countryFlag : c => c;
    btn.innerHTML = `${_flag(r)}<span>${_names[r] || r}</span> ▾`;
  }
}

function setModalRegion(region, e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('mRegionMenu');
  // If no region passed (button click), toggle the menu open/closed
  if (region === null) {
    menu && menu.classList.toggle('open');
    return;
  }
  // Region option clicked — select it
  _modalSelectedRegion = region || null;
  menu && menu.classList.remove('open');
  // Highlight active option
  menu && menu.querySelectorAll('.modal-region-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.region === (region || ''));
  });
  _updateModalRegionBtn();
  _renderModalPlatformPills(currentModalTitle, _modalSelectedRegion);
}

// Per-platform search URL builders (used to make platform pills clickable)
const PLATFORM_WATCH_URLS = {
  netflix:        q => `https://www.netflix.com/search?q=${encodeURIComponent(q)}`,
  disney_plus:    q => `https://www.disneyplus.com/search/${encodeURIComponent(q)}`,
  hbo_max:        q => `https://play.max.com/search?q=${encodeURIComponent(q)}`,
  apple_tv:       q => `https://tv.apple.com/search?term=${encodeURIComponent(q)}`,
  prime_video:    q => `https://www.amazon.com/s?k=${encodeURIComponent(q)}&i=prime-instant-video`,
  hulu:           q => `https://www.hulu.com/search?q=${encodeURIComponent(q)}`,
  peacock:        q => `https://www.peacocktv.com/search?q=${encodeURIComponent(q)}`,
  paramount_plus: q => `https://www.paramountplus.com/search?query=${encodeURIComponent(q)}`,
};

function _renderModalPlatformPills(t, region) {
  const el = document.getElementById('mPlatformPills');
  if (!el) return;
  const prMap = t && t.platform_regions;
  const _flag  = typeof countryFlag  === 'function' ? countryFlag  : c => c;
  const _names = typeof COUNTRY_NAMES !== 'undefined' ? COUNTRY_NAMES : {};

  // Helper: human-readable region label with flag
  const regionLabel = r => r ? `${_flag(r)} ${_names[r] || r}` : '';

  let platforms;
  if (prMap) {
    platforms = region
      ? Object.entries(prMap).filter(([, regions]) => regions.includes(region)).map(([p]) => p)
      : Object.keys(prMap);
  } else {
    platforms = (t.platforms || t.platform || '').split(',').map(p => p.trim()).filter(Boolean);
  }

  if (!platforms.length) {
    // User selected a specific region that has no platforms → direct unavailability message
    const label = regionLabel(region);
    el.innerHTML = `<span class="modal-unavail-note">Not available in ${label || 'this region'}</span>`;
    return;
  }

  // Title is available → render pills (as <a> links when a search URL is known)
  const titleQ = t ? t.title : '';
  let html = platforms.map(p => {
    const urlFn = PLATFORM_WATCH_URLS[p];
    if (urlFn) {
      const href = escAttr(urlFn(titleQ));
      return `<a class="modal-platform-pill ${p}" href="${href}" target="_blank" rel="noopener noreferrer">${platLogo(p)}<span>${formatPlatform(p)}</span></a>`;
    }
    return `<span class="modal-platform-pill ${p}">${platLogo(p)}<span>${formatPlatform(p)}</span></span>`;
  }).join('');

  // If we auto-selected "all regions" because the preferred region isn't available,
  // show a subtle note so the user understands why their region isn't pre-selected.
  if (!region && _modalPreferredRegion && _modalTitleRegions.length &&
      !_modalTitleRegions.includes(_modalPreferredRegion)) {
    const label = regionLabel(_modalPreferredRegion);
    html = `<span class="modal-unavail-note">Not available in ${label} — showing all regions</span>` + html;
  }

  el.innerHTML = html;
}

// Close region menu when clicking outside
document.addEventListener('click', () => {
  const menu = document.getElementById('mRegionMenu');
  if (menu) menu.classList.remove('open');
});

function closeModal(e) { /* no-op kept for compatibility */ }
function closeModalDirect() {
  // If there's a page to go back to, go there instead of just closing
  const prev = navStack.pop();
  if (prev) {
    document.getElementById('overlay').classList.remove('open');
    episodeFetchedSeasons.clear();
    // Re-open previous page without pushing to stack again
    if (prev.type === 'actor') {
      document.getElementById('actorOverlay').classList.add('open');
    }
    return;
  }
  document.getElementById('overlay').classList.remove('open');
  document.body.style.overflow = '';
  episodeFetchedSeasons.clear();
}
document.addEventListener('keydown', e=>{
  if (e.key==='Escape') {
    if (document.getElementById('actorOverlay').classList.contains('open')) closeActorModalDirect();
    else if (document.getElementById('overlay').classList.contains('open')) closeModalDirect();
  }
});

// ── Genre filters ──────────────────────────────────────────────────────────────
function buildGenreFilter() {
  const gs=new Set();
  allTitles.forEach(t=>{if(t.genre&&t.genre!=='Unknown')t.genre.split(',').forEach(g=>{const s=g.trim();if(s)gs.add(s);});});
  const menu=document.getElementById('genreDropdownMenu');
  menu.innerHTML=`<div class="genre-clear"><button onclick="clearGenres()">Clear all</button></div>`;
  [...gs].sort().forEach(genre=>{
    const el=document.createElement('div'); el.className='genre-option'+(activeGenres.has(genre)?' checked':'');
    el.innerHTML=`<span class="genre-checkbox"></span>${formatGenre(genre)}`; el.onclick=()=>toggleGenre(genre,el);
    menu.appendChild(el);
  }); updateGenreBtn();
}
function toggleGenre(genre,el){if(activeGenres.has(genre)){activeGenres.delete(genre);el.classList.remove('checked');}else{activeGenres.add(genre);el.classList.add('checked');}updateGenreBtn();applyFilters();}
function clearGenres(){activeGenres.clear();document.querySelectorAll('#genreDropdownMenu .genre-option').forEach(e=>e.classList.remove('checked'));updateGenreBtn();applyFilters();}
function updateGenreBtn(){const b=document.getElementById('genreDropdownBtn');if(activeGenres.size===0)b.textContent='All Genres ▾';else if(activeGenres.size===1)b.textContent=formatGenre([...activeGenres][0])+' ▾';else b.textContent=`${activeGenres.size} Genres ▾`;}
function toggleGenreDropdown(e){e.stopPropagation();const btn=e.currentTarget;const menu=document.getElementById('genreDropdownMenu');const r=btn.getBoundingClientRect();const bottomGap=window.innerWidth<=768?70:8;menu.style.top=r.bottom+'px';menu.style.maxHeight=Math.max(120,window.innerHeight-r.bottom-bottomGap)+'px';document.querySelectorAll('.genre-dropdown-menu.open').forEach(m=>{if(m!==menu)m.classList.remove('open');});document.querySelectorAll('.sort-select.dropdown-open').forEach(b=>{if(b!==btn)b.classList.remove('dropdown-open');});menu.classList.toggle('open');btn.classList.toggle('dropdown-open',menu.classList.contains('open'));if(!menu.classList.contains('open'))btn.blur();}

// ── Votes dropdown ────────────────────────────────────────────────────────────
function toggleVotesDropdown(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const menu = document.getElementById('votesDropdownMenu');
  const r = btn.getBoundingClientRect();
  const bottomGap = window.innerWidth <= 768 ? 70 : 8;
  menu.style.top = r.bottom + 'px';
  menu.style.maxHeight = Math.max(120, window.innerHeight - r.bottom - bottomGap) + 'px';
  document.querySelectorAll('.genre-dropdown-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
  document.querySelectorAll('.sort-select.dropdown-open').forEach(b => { if (b !== btn) b.classList.remove('dropdown-open'); });
  menu.classList.toggle('open');
  btn.classList.toggle('dropdown-open', menu.classList.contains('open'));
  if (!menu.classList.contains('open')) btn.blur();
}
function setVotesFilter(val, label, el) {
  activeVotes = val;
  // Update radio-style check
  const opts = document.querySelectorAll('#votesDropdownMenu .genre-option');
  opts.forEach(o => o.classList.remove('checked'));
  if (el) {
    el.classList.add('checked');
  } else {
    // Find option by onclick value (called programmatically, e.g. clearAllFilters)
    opts.forEach(o => { if (o.getAttribute('onclick')?.includes(`(${val},`)) o.classList.add('checked'); });
  }
  const btn = document.getElementById('votesDropdownBtn');
  if (btn) btn.textContent = (val === 0 ? 'Any votes' : label) + ' ▾';
  document.getElementById('votesDropdownMenu')?.classList.remove('open');
  applyFilters();
}

// ── Sort dropdown ─────────────────────────────────────────────────────────────
function toggleSortDropdown(e) {
  e.stopPropagation();
  const btn = e.currentTarget;
  const menu = document.getElementById('sortDropdownMenu');
  const r = btn.getBoundingClientRect();
  const bottomGap = window.innerWidth <= 768 ? 70 : 8;
  menu.style.top = r.bottom + 'px';
  menu.style.maxHeight = Math.max(120, window.innerHeight - r.bottom - bottomGap) + 'px';
  document.querySelectorAll('.genre-dropdown-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
  document.querySelectorAll('.sort-select.dropdown-open').forEach(b => { if (b !== btn) b.classList.remove('dropdown-open'); });
  menu.classList.toggle('open');
  btn.classList.toggle('dropdown-open', menu.classList.contains('open'));
  if (!menu.classList.contains('open')) btn.blur();
}
function setSortFilter(val, label, el) {
  activeSort = val;
  document.querySelectorAll('#sortDropdownMenu .genre-option').forEach(o => o.classList.remove('checked'));
  if (el) el.classList.add('checked');
  const btn = document.getElementById('sortDropdownBtn');
  if (btn) btn.textContent = label + ' ▾';
  document.getElementById('sortDropdownMenu').classList.remove('open');
  applyFilters();
}

function buildExcludeFilter(){
  const gs=new Set();
  allTitles.forEach(t=>{if(t.genre&&t.genre!=='Unknown')t.genre.split(',').forEach(g=>{const s=g.trim();if(s)gs.add(s);});});
  const menu=document.getElementById('genreExcludeMenu');
  menu.innerHTML=`<div class="genre-clear"><button onclick="clearExcluded()">Clear all</button></div>`;
  [...gs].sort().forEach(genre=>{
    const el=document.createElement('div'); el.className='genre-option'+(excludedGenres.has(genre)?' checked':'');
    el.innerHTML=`<span class="genre-checkbox"></span>${formatGenre(genre)}`; el.onclick=()=>toggleExclude(genre,el);
    menu.appendChild(el);
  }); updateExcludeBtn();
}
function toggleExclude(genre,el){if(excludedGenres.has(genre)){excludedGenres.delete(genre);el.classList.remove('checked');}else{excludedGenres.add(genre);el.classList.add('checked');}updateExcludeBtn();applyFilters();}
function clearExcluded(){excludedGenres.clear();document.querySelectorAll('#genreExcludeMenu .genre-option').forEach(e=>e.classList.remove('checked'));updateExcludeBtn();applyFilters();}
function updateExcludeBtn(){const b=document.getElementById('genreExcludeBtn');if(excludedGenres.size===0){b.textContent='Exclude Genres ▾';b.style.color='';b.style.borderColor='';}else if(excludedGenres.size===1){b.textContent='✕ '+formatGenre([...excludedGenres][0])+' ▾';b.style.color='var(--accent2)';b.style.borderColor='var(--accent2)';}else{b.textContent=`✕ ${excludedGenres.size} Genres ▾`;b.style.color='var(--accent2)';b.style.borderColor='var(--accent2)';}}
function toggleExcludeDropdown(e){e.stopPropagation();const btn=e.currentTarget;const menu=document.getElementById('genreExcludeMenu');const r=btn.getBoundingClientRect();const bottomGap=window.innerWidth<=768?70:8;menu.style.top=r.bottom+'px';menu.style.maxHeight=Math.max(120,window.innerHeight-r.bottom-bottomGap)+'px';document.querySelectorAll('.genre-dropdown-menu.open').forEach(m=>{if(m!==menu)m.classList.remove('open');});document.querySelectorAll('.sort-select.dropdown-open').forEach(b=>{if(b!==btn)b.classList.remove('dropdown-open');});menu.classList.toggle('open');btn.classList.toggle('dropdown-open',menu.classList.contains('open'));if(!menu.classList.contains('open'))btn.blur();}
document.addEventListener('click',(e)=>{
  if(!document.getElementById('genreDropdown').contains(e.target)) { document.getElementById('genreDropdownMenu').classList.remove('open'); document.getElementById('genreDropdownBtn')?.classList.remove('dropdown-open'); }
  if(!document.getElementById('genreExcludeDropdown').contains(e.target)) { document.getElementById('genreExcludeMenu').classList.remove('open'); document.getElementById('genreExcludeBtn')?.classList.remove('dropdown-open'); }
  const rd = document.getElementById('regionDropdown');
  if(rd && !rd.contains(e.target)) { document.getElementById('regionDropdownMenu')?.classList.remove('open'); document.getElementById('regionDropdownBtn')?.classList.remove('dropdown-open'); }
  const vd = document.getElementById('votesDropdown');
  if(vd && !vd.contains(e.target)) { document.getElementById('votesDropdownMenu')?.classList.remove('open'); document.getElementById('votesDropdownBtn')?.classList.remove('dropdown-open'); }
  const sd = document.getElementById('sortDropdown');
  if(sd && !sd.contains(e.target)) { document.getElementById('sortDropdownMenu')?.classList.remove('open'); document.getElementById('sortDropdownBtn')?.classList.remove('dropdown-open'); }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatPlatform(p){return{netflix:'Netflix',disney_plus:'Disney+',hbo_max:'Max (HBO)',apple_tv:'Apple TV+',prime_video:'Prime Video',hulu:'Hulu',peacock:'Peacock',paramount_plus:'Paramount+'}[p]||p;}
function fmtVotes(n){if(!n)return'';if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1000)return(n/1000).toFixed(0)+'K';return n.toString();}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function escAttr(s){return String(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function jsEsc(s){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}

// ── Sidebar toggle ───────────────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const btn     = document.getElementById('sidebarToggle');
  const collapsed = sidebar.classList.toggle('collapsed');
  btn.title = collapsed ? 'Show scraper panel' : 'Hide scraper panel';
  btn.textContent = collapsed ? '▶' : '☰';
}

// ── Background episode-runtime backfill ──────────────────────────────────────
// For each show with watched episodes that still have runtime_mins=0, fetches
// per-episode runtimes from TMDB and saves them via PATCH /api/watched/backfill.
// Called once after initial load from catalog.js prefetchLibraryRuntimes().
async function prefetchEpisodeRuntimes() {
  const noLoad = {loader: false};

  // 1. Get all watched episodes for this user
  const watchedData = await api('GET', '/api/watched', null, noLoad).catch(() => null);
  if (!watchedData?.watched?.length) return;

  // Group by show → season → set of watched episode numbers
  const showMap = {};  // "platform::title" -> { platform, title, seasons: { sn: Set<ep_num> } }
  for (const w of watchedData.watched) {
    if (w.item_type !== 'episode') continue;
    const k = `${w.platform}::${w.title}`;
    if (!showMap[k]) showMap[k] = { platform: w.platform, title: w.title, seasons: {} };
    const sn = w.season_num;
    if (!showMap[k].seasons[sn]) showMap[k].seasons[sn] = new Set();
    showMap[k].seasons[sn].add(w.episode_num);
  }

  const shows = Object.values(showMap);
  if (!shows.length) return;

  const updates = [];

  for (const show of shows) {
    try {
      // Find TMDB id (reuse cache if already fetched by prefetchLibraryRuntimes)
      const qs = new URLSearchParams({query: show.title, type: 'tv'});
      const t  = allTitles?.find(x => x.platform === show.platform &&
                   x.title.toLowerCase() === show.title.toLowerCase());
      if (t?.release_year) qs.set('year', t.release_year);
      const sr = await api('GET', `/api/tmdb/search?${qs}`, null, noLoad);
      const id = sr?.results?.[0]?.id;
      if (!id) { continue; }

      // Fetch each season that has watched episodes
      for (const [snStr, watchedEps] of Object.entries(show.seasons)) {
        const seasonNum = parseInt(snStr);
        const data = await api('GET', `/api/tmdb/tv/${id}/season/${seasonNum}`, null, noLoad);
        if (!data?.episodes?.length) continue;

        // Sum runtimes only for the episodes we actually watched
        let seasonRuntime = 0;
        for (const ep of data.episodes) {
          if (ep.runtime && watchedEps.has(ep.episode_number)) {
            seasonRuntime += ep.runtime;
          }
        }

        if (seasonRuntime > 0) {
          updates.push({
            platform:    show.platform,
            title:       show.title,
            season_num:  seasonNum,
            runtime_mins: seasonRuntime,
          });
        }
        await new Promise(r => setTimeout(r, 150)); // gentle rate spacing per season
      }
    } catch (e) { /* silent */ }
  }

  if (!updates.length) { return; }

  // Send in chunks of 100
  const CHUNK = 100;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await api('PATCH', '/api/watched/backfill',
      {updates: updates.slice(i, i + CHUNK)}, noLoad).catch(() => null);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  // Show loader immediately so nothing is visible while the session check is in flight.
  showGlobalLoader();
  const data = await api('GET', '/api/auth/me');
  if (data?.authenticated) {
    hideAuth();
    document.getElementById('usernameDisplay').textContent = data.username;
    if (data.setup_required) {
      // New Google user — must confirm a username before entering the app
      hideGlobalLoader();
      openSetupOverlay(data.username);
    } else {
      await loadApp(); // loadApp manages its own showGlobalLoader / hideGlobalLoader
    }
  } else {
    hideGlobalLoader();
    showAuth();
  }
});