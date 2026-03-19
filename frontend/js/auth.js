// ── Auth ─────────────────────────────────────────────────────────────────────
let _authMode = 'login'; // 'login' | 'register'

function showAuth() {
  document.getElementById('authScreen').classList.remove('hidden');
  document.getElementById('appLayout').style.display = 'none';
  switchAuthMode('login');
}
function hideAuth() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appLayout').style.display = 'flex';
}

function switchAuthMode(mode) {
  _authMode = mode;
  const err = document.getElementById('authError');
  err.textContent = '';

  const loginBtn  = document.getElementById('authModeLogin');
  const regBtn    = document.getElementById('authModeRegister');
  const nameField = document.getElementById('authDisplayNameField');
  const confField = document.getElementById('authConfirmField');
  const submitBtn = document.getElementById('authBtn');
  const subText   = document.getElementById('authSub');

  if (mode === 'register') {
    loginBtn.classList.remove('active');
    regBtn.classList.add('active');
    nameField.style.display = '';
    confField.style.display = '';
    submitBtn.textContent = 'Create Account';
    subText.textContent = 'Create an account to start tracking your watch history.';
  } else {
    regBtn.classList.remove('active');
    loginBtn.classList.add('active');
    nameField.style.display = 'none';
    confField.style.display = 'none';
    submitBtn.textContent = 'Sign In';
    subText.textContent = 'Sign in to access your personalised streaming dashboard.';
  }
}

function doAuthSubmit() {
  if (_authMode === 'register') doRegister();
  else doLogin();
}

async function doLogin() {
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value.trim();
  const btn      = document.getElementById('authBtn');
  const err      = document.getElementById('authError');
  if (!username || !password) { err.textContent = 'Please enter username and password.'; return; }
  btn.disabled = true; btn.textContent = 'Signing in…'; err.textContent = '';
  showGlobalLoader();
  const data = await fetch('/api/auth/login', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    credentials: 'same-origin', body: JSON.stringify({username, password})
  }).then(r => r.json()).catch(() => ({}));
  hideGlobalLoader();
  btn.disabled = false; btn.textContent = 'Sign In';
  if (data.ok) {
    hideAuth();
    document.getElementById('usernameDisplay').textContent = data.username;
    const initial = document.getElementById('headerAvatarInitial');
    if (initial) initial.textContent = (data.username || '?')[0].toUpperCase();
    await loadApp();
  } else {
    err.textContent = data.error || 'Login failed.';
  }
}

async function doRegister() {
  const username    = document.getElementById('authUsername').value.trim();
  const password    = document.getElementById('authPassword').value.trim();
  const confirmPw   = document.getElementById('authConfirmPassword').value.trim();
  const displayName = document.getElementById('authDisplayName').value.trim();
  const btn         = document.getElementById('authBtn');
  const err         = document.getElementById('authError');

  if (!username || !password) { err.textContent = 'Please enter username and password.'; return; }
  if (password.length < 6)    { err.textContent = 'Password must be at least 6 characters.'; return; }
  if (password !== confirmPw)  { err.textContent = 'Passwords do not match.'; return; }

  btn.disabled = true; btn.textContent = 'Creating account…'; err.textContent = '';
  showGlobalLoader();
  const body = { username, password };
  if (displayName) body.display_name = displayName;
  const data = await fetch('/api/auth/register', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    credentials: 'same-origin', body: JSON.stringify(body)
  }).then(r => r.json()).catch(() => ({}));
  hideGlobalLoader();
  btn.disabled = false; btn.textContent = 'Create Account';
  if (data.ok) {
    hideAuth();
    document.getElementById('usernameDisplay').textContent = data.username;
    const initial = document.getElementById('headerAvatarInitial');
    if (initial) initial.textContent = (data.username || '?')[0].toUpperCase();
    await loadApp();
  } else {
    err.textContent = data.error || 'Registration failed.';
  }
}

async function doGoogleLogin() {
  const btn = document.getElementById('googleBtn');
  const err = document.getElementById('authError');
  btn.disabled = true;
  btn.textContent = 'Redirecting to Google…';
  err.textContent = '';
  
  try {
    showGlobalLoader();
    const response = await fetch('/api/auth/google-init');
    const data = await response.json();
    hideGlobalLoader();
    if (data.auth_url) {
      window.location.href = data.auth_url;
    } else {
      err.textContent = data.error || 'Failed to initiate Google login.';
      btn.disabled = false;
      btn.textContent = 'Sign in with Google';
    }
  } catch (e) {
    err.textContent = 'Failed to initiate Google login.';
    btn.disabled = false;
    btn.textContent = 'Sign in with Google';
  }
}

