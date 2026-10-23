import { ApiRequestError, apiRequest } from './api';
import { clearCurrentAccountCache, loadCurrentAccount } from './authCache';
import type { Account } from '../types/api';

export async function login(email: string, password: string) {
  clearCurrentAccountCache();
  try {
    return await apiRequest<{ ok: true; account: Account }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
      serviceUnavailableMessage: 'Login service is not reachable, please try again later',
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) throw new ApiRequestError('Invalid email or password', 401);
    if (!(error instanceof ApiRequestError)) throw new Error('Login service is not reachable, please try again later');
    throw error;
  }
  finally { clearCurrentAccountCache(); }
}
export const currentAccount = () => loadCurrentAccount(() => apiRequest<{ account: Account }>('/api/auth/me'));
export async function logout() {
  clearCurrentAccountCache();
  try { return await apiRequest<{ ok: true }>('/api/auth/logout', { method: 'POST' }); }
  finally { clearCurrentAccountCache(); }
}
