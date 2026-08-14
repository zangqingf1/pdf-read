import api from './api';
import {
  setStoredToken,
  setStoredUser,
  getStoredUser,
  clearStoredToken,
  clearStoredUser,
} from './tokenStorage';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  password_confirm: string;
  verification_code: string;
  nickname?: string;
}

export interface SendCodeRequest {
  email: string;
  purpose: 'register' | 'reset_password';
}

export interface SendCodeResponse {
  message: string;
  cooldown_seconds: number;
  /** 仅开发环境（未配置 SMTP）返回，用于离线调试 */
  dev_code?: string;
}

export interface ResetPasswordConfirmRequest {
  email: string;
  code: string;
  new_password: string;
  password_confirm: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  email: string;
  nickname: string | null;
  avatar_url: string | null;
  is_superuser: boolean;
}

export interface UserResponse {
  id: string;
  email: string;
  nickname: string | null;
  avatar_url: string | null;
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

// ── Helpers ──

/** 头像图片地址（后端鉴权无关，公开端点） */
export function avatarUrl(userId: string): string {
  return `/api/v1/auth/avatar/${userId}`;
}

function mapToken(data: TokenResponse): void {
  setStoredToken(data.access_token);
  setStoredUser({
    id: data.user_id,
    email: data.email,
    nickname: data.nickname,
    avatar_url: data.avatar_url ?? null,
    is_active: true,
    is_superuser: data.is_superuser ?? false,
    created_at: '',
  });
}

// ── API calls ──

export async function sendVerificationCodeApi(body: SendCodeRequest): Promise<SendCodeResponse> {
  const { data } = await api.post<SendCodeResponse>('/auth/verification-code/send', body);
  return data;
}

export async function loginApi(body: LoginRequest): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>('/auth/login', body);
  mapToken(data);
  return data;
}

export async function registerApi(body: RegisterRequest): Promise<TokenResponse> {
  const { data } = await api.post<TokenResponse>('/auth/register', body);
  mapToken(data);
  return data;
}

export async function resetPasswordSendApi(body: SendCodeRequest): Promise<SendCodeResponse> {
  const { data } = await api.post<SendCodeResponse>('/auth/password-reset/send', body);
  return data;
}

export async function resetPasswordConfirmApi(body: ResetPasswordConfirmRequest): Promise<{ message: string }> {
  const { data } = await api.post<{ message: string }>('/auth/password-reset/confirm', body);
  return data;
}

export async function getMeApi(): Promise<UserResponse> {
  const { data } = await api.get<UserResponse>('/auth/me');
  setStoredUser(data);
  return data;
}

export async function updateProfileApi(body: { nickname?: string | null }): Promise<UserResponse> {
  const { data } = await api.put<UserResponse>('/auth/profile', body);
  setStoredUser(data);
  return data;
}

export async function uploadAvatarApi(file: File): Promise<UserResponse> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<UserResponse>('/auth/avatar', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  setStoredUser(data);
  return data;
}

export async function removeAvatarApi(): Promise<{ message: string }> {
  const { data } = await api.delete<{ message: string }>('/auth/avatar');
  // 刷新本地用户信息（清掉 avatar_url）
  const stored = getStoredUser();
  if (stored) {
    setStoredUser({ ...stored, avatar_url: null });
  }
  return data;
}

export function logout(): void {
  clearStoredToken();
  clearStoredUser();
  window.location.href = '/login';
}