// Clean up query params after Google OAuth
function checkOAuthToken() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('token')) {
    params.delete('token');
    const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState({}, document.title, newUrl);
  }
}

async function doLogout() {
  showGlobalLoader();
  await api('POST', '/api/auth/logout', null, {loader:true});
  hideGlobalLoader();
  showAuth();
  allTitles = []; libraryMap = {};
  document.getElementById('log').innerHTML = '<div class="log-line" style="color:var(--muted)">Waiting to run…</div>';
}

// Allow Enter key on auth form fields
document.getElementById('authPassword').addEventListener('keydown', e => { if (e.key === 'Enter') doAuthSubmit(); });
document.getElementById('authUsername').addEventListener('keydown', e => { if (e.key === 'Enter') doAuthSubmit(); });
document.getElementById('authConfirmPassword').addEventListener('keydown', e => { if (e.key === 'Enter') doAuthSubmit(); });
document.getElementById('authDisplayName').addEventListener('keydown', e => { if (e.key === 'Enter') doAuthSubmit(); });

// ── Google account setup overlay ─────────────────────────────────────────────
function openSetupOverlay(suggestedUsername) {
  document.getElementById('setupScreen').classList.remove('hidden');
  const input = document.getElementById('setupUsernameInput');
  if (input) {
    input.value = suggestedUsername || '';
    setTimeout(() => input.focus(), 60);
  }
}

async function onSetupPicChange(event) {
  const file = event.target.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const dataUrl = await _resizeImage(file, 400);
  const img = document.getElementById('setupAvatarImg');
  const svg = document.querySelector('#setupAvatarEl svg');
  img.src = dataUrl;
  img.style.display = 'block';
  if (svg) svg.style.display = 'none';
}

async function submitSetup() {
  const input  = document.getElementById('setupUsernameInput');
  const errEl  = document.getElementById('setupError');
  const btn    = document.getElementById('setupSubmitBtn');
  const username = (input.value || '').trim();

  errEl.textContent = '';
  if (!username) { errEl.textContent = 'Please enter a username.'; return; }
  if (username.length < 3) { errEl.textContent = 'Must be at least 3 characters.'; return; }
  if (username.length > 30) { errEl.textContent = 'Must be 30 characters or fewer.'; return; }

  btn.disabled = true; btn.textContent = 'Saving…';

  const body = { username };
  const img = document.getElementById('setupAvatarImg');
  if (img && img.style.display !== 'none' && img.src.startsWith('data:')) {
    body.profile_pic = img.src;
  }

  const res = await api('POST', '/api/profile', body).catch(() => null);
  btn.disabled = false; btn.textContent = 'Get started →';

  if (res?.ok) {
    document.getElementById('setupScreen').classList.add('hidden');
    document.getElementById('usernameDisplay').textContent = username;
    const initial = document.getElementById('headerAvatarInitial');
    if (initial) initial.textContent = username[0].toUpperCase();
    if (body.profile_pic && typeof loadHeaderAvatar === 'function') loadHeaderAvatar();
    showGlobalLoader();
    await loadApp();
  } else {
    errEl.textContent = res?.error || 'Could not save. Please try again.';
  }
}

// ── Change password ──────────────────────────────────────────────────────────
async function doChangePassword() {
  const oldPw    = document.getElementById('cpwOldPassword').value.trim();
  const newPw    = document.getElementById('cpwNewPassword').value.trim();
  const confirmPw = document.getElementById('cpwConfirmPassword').value.trim();
  const btn      = document.getElementById('cpwBtn');
  const err      = document.getElementById('cpwError');

  err.textContent = '';
  if (!oldPw || !newPw) { err.textContent = 'Both passwords are required.'; return; }
  if (newPw.length < 6) { err.textContent = 'New password must be at least 6 characters.'; return; }
  if (newPw !== confirmPw) { err.textContent = 'New passwords do not match.'; return; }

  btn.disabled = true; btn.textContent = 'Updating…';
  const data = await api('POST', '/api/auth/change-password', { old_password: oldPw, new_password: newPw }).catch(() => null);
  btn.disabled = false; btn.textContent = 'Update Password';
  if (data?.ok) {
    document.getElementById('cpwOldPassword').value = '';
    document.getElementById('cpwNewPassword').value = '';
    document.getElementById('cpwConfirmPassword').value = '';
    showToast('Password updated');
  } else {
    err.textContent = data?.error || 'Failed to change password.';
  }
}

// Run cleanup & load on page load
window.addEventListener('DOMContentLoaded', checkOAuthToken);
