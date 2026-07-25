import axios from 'axios';
import { getStoredToken, clearStoredToken, clearStoredUser } from './tokenStorage';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Request interceptor: attach JWT Bearer token ──
api.interceptors.request.use(
  (config) => {
    const token = getStoredToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor: handle 401 unauthorized ──
api.interceptors.response.use(
  (response) => {
    // FastAPI returns data directly (not wrapped), so pass through
    return response;
  },
  (error) => {
    if (error.response) {
      const { status, data } = error.response;

      // Auto-redirect to login on 401
      if (status === 401) {
        clearStoredToken();
        clearStoredUser();
        // Only redirect if not already on the login page
        if (!window.location.pathname.startsWith('/login') &&
            !window.location.pathname.startsWith('/register')) {
          window.location.href = '/login';
        }
      }

      const message = data?.detail || data?.message || `Request failed (${status})`;
      console.error(`API Error [${status}]:`, message);
    } else if (error.request) {
      console.error('Network error: No response received');
    }
    return Promise.reject(error);
  }
);

export default api;
