/** Token/user storage helpers — separate file to avoid circular imports with api.ts */

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface StoredUser {
  id: string;
  email: string;
  nickname: string | null;
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
