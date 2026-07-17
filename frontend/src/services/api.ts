import axios from 'axios';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor: unwrap {code, message, data} structure
api.interceptors.response.use(
  (response) => {
    // FastAPI returns data directly (not wrapped), so pass through
    return response;
  },
  (error) => {
    if (error.response) {
      const { status, data } = error.response;
      const message = data?.detail || data?.message || `Request failed (${status})`;
      console.error(`API Error [${status}]:`, message);
    } else if (error.request) {
      console.error('Network error: No response received');
    }
    return Promise.reject(error);
  }
);

export default api;
