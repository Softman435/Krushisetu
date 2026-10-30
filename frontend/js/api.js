/**
 * KrushiSetu frontend API client.
 * - Stores the short-lived access token in memory + sessionStorage (NOT
 *   localStorage, to reduce persistent-XSS exfiltration risk).
 * - The refresh token itself lives only in an httpOnly cookie set by the
 *   server; JS never touches it directly.
 * - Automatically retries a request once after refreshing an expired
 *   access token.
 */
const API_BASE_URL = 'http://localhost:5000/api';
const Auth = {
  getToken() {
    return sessionStorage.getItem('ks_access_token');
  },
  setToken(token) {
    sessionStorage.setItem('ks_access_token', token);
  },
  clearToken() {
    sessionStorage.removeItem('ks_access_token');
    sessionStorage.removeItem('ks_user');
  },
  getUser() {
    const raw = sessionStorage.getItem('ks_user');
    return raw ? JSON.parse(raw) : null;
  },
  setUser(user) {
    sessionStorage.setItem('ks_user', JSON.stringify(user));
  },
  isLoggedIn() {
    return !!this.getToken();
  },
  requireRole(role, redirectTo = 'login.html') {
    const user = this.getUser();
    if (!this.isLoggedIn() || !user || user.role !== role) {
      window.location.href = redirectTo;
    }
    return user;
  },
  logoutRedirect(page = 'login.html') {
    this.clearToken();
    window.location.href = page;
  },
};

async function apiRequest(path, { method = 'GET', body, isRetry = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = Auth.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include', // send the httpOnly refresh cookie
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = { success: false, message: 'Unexpected server response.' };
  }

  // Access token expired — try a silent refresh once, then retry.
  if (res.status === 401 && !isRetry && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return apiRequest(path, { method, body, isRetry: true });
    }
  }

  if (!res.ok) {
    const err = new Error(data.message || 'Something went wrong.');
    err.status = res.status;
    err.errors = data.errors;
    throw err;
  }
  return data;
}

async function tryRefreshToken() {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const data = await res.json();
    Auth.setToken(data.data.accessToken);
    Auth.setUser(data.data.user);
    return true;
  } catch {
    return false;
  }
}

const api = {
  get: (path) => apiRequest(path, { method: 'GET' }),
  post: (path, body) => apiRequest(path, { method: 'POST', body }),
  put: (path, body) => apiRequest(path, { method: 'PUT', body }),
  patch: (path, body) => apiRequest(path, { method: 'PATCH', body }),
  delete: (path) => apiRequest(path, { method: 'DELETE' }),
};

/** Renders {field, message} validation errors returned by express-validator
 * next to their inputs, and any top-level message in the given alert box. */
function renderFormErrors(errors, alertEl) {
  document.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
  if (!errors) return;
  errors.forEach(({ field, message }) => {
    const el = document.querySelector(`[data-error-for="${field}"]`);
    if (el) el.textContent = message;
    else if (alertEl) alertEl.textContent = message;
  });
}

function showAlert(el, message, type = 'error') {
  el.textContent = message;
  el.className = `alert alert-${type}`;
  el.style.display = 'block';
}
function hideAlert(el) {
  el.style.display = 'none';
}
