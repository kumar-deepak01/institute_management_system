import type { PhotoMutationResponse, ProfilePhotoType } from '../types/api';

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

async function csrfToken(): Promise<string> {
  const response = await fetch(`${apiBaseUrl}/api/auth/csrf`, { credentials: 'include' });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload !== 'object' || payload === null || !('csrfToken' in payload) || typeof payload.csrfToken !== 'string') {
    throw new Error('Sign in again before changing a profile photo.');
  }
  return payload.csrfToken;
}

async function photoRequest(type: ProfilePhotoType, id: string, method: 'POST' | 'DELETE', file?: File): Promise<PhotoMutationResponse> {
  const token = await csrfToken();
  const headers = new Headers({ 'X-CSRF-Token': token });
  let body: FormData | undefined;
  if (file) {
    body = new FormData();
    body.append('photo', file, 'profile.webp');
  }
  const response = await fetch(`${apiBaseUrl}/api/photos/${type}/${encodeURIComponent(id)}`, {
    method, credentials: 'include', headers, body,
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
      ? payload.error : `Photo request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as PhotoMutationResponse;
}

export function uploadProfilePhoto(type: ProfilePhotoType, id: string, file: File) {
  return photoRequest(type, id, 'POST', file);
}

export function removeProfilePhoto(type: ProfilePhotoType, id: string) {
  return photoRequest(type, id, 'DELETE');
}
