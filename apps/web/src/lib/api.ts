import axios from 'axios';
import { useAuthStore } from './auth';

export const api = axios.create({ withCredentials: true });

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Silent refresh on 401 — single in-flight refresh shared across concurrent failures
let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status !== 401) throw err;
    if (!refreshing) {
      refreshing = api
        .post<{ accessToken: string }>('/api/v1/auth/refresh')
        .then((r) => {
          useAuthStore.getState().setAccessToken(r.data.accessToken);
          return r.data.accessToken;
        })
        .catch(() => {
          useAuthStore.getState().clearToken();
          window.location.href = '/auth/login';
          throw err;
        })
        .finally(() => {
          refreshing = null;
        });
    }
    const newToken = await refreshing;
    err.config.headers['Authorization'] = `Bearer ${newToken}`;
    return api(err.config);
  }
);
