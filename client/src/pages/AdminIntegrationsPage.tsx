import { useCallback, useEffect, useState } from 'react';
import { createIntegrationToken, getIntegrations, IntegrationProvider, IntegrationsResponse, removeIntegration, revokeIntegrationToken, saveIntegration, testIntegration } from '../services/integrations';

type Field = { key: string; label: string; secret?: boolean; type?: 'textarea' | 'select' | 'number'; options?: string[]; placeholder?: string; help?: string };
type CardSpec = { id: IntegrationProvider | 'meeting'; title: string; description: string; fields: Field[] };
const meetingFields: Record<'zoom' | 'google_meet', Field[]> = {
  zoom: [{ key: 'accountId', label: 'Account ID' }, { key: 'clientId', label: 'Client ID' }, { key: 'clientSecret', label: 'Client Secret', secret: true }, { key: 'accountEmail', label: 'Account Email' }],
  google_meet: [{ key: 'authType', label: 'Authentication', type: 'select', options: ['oauth', 'service_account'] }, { key: 'clientId', label: 'Client ID' }, { key: 'clientSecret', label: 'Client Secret', secret: true }, { key: 'refreshToken', label: 'Refresh Token', secret: true }, { key: 'serviceAccountJson', label: 'Service account JSON', type: 'textarea', secret: true, help: 'Use service account authentication instead of OAuth.' }, { key: 'calendarId', label: 'Calendar ID' }, { key: 'accountEmail', label: 'Account Email' }],
};
const specs: CardSpec[] = [
  { id: 'meeting', title: 'Zoom / Google Meet', description: 'Connect a meeting provider for scheduled online sessions.', fields: [] },
  { id: 'whatsapp', title: 'WhatsApp Auto-Reply Bot', description: 'Verify signed webhooks and send a generic acknowledgement.', fields: [{ key: 'phoneNumberId', label: 'Phone Number ID' }, { key: 'businessAccountId', label: 'Business Account ID' }, { key: 'accessToken', label: 'Access Token', secret: true }, { key: 'verifyToken', label: 'Verify Token', secret: true }, { key: 'replyText', label: 'Acknowledgement text', type: 'textarea', placeholder: 'Thanks for contacting us. We have received your message.' }] },
  { id: 'maya_ai', title: 'Maya AI Tutor (OpenAI)', description: 'Server-side tutor responses for the Doubts experience.', fields: [{ key: 'provider', label: 'Provider', type: 'select', options: ['openai'] }, { key: 'apiKey', label: 'API Key', secret: true }, { key: 'model', label: 'Model', placeholder: 'gpt-4o-mini' }] },
  { id: 'ai_exam_generation', title: 'AI Exam Generation', description: 'Generate validated practice questions using OpenAI.', fields: [{ key: 'provider', label: 'Provider', type: 'select', options: ['openai'] }, { key: 'apiKey', label: 'API Key', secret: true }, { key: 'model', label: 'Model', placeholder: 'gpt-4o-mini' }] },
  { id: 'ai_assessment', title: 'AI Assessment', description: 'Assess submitted answers against a rubric.', fields: [{ key: 'provider', label: 'Provider', type: 'select', options: ['openai'] }, { key: 'apiKey', label: 'API Key', secret: true }, { key: 'model', label: 'Model', placeholder: 'gpt-4o-mini' }] },
  { id: 'api_access', title: 'API Access', description: 'Create and revoke API tokens. Token values are shown only once.', fields: [] },
  { id: 'video_proctoring', title: 'Video Proctoring', description: 'Provider adapter and server-side session-token service.', fields: [{ key: 'provider', label: 'Provider', type: 'select', options: ['custom'] }, { key: 'apiKey', label: 'API Key', secret: true }, { key: 'apiBaseUrl', label: 'Provider API Base URL', placeholder: 'https://provider.example/api/' }, { key: 'settingsJson', label: 'Provider options (JSON)', type: 'textarea', placeholder: '{"recording":true,"identityCheck":false}' }] },
  { id: 'priority_support', title: 'Priority Support', description: 'Priority support contact details are configured by the server operator.', fields: [] },
];
const baseInput = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-blue-100';
const btn = 'inline-flex items-center justify-center rounded-xl px-3.5 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50';
const defaults: Partial<Record<IntegrationProvider, Record<string, string>>> = {
  google_meet: { authType: 'oauth' }, maya_ai: { provider: 'openai', model: 'gpt-4o-mini' },
  ai_exam_generation: { provider: 'openai', model: 'gpt-4o-mini' }, ai_assessment: { provider: 'openai', model: 'gpt-4o-mini' },
  video_proctoring: { provider: 'custom' }, whatsapp: { replyText: 'Thanks for contacting us. We have received your message.' },
};
const allProviders: IntegrationProvider[] = ['zoom','google_meet','teams','whatsapp','email','sms','maya_ai','ai_exam_generation','ai_assessment','video_proctoring','api_access','priority_support','custom'];

