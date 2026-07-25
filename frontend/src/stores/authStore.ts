import { create } from 'zustand';
import {
  type UserResponse,
  loginApi,
  registerApi,
  getMeApi,
  getStoredToken,
  logout as apiLogout,
} from '../services/authApi';

interface AuthState {
  user: UserResponse | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname?: string) => Promise<void>;
  logout: () => void;
  initialize: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: getStoredToken(),
  isAuthenticated: false,
  isLoading: true, // Start loading until initialize() validates token

  login: async (email: string, password: string) => {
    const data = await loginApi({ email, password });
    set({
      token: data.access_token,
      user: {
        id: data.user_id,
        email: data.email,
        nickname: data.nickname,
        is_active: true,
        is_superuser: data.is_superuser ?? false,
        created_at: '',
      },
      isAuthenticated: true,
    });
  },

  register: async (email: string, password: string, nickname?: string) => {
    const data = await registerApi({ email, password, nickname });
    set({
      token: data.access_token,
      user: {
        id: data.user_id,
        email: data.email,
        nickname: data.nickname,
        is_active: true,
        is_superuser: data.is_superuser ?? false,
        created_at: '',
      },
      isAuthenticated: true,
    });
  },

  logout: () => {
    set({ user: null, token: null, isAuthenticated: false });
    apiLogout();
  },

  initialize: async () => {
    const token = get().token;
    if (!token) {
      set({ isLoading: false });
      return;
    }
    try {
      const user = await getMeApi();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      // Token expired or invalid — clear and continue
      set({ user: null, token: null, isAuthenticated: false, isLoading: false });
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    }
  },
}));
