import { apiRequest } from './api';
import { clearCurrentAccountCache, loadCurrentAccount } from './authCache';
import type { Account } from '../types/api';

export async function login(email: string, password: string) {
  clearCurrentAccountCache();
  try { return await apiRequest<{ ok: true; account: Account }>('/api/auth/login', { method: 'POST', body: { email, password } }); }
  finally { clearCurrentAccountCache(); }
}
export const currentAccount = () => loadCurrentAccount(() => apiRequest<{ account: Account }>('/api/auth/me'));
export async function logout() {
  clearCurrentAccountCache();
  try { return await apiRequest<{ ok: true }>('/api/auth/logout', { method: 'POST' }); }
  finally { clearCurrentAccountCache(); }
}
