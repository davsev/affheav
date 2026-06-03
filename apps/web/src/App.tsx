import { useEffect } from 'react';
import { Center, Loader } from '@mantine/core';
import { api } from './lib/api';
import { useAuthStore } from './lib/auth';

export function App() {
  const setToken = useAuthStore((s) => s.setAccessToken);

  useEffect(() => {
    // Attempt silent refresh on mount — establishes session from httpOnly cookie
    api
      .post<{ accessToken: string }>('/api/v1/auth/refresh')
      .then((r) => setToken(r.data.accessToken))
      .catch(() => {
        // Not logged in — login redirect handled by axios response interceptor
        window.location.href = '/auth/login';
      });
  }, []);

  return (
    <Center h="100vh">
      <Loader size="xl" />
    </Center>
  );
}
