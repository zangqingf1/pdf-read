/** Token/user storage helpers — separate file to avoid circular imports with api.ts */

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

// 内存缓存：api 拦截器每次请求同步读 localStorage → 热路径改读内存。
let _tokenCache: string | null = null;
let _tokenLoaded = false;

export function getStoredToken(): string | null {
  if (!_tokenLoaded) {
    _tokenCache = localStorage.getItem(TOKEN_KEY);
    _tokenLoaded = true;
  }
  return _tokenCache;
}

export function setStoredToken(token: string): void {
  _tokenCache = token;
  _tokenLoaded = true;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  _tokenCache = null;
  _tokenLoaded = true;
  localStorage.removeItem(TOKEN_KEY);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY) {
      _tokenCache = e.newValue;
      _tokenLoaded = true;
    }
  });
}

export interface StoredUser {
  id: string;
  email: string;
  nickname: string | null;
  avatar_url: string | null;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
}

export function getStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: StoredUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredUser(): void {
  localStorage.removeItem(USER_KEY);
}
