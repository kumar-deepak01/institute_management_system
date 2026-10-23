import { apiRequest } from './api';

async function csrfHeaders() {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf');
  return { 'X-CSRF-Token': csrfToken };
}

export type IntegrationProvider = 'zoom' | 'google_meet' | 'teams' | 'whatsapp' | 'email' | 'sms' | 'maya_ai' | 'ai_exam_generation' | 'ai_assessment' | 'video_proctoring' | 'api_access' | 'priority_support' | 'custom';
export type IntegrationStatus = { enabled: boolean; connected: boolean; configured: boolean; hasCredentials: boolean; config: Record<string, unknown> };
export type IntegrationsResponse = { integrations: Record<IntegrationProvider, IntegrationStatus>; events: Array<{ provider: string; event_type: string; status: string; http_status: number | null; created_at: string }>; apiTokens: Array<{ id: string; token_name: string; created_at: string; last_used_at: string | null }>; prioritySupport: { enabled: boolean; email: string; phone: string } };

export const getIntegrations = () => apiRequest<IntegrationsResponse>('/api/admin/integrations');
export const saveIntegration = async (provider: IntegrationProvider, enabled: boolean, credentials: Record<string, unknown>) => apiRequest(`/api/admin/integrations/${provider}`, { method: 'PUT', headers: await csrfHeaders(), body: { enabled, credentials } });
export const testIntegration = async (provider: IntegrationProvider) => apiRequest<{ ok: boolean; error?: string; message?: string }>(`/api/admin/integrations/${provider}/test`, { method: 'POST', headers: await csrfHeaders(), body: {} });
export const removeIntegration = async (provider: IntegrationProvider) => apiRequest<{ ok: boolean }>(`/api/admin/integrations/${provider}`, { method: 'DELETE', headers: await csrfHeaders() });
export const createIntegrationToken = async (name: string) => apiRequest<{ id: string; name: string; token: string }>('/api/admin/integrations/api_access/tokens', { method: 'POST', headers: await csrfHeaders(), body: { name } });
export const revokeIntegrationToken = async (id: string) => apiRequest<{ ok: boolean }>(`/api/admin/integrations/api_access/tokens/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await csrfHeaders() });
export const runCustomIntegrationAction = async (id: string, payload: unknown = {}) => apiRequest<{ ok: boolean; httpStatus: number }>(`/api/admin/integrations/custom/actions/${encodeURIComponent(id)}`, { method: 'POST', headers: await csrfHeaders(), body: { payload } });