export default function AdminIntegrationsPage() {
  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [meetingProvider, setMeetingProvider] = useState<'zoom' | 'google_meet'>('zoom');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [oneTimeToken, setOneTimeToken] = useState('');
  const [tokenName, setTokenName] = useState('');
  const [tokenModal, setTokenModal] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await getIntegrations(); setData(result);
      const nextForms: Record<string, Record<string, string>> = {};
      const nextEnabled: Record<string, boolean> = {};
      for (const provider of allProviders) {
        const saved = result.integrations[provider];
        nextForms[provider] = { ...(defaults[provider] || {}), ...Object.fromEntries(Object.entries(saved?.config || {}).filter(([, value]) => ['string','number','boolean'].includes(typeof value)).map(([key,value]) => [key,String(value)])) };
        nextEnabled[provider] = Boolean(saved?.enabled);
      }
      setForms(current => Object.fromEntries(allProviders.map(provider => [provider, { ...nextForms[provider], ...Object.fromEntries((provider === 'zoom' || provider === 'google_meet' ? meetingFields[provider] : specs.find(item => item.id === provider)?.fields || []).filter(field => field.secret && current[provider]?.[field.key]).map(field => [field.key,current[provider][field.key]])) }])));
      setEnabled(nextEnabled);
      if (result.integrations.google_meet?.enabled && !result.integrations.zoom?.enabled) setMeetingProvider('google_meet');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Integrations could not be loaded.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const setField = (provider: string, key: string, value: string) => setForms(current => ({ ...current, [provider]: { ...(current[provider] || {}), [key]: value } }));
  const run = async (provider: IntegrationProvider, action: 'save' | 'test' | 'remove') => {
    setBusy(`${provider}:${action}`); setMessage(''); setError('');
    try {
      if (action === 'save') {
        const credentials: Record<string, unknown> = { ...(forms[provider] || {}) };
        if (provider === 'email') { credentials.port = Number(credentials.port); credentials.secure = credentials.secure === 'true'; }
        await saveIntegration(provider, enabled[provider] || false, credentials);
        setMessage(`${provider.replace(/_/g,' ')} settings saved securely${enabled[provider] ? ' and connection verified' : ''}.`);
      } else if (action === 'test') {
        const result = await testIntegration(provider); setMessage(result.message || 'Connection verified.');
      } else { await removeIntegration(provider); setOneTimeToken(''); setMessage('Saved integration credentials removed.'); }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The integration request failed.'); }
    finally { setBusy(''); }
  };
  const createToken = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy('api_access:create'); setError('');
    try { const result = await createIntegrationToken(tokenName); setOneTimeToken(result.token); setTokenName(''); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Token could not be created.'); }
    finally { setBusy(''); }
  };
  const revokeToken = async (id: string) => {
    setBusy(`api_access:${id}`); setError('');
    try { await revokeIntegrationToken(id); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Token could not be revoked.'); }
    finally { setBusy(''); }
  };
  const tokens = data?.apiTokens || [];
  const events = data?.events || [];

  return <section className="space-y-6">
    <header><h1 className="text-3xl font-black tracking-tight text-slate-900">Integrations &amp; Premium Features</h1><p className="mt-2 text-sm text-slate-600">Configure third-party integrations and AI providers granted by your plan.</p></header>
    {error && <div role="alert" className="flex items-center justify-between rounded-2xl border border-rose-200 bg-white px-5 py-4 text-sm text-rose-700">{error}<button className="font-bold underline" onClick={() => void load()}>Retry</button></div>}
    {message && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-800">{message}</div>}
    {!data && !error && <div role="status" className="grid min-h-48 place-items-center rounded-2xl border border-blue-100 bg-white text-sm text-slate-500">Loading integration settings…</div>}
    {data && <div className="grid gap-5 xl:grid-cols-2">{specs.map(spec => {
      const provider: IntegrationProvider = spec.id === 'meeting' ? meetingProvider : spec.id;
      const status = data.integrations[provider]; const form = forms[provider] || {};
      const fields = spec.id === 'meeting' ? meetingFields[meetingProvider].filter(field => {
        if (meetingProvider !== 'google_meet') return true;
        return form.authType === 'service_account'
          ? !['refreshToken','clientId','clientSecret'].includes(field.key)
          : field.key !== 'serviceAccountJson';
      }) : spec.fields;
      const support = spec.id === 'priority_support' ? data.prioritySupport : null;
      return <article key={spec.id} className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-[0_8px_24px_rgba(30,64,175,.08)]">
        <div className="flex items-center justify-between gap-3 border-b border-blue-100 bg-gradient-to-r from-blue-100 via-indigo-50 to-white px-5 py-4"><div><h2 className="font-extrabold text-slate-900">{spec.title}</h2><p className="mt-1 text-xs text-slate-600">{spec.description}</p></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${status?.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{status?.connected ? 'Enabled' : 'Disabled'}</span></div>
        <div className="space-y-4 p-5">
          <label className="flex w-fit cursor-pointer items-center gap-3 text-sm font-semibold text-slate-800"><input type="checkbox" checked={Boolean(enabled[provider])} onChange={event => setEnabled(current => ({ ...current, [provider]: event.target.checked }))} className="h-4 w-4 accent-blue-600"/>Enable this integration</label>
          {spec.id === 'meeting' && <><label className="block space-y-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">Provider<select className={baseInput} value={meetingProvider} onChange={event => setMeetingProvider(event.target.value as 'zoom'|'google_meet')}><option value="zoom">Zoom</option><option value="google_meet">Google Meet</option></select></label>{meetingProvider === 'zoom' && <p className="rounded-xl bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800">Zoom requires a Server-to-Server OAuth app. Add the user-read and meeting-write scopes in Zoom Marketplace, activate the app, then enter its Account ID, Client ID and Client Secret.</p>}</>}
          {spec.id === 'api_access' ? <div className="space-y-3"><p className="text-sm text-slate-600">Generate API tokens to integrate CoachSutra with your own systems.</p><button onClick={() => { setTokenModal(true); setOneTimeToken(''); }} className={`${btn} border border-orange-200 text-orange-600 hover:bg-blue-50`}>Manage API Tokens ({tokens.length})</button>{tokens.slice(0,3).map(token => <div key={token.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-sm"><span>{token.token_name}</span><button disabled={Boolean(busy)} onClick={() => void revokeToken(token.id)} className="font-bold text-rose-600">Revoke</button></div>)}</div>
          : spec.id === 'priority_support' ? <div className="space-y-3"><p className="text-sm text-slate-600">Reach our support team directly:</p>{support?.email && <a className="block rounded-xl border border-orange-200 px-4 py-2.5 text-center text-sm font-bold text-orange-600" href={`mailto:${support.email}`}>{support.email}</a>}{support?.phone && <a className="block rounded-xl border border-orange-200 px-4 py-2.5 text-center text-sm font-bold text-orange-600" href={`tel:${support.phone}`}>{support.phone}</a>}{!support?.email && !support?.phone && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Support contact is not configured.</p>}</div>
          : <div className="grid gap-3 sm:grid-cols-2">{fields.map(field => <label key={field.key} className={`space-y-1.5 text-xs font-bold uppercase tracking-wide text-slate-700 ${field.type === 'textarea' ? 'sm:col-span-2' : ''}`}><span>{field.label}</span>{field.type === 'select' ? <select autoComplete="off" className={baseInput} value={form[field.key] || field.options?.[0] || ''} onChange={event => setField(provider,field.key,event.target.value)}>{field.options?.map(option => <option key={option} value={option}>{option.replace(/_/g,' ')}</option>)}</select> : field.type === 'textarea' ? <textarea autoComplete="off" rows={3} className={`${baseInput} font-mono text-xs normal-case tracking-normal`} value={field.secret && !form[field.key] && status?.hasCredentials ? '' : form[field.key] || ''} placeholder={field.secret && status?.hasCredentials ? 'Saved securely; enter only to replace' : field.placeholder || ''} onChange={event => setField(provider,field.key,event.target.value)}/> : <input autoComplete={field.secret ? 'new-password' : 'off'} type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'} className={baseInput} value={field.secret && !form[field.key] && status?.hasCredentials ? '' : form[field.key] || ''} placeholder={field.secret && status?.hasCredentials ? 'Saved securely; enter only to replace' : field.placeholder || ''} onChange={event => setField(provider,field.key,event.target.value)}/ >}{field.help && <span className="block text-[11px] font-normal normal-case tracking-normal text-slate-500">{field.help}</span>}</label>)}</div>}
          {spec.id === 'video_proctoring' && <p className="rounded-xl bg-blue-50 px-4 py-3 text-xs text-blue-800">Service ready; the proctoring screen is not built yet.</p>}
          {spec.id === 'ai_exam_generation' && <p className="rounded-xl bg-indigo-50 px-4 py-3 text-xs text-indigo-800">Service ready; the exam generation screen is not built yet.</p>}
          {spec.id === 'ai_assessment' && <p className="rounded-xl bg-indigo-50 px-4 py-3 text-xs text-indigo-800">Service ready; an assessment screen is not built yet.</p>}
          {spec.id === 'maya_ai' && <p className="rounded-xl bg-indigo-50 px-4 py-3 text-xs text-indigo-800">Tutor service is available to the existing Doubts experience.</p>}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4"><button disabled={Boolean(busy)} onClick={() => void run(provider,'save')} className={`${btn} bg-orange-500 text-white hover:bg-orange-600 shadow-sm hover:bg-blue-700`}>{busy === `${provider}:save` ? 'Saving…' : '✓ Save'}</button><button disabled={Boolean(busy)} onClick={() => void run(provider,'test')} className={`${btn} border border-orange-200 text-orange-600 hover:bg-blue-50`}>{busy === `${provider}:test` ? 'Testing…' : 'Test connection'}</button><button disabled={Boolean(busy) || !status?.hasCredentials} onClick={() => void run(provider,'remove')} className={`${btn} border border-slate-200 text-slate-600 hover:border-rose-200 hover:text-rose-600`}>Remove credentials</button></div>
        </div>
      </article>;
    })}</div>}
    {data && <section className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm"><header className="border-b border-blue-100 bg-gradient-to-r from-blue-100 to-white px-5 py-4"><h2 className="font-extrabold text-slate-900">Integration event log</h2><p className="mt-1 text-xs text-slate-600">Recent connection tests and provider actions. Credentials and prompt content are never recorded.</p></header>{events.length ? <div className="divide-y divide-slate-100">{events.map((item,index) => <div key={`${item.created_at}-${index}`} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-4"><span className="font-semibold capitalize">{item.provider.replace(/_/g,' ')}</span><span className="text-slate-600">{item.event_type}</span><span className={item.status === 'success' ? 'text-emerald-700' : 'text-rose-600'}>{item.status}{item.http_status ? ` · ${item.http_status}` : ''}</span><time className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</time></div>)}</div> : <p className="px-5 py-8 text-center text-sm text-slate-600">No integration events yet.</p>}</section>}
    {tokenModal && <div role="dialog" aria-modal="true" aria-labelledby="token-dialog-title" className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 p-4"><div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between bg-gradient-to-r from-blue-600 to-blue-800 px-5 py-4 text-white"><h2 id="token-dialog-title" className="font-extrabold">Manage API Tokens</h2><button aria-label="Close" onClick={() => { setTokenModal(false); setOneTimeToken(''); }} className="text-2xl">×</button></header><form onSubmit={createToken} className="space-y-4 p-5"><label className="block space-y-1 text-sm font-semibold">Token name<input required maxLength={80} autoComplete="off" className={baseInput} value={tokenName} onChange={event => setTokenName(event.target.value)} placeholder="e.g. Reporting connector"/></label><button disabled={Boolean(busy)} className={`${btn} bg-orange-500 text-white hover:bg-orange-600`}>{busy === 'api_access:create' ? 'Creating…' : 'Create token'}</button>{oneTimeToken && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-bold text-amber-900">Copy this token now. It will not be shown again.</p><code className="mt-2 block break-all text-xs text-slate-800">{oneTimeToken}</code><button type="button" onClick={() => void navigator.clipboard?.writeText(oneTimeToken)} className="mt-2 text-xs font-bold text-orange-600 underline">Copy token</button></div>}<div className="max-h-52 space-y-2 overflow-auto">{tokens.map(token => <div key={token.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-sm"><span>{token.token_name}</span><button type="button" disabled={Boolean(busy)} onClick={() => void revokeToken(token.id)} className="font-bold text-rose-600">Revoke</button></div>)}</div></form></div></div>}
  </section>;
}
