import api from './api';
import { setStoredToken, setStoredUser, clearStoredToken, clearStoredUser } from './tokenStorage';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  nickname?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  email: string;
  nickname: string | null;
  is_superuser: boolean;
}

export interface UserResponse {
  id: string;
  email: string;
  nickname: string | null;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
}

// ── Re-export token helpers for convenience (actual impl in tokenStorage) ──
export {
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  getStoredUser,
  setStoredUser,
  clearStoredUser,
} from './tokenStorage';

// ── API calls ──

export async function loginApi(body: LoginRequest): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>('/auth/login', body);
  setStoredToken(data.access_token);
  setStoredUser({
    id: data.user_id,
    email: data.email,
    nickname: data.nickname,
    is_active: true,
    is_superuser: data.is_superuser ?? false,
    created_at: '',
  });
  return data;
}

export async function registerApi(body: RegisterRequest): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>('/auth/register', body);
  setStoredToken(data.access_token);
  setStoredUser({
    id: data.user_id,
    email: data.email,
    nickname: data.nickname,
    is_active: true,
    is_superuser: data.is_superuser ?? false,
    created_at: '',
  });
  return data;
}

export async function getMeApi(): Promise<UserResponse> {
  const { data } = await api.get<UserResponse>('/auth/me');
  setStoredUser(data);
  return data;
}

export function logout(): void {
  clearStoredToken();
  clearStoredUser();
  window.location.href = '/login';
}
