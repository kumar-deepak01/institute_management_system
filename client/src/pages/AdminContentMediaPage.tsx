import { memo, useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AdminIcon from '../components/AdminIcon';
import { getAttachmentUrl, getContentList, getContentLookups, getContentStats, getVideoUrl, mutateContent, uploadContent, type ContentList, type ContentLookups, type ContentRecord } from '../services/contentMedia';

type Kind = 'downloads' | 'videos' | 'live-classes';
const contentCache = new Map<Kind, { list?: ContentList; stats?: Record<string, number | boolean>; lookups?: ContentLookups }>();
const pageConfig: Record<Kind, { title: string; description: string; action: string }> = {
  downloads: { title: 'Download Center', description: 'Upload, publish and share study material, circulars, syllabi & notes with students and staff.', action: 'New Upload' },
  videos: { title: 'Video Lectures', description: 'Recorded lectures with drip-access control and watch tracking', action: 'Add Video' },
  'live-classes': { title: 'Live Classes', description: 'Schedule classes using Jitsi, Zoom, Google Meet, Teams or any custom link', action: 'Schedule Class' },
};

function Icon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<string, ReactNode> = {
    upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 16v4h16v-4"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    filter: <path d="M3 5h18l-7 8v6l-4 2v-8z"/>,
    folder: <><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 10h18"/></>,
    video: <><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    download: <><path d="M12 4v12m-4-4 4 4 4-4"/><path d="M4 17v3h16v-3"/></>,
    play: <><circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/></>,
    live: <><circle cx="12" cy="12" r="2"/><path d="M5 9a8 8 0 0 0 0 6m14-6a8 8 0 0 1 0 6M2 6a13 13 0 0 0 0 12m20-12a13 13 0 0 1 0 12"/></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.5"/></>,
  };
  return <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...common}>{paths[name] || paths.folder}</svg>;
}

export default function AdminContentMediaPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const kind: Kind = location.pathname.startsWith('/admin/video-lectures') ? 'videos' : location.pathname.startsWith('/admin/live-classes') ? 'live-classes' : 'downloads';
  const config = pageConfig[kind];
  const cached = contentCache.get(kind);
  const [list, setList] = useState<ContentList | null>(cached?.list || null);
  const [stats, setStats] = useState<Record<string, number | boolean> | null>(cached?.stats || null);
  const [lookups, setLookups] = useState<ContentLookups>(cached?.lookups || { batches: [], subjects: [], teachers: [] });
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [type, setType] = useState('');
  const [subject, setSubject] = useState('');
  const [batch, setBatch] = useState('');
  const [status, setStatus] = useState('');
  const [chapter, setChapter] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300); return () => window.clearTimeout(timer); }, [query]);
  const loadData = useCallback(async (background = false) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError('');
    const params: Record<string, string | number> = { q: debouncedQuery, page, limit: 24 };
    if (kind === 'downloads') Object.assign(params, { type, subjectId: subject, status });
    if (kind === 'videos') Object.assign(params, { subjectId: subject, batchId: batch, chapter });
    if (kind === 'live-classes') Object.assign(params, { status, batchId: batch });
    const results = await Promise.allSettled([getContentList(kind, params), getContentStats(kind), getContentLookups()]);
    const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (results[0].status === 'fulfilled') { setList(results[0].value); contentCache.set(kind, { ...contentCache.get(kind), list: results[0].value }); }
    if (results[1].status === 'fulfilled') { setStats(results[1].value); contentCache.set(kind, { ...contentCache.get(kind), stats: results[1].value }); }
    if (results[2].status === 'fulfilled') { setLookups(results[2].value); contentCache.set(kind, { ...contentCache.get(kind), lookups: results[2].value }); }
    if (failed) setError(failed.reason instanceof Error ? failed.reason.message : 'Some content data could not be loaded.');
    setLoading(false); setRefreshing(false);
  }, [kind, debouncedQuery, page, type, subject, batch, status, chapter]);
  useEffect(() => { void loadData(Boolean(list)); }, [loadData]);

  const onFileLink = useCallback(async (record: ContentRecord, attachmentId: string) => {
    const opened = window.open('about:blank', '_blank', 'noopener,noreferrer');
    try { const value = await getAttachmentUrl(record.id, attachmentId); if (opened) opened.location.href = value.url; } catch (cause) { opened?.close(); setMessage(cause instanceof Error ? cause.message : 'File could not be opened.'); }
  }, []);
  const onVideoOpen = useCallback(async (record: ContentRecord) => {
    const opened = window.open('about:blank', '_blank', 'noopener,noreferrer');
    try { const value = await getVideoUrl(record.id); if (opened) opened.location.href = value.url; } catch (cause) { opened?.close(); setMessage(cause instanceof Error ? cause.message : 'Video could not be opened.'); }
  }, []);
  const openItem = useCallback(() => { setMessage(''); setDialog(true); }, []);
  const save = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setMessage('');
    const form = event.currentTarget; const data = new FormData(form);
    try {
      if (kind === 'live-classes') {
        const scheduledAt = String(data.get('scheduledAt') || '');
        await mutateContent('/api/admin/live-classes', 'POST', { title: data.get('title'), topic: data.get('topic'), provider: data.get('provider'), teacherKey: data.get('teacherKey'), subjectId: data.get('subjectId'), batchId: data.get('batchId'), scheduledAt: new Date(scheduledAt).toISOString(), durationMinutes: Number(data.get('durationMinutes') || 60), recurringDaily: data.get('recurringDaily') === 'on', meetingUrl: data.get('meetingUrl'), notes: data.get('notes') });
      } else {
        await uploadContent(kind, data);
      }
      setDialog(false); setMessage('Saved successfully.'); setPage(1); await loadData(true);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'This change could not be saved.'); }
    finally { setSaving(false); }
  }, [kind, loadData]);
  const action = useCallback(async (record: ContentRecord, operation: string) => {
    try {
      if (kind === 'downloads') await mutateContent(`/api/admin/downloads/${encodeURIComponent(record.id)}`, 'PATCH', { status: record.status === 'published' ? 'draft' : 'published' });
      else if (kind === 'videos' || operation === 'delete') await mutateContent(`/api/admin/${kind}/${encodeURIComponent(record.id)}`, 'DELETE');
      else await mutateContent(`/api/admin/live-classes/${encodeURIComponent(record.id)}`, 'PATCH', { status: operation });
      await loadData(true);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The action could not be completed.'); }
  }, [kind, loadData]);

  const emptyTitle = kind === 'downloads' ? 'No download items found.' : kind === 'videos' ? 'No videos uploaded yet' : 'No live classes yet';
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-3xl font-black text-blue-600">{config.title}</h2><p className="mt-1 text-slate-500">{config.description}</p></div><button onClick={openItem} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white shadow-md hover:bg-blue-700"><Icon name={kind === 'live-classes' ? 'video' : 'upload'}/>{config.action}</button></div>
    <Stats kind={kind} stats={stats} loading={!stats && loading}/>
    {kind === 'live-classes' && <PlatformBar onConfigure={() => navigate('/admin/integrations')}/>}
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="relative min-w-[220px] flex-1"><Icon name="search" className="absolute left-3 top-3 h-5 w-5 text-slate-400"/><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder={kind === 'downloads' ? 'Search by title or description…' : kind === 'videos' ? 'Search title…' : 'Search classes…'} className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-3 outline-none focus:border-blue-400"/></label>
      {kind === 'downloads' && <><select value={type} onChange={event => { setType(event.target.value); setPage(1); }} className="rounded-xl border border-slate-200 px-3 py-2.5"><option value="">All Content Types</option>{['Assignment','Circular','Syllabus','Notes','Study Material','Other'].map(value => <option key={value}>{value}</option>)}</select><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="rounded-xl border border-slate-200 px-3 py-2.5"><option value="">All Statuses</option>{['published','scheduled','draft','expired'].map(value => <option key={value} value={value}>{value}</option>)}</select></>}
      {kind !== 'live-classes' && <select value={subject} onChange={event => { setSubject(event.target.value); setPage(1); }} className="rounded-xl border border-slate-200 px-3 py-2.5"><option value="">All Subjects</option>{lookups.subjects.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select>}
      {kind !== 'downloads' && <select value={batch} onChange={event => { setBatch(event.target.value); setPage(1); }} className="rounded-xl border border-slate-200 px-3 py-2.5"><option value="">All Batches</option>{lookups.batches.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select>}
      {kind === 'videos' && <input value={chapter} onChange={event => { setChapter(event.target.value); setPage(1); }} placeholder="Chapter" className="w-40 rounded-xl border border-slate-200 px-3 py-2.5"/>}
      {kind === 'live-classes' && <select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className="rounded-xl border border-slate-200 px-3 py-2.5"><option value="">All Status</option>{['scheduled','completed','cancelled'].map(value => <option key={value}>{value}</option>)}</select>}
      <button onClick={() => void loadData(true)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 font-bold text-white"><Icon name="filter"/>Filter</button><button onClick={() => { setQuery(''); setType(''); setSubject(''); setBatch(''); setStatus(''); setChapter(''); setPage(1); }} className="rounded-xl border border-slate-300 px-4 py-2.5">Clear</button>
    </div>
    {message && !dialog && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</p>}
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-white p-5 text-rose-700">{error} <button onClick={() => void loadData(true)} className="ml-2 font-bold underline">Retry</button></div>}
    {list?.schemaPending && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Content storage migration is pending. Run the server migrations, then retry.</div>}
    <ContentTable kind={kind} records={list?.records || []} onFileLink={onFileLink} onVideoOpen={onVideoOpen} onAction={action} loading={loading} title={emptyTitle} lookups={lookups}/>
    <div className="flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm"><span>{list?.total ?? 0} records {refreshing ? '· Refreshing…' : ''}</span><div className="flex items-center gap-3"><button disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous</button><span>Page {page} of {list?.pages || 1}</span><button disabled={page >= (list?.pages || 1)} onClick={() => setPage(value => value + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next</button></div></div>
    {dialog && <ContentDialog kind={kind} lookups={lookups} saving={saving} message={message} onClose={() => setDialog(false)} onSubmit={save}/>}
  </div>;
}

const Stats = memo(function Stats({ kind, stats, loading }: { kind: Kind; stats: Record<string, number | boolean> | null; loading: boolean }) {
  const rows: [string, string, string][] = kind === 'downloads' ? [['total','TOTAL UPLOADS','folder'],['published','PUBLISHED','play'],['scheduled','SCHEDULED','calendar'],['expired','EXPIRED','close']] : kind === 'videos' ? [['total','TOTAL VIDEOS','play'],['total_views','TOTAL VIEWS','eye'],['avg_completion','AVG COMPLETION','chart'],['published','PUBLISHED','folder']] : [['live_now','LIVE NOW','live'],['upcoming','UPCOMING','calendar'],['completed','COMPLETED','play']];
  return <section className={`grid gap-4 ${rows.length === 3 ? 'md:grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-4'}`}>{rows.map(([key,label,icon],index) => <article key={key} className="flex min-h-[96px] items-center gap-4 rounded-2xl border border-slate-100 bg-white px-5 shadow-sm"><span className={`grid h-12 w-12 place-items-center rounded-xl ${['bg-blue-50 text-blue-600','bg-emerald-50 text-emerald-600','bg-amber-50 text-amber-600','bg-rose-50 text-rose-600'][index]}`}><AdminIcon name={icon} className="h-6 w-6"/></span><div><p className="text-xs font-bold tracking-wider text-slate-400">{label}</p><p className="mt-1 text-2xl font-black">{loading ? <span className="inline-block h-7 w-10 animate-pulse rounded bg-slate-100"/> : `${Number(stats?.[key] || 0)}${key === 'avg_completion' ? '%' : ''}`}</p></div></article>)}</section>;
});

function PlatformBar({ onConfigure }: { onConfigure: () => void }) {
  const [providers, setProviders] = useState<Record<string, boolean>>({});
  useEffect(() => { fetch('/api/admin/integrations/status', { credentials: 'include' }).then(response => response.ok ? response.json() : null).then(value => value && setProviders(value.providers || {})).catch(() => undefined); }, []);
  return <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-white to-blue-50 p-4"><b className="mr-2 text-blue-700">Supported Platforms</b>{[['jitsi','Jitsi (Free)'],['zoom','Zoom'],['google_meet','Google Meet'],['teams','Teams'],['custom','Custom']].map(([id,name])=><span key={id} className="rounded-full border border-blue-100 bg-white px-3 py-1.5 text-xs font-bold text-slate-600">{name}{id in providers ? (providers[id] ? ' · Connected' : ' · Not connected') : id==='jitsi'||id==='custom' ? ' · Ready' : ' · Not connected'}</span>)}<button onClick={onConfigure} className="ml-auto rounded-lg border border-blue-300 bg-white px-3 py-2 text-sm font-bold text-blue-700">Configure Zoom/Teams</button></div>;
}

const ContentTable = memo(function ContentTable({ kind, records, onFileLink, onVideoOpen, onAction, loading, title, lookups }: { kind: Kind; records: ContentRecord[]; onFileLink: (record: ContentRecord, attachmentId: string) => void; onVideoOpen: (record: ContentRecord) => void; onAction: (record: ContentRecord, operation: string) => void; loading: boolean; title: string; lookups: ContentLookups }) {
  if (loading && records.length === 0) return <div className="grid min-h-[290px] place-items-center rounded-2xl border border-blue-100 bg-white"><div role="status" className="w-full space-y-3 p-8"><span className="block h-6 w-2/5 animate-pulse rounded bg-slate-100"/><span className="block h-4 animate-pulse rounded bg-slate-100"/><span className="block h-4 w-4/5 animate-pulse rounded bg-slate-100"/></div></div>;
  if (!records.length) return <div className="grid min-h-[290px] place-content-center rounded-2xl border border-dashed border-blue-200 bg-white px-5 text-center"><Icon name={kind === 'downloads' ? 'folder' : kind === 'videos' ? 'video' : 'calendar'} className="mx-auto h-12 w-12 text-slate-400"/><h3 className="mt-4 font-extrabold">{title}</h3><p className="mt-2 text-sm text-slate-500">{kind === 'downloads' ? 'Upload new content using the button above.' : kind === 'videos' ? 'Upload recorded lectures or paste YouTube links. Set drip release dates to control student access.' : 'Schedule a class using Jitsi, Zoom, Google Meet, Teams, or a custom link.'}</p></div>;
  return <div className="overflow-x-auto rounded-2xl border border-blue-100 bg-white shadow-sm"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-gradient-to-r from-blue-50 to-slate-50 text-xs uppercase text-blue-600"><tr>{(kind === 'downloads' ? ['Title & Content','Type','Subject','Attachments / Link','Status','Uploader','Created Date','Actions'] : kind === 'videos' ? ['Title','Chapter / Topic','Subject','Batch','Views','Avg Completion','Created Date','Actions'] : ['Class','Platform','Teacher','Batch','Date & Time','Duration','Status','Actions']).map(name => <th key={name} className="px-4 py-4">{name}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{records.map(record => <ContentRow key={record.id} kind={kind} record={record} onFileLink={onFileLink} onVideoOpen={onVideoOpen} onAction={onAction} lookups={lookups}/>)}</tbody></table></div>;
});

const ContentRow = memo(function ContentRow({ kind, record, onFileLink, onVideoOpen, onAction, lookups }: { kind: Kind; record: ContentRecord; onFileLink: (record: ContentRecord, attachmentId: string) => void; onVideoOpen: (record: ContentRecord) => void; onAction: (record: ContentRecord, operation: string) => void; lookups: ContentLookups }) {
  const date = record.createdAt ? new Date(record.createdAt).toLocaleDateString() : '—';
  if (kind === 'downloads') return <tr><td className="px-4 py-4"><b>{record.title}</b><p className="mt-1 max-w-64 truncate text-xs text-slate-500">{record.description}</p></td><td className="px-4 py-4">{record.contentType}</td><td className="px-4 py-4">{record.subjectName || '—'}</td><td className="px-4 py-4">{record.attachments?.map(file => <button key={file.id} onClick={() => onFileLink(record,file.id)} className="mr-2 text-blue-600 underline">{file.name}</button>)}{record.externalUrl && <a href={record.externalUrl} target="_blank" rel="noreferrer" className="text-blue-600 underline">Open link</a>}</td><td className="px-4 py-4"><Status value={record.status}/></td><td className="px-4 py-4">Admin</td><td className="px-4 py-4">{date}</td><td className="px-4 py-4"><button onClick={() => onAction(record,'toggle')} className="font-bold text-blue-600">{record.status==='published'?'Unpublish':'Publish'}</button></td></tr>;
  if (kind === 'videos') return <tr><td className="px-4 py-4"><b>{record.title}</b><p className="max-w-64 truncate text-xs text-slate-500">{record.description}</p><button onClick={() => onVideoOpen(record)} className="text-xs font-bold text-blue-600 underline">Open video</button></td><td className="px-4 py-4">{record.chapter || '—'}<p className="text-xs text-slate-500">{record.topic || ''}</p></td><td className="px-4 py-4">{record.subjectName || '—'}</td><td className="px-4 py-4">{record.batchName || 'All Batches'}</td><td className="px-4 py-4">{record.views || 0}</td><td className="px-4 py-4">{record.completion || 0}%</td><td className="px-4 py-4">{date}</td><td className="px-4 py-4"><button onClick={() => onAction(record,'delete')} className="font-bold text-rose-600">Delete</button></td></tr>;
  return <tr><td className="px-4 py-4"><b>{record.title}</b><p className="text-xs text-slate-500">{record.topic}</p></td><td className="px-4 py-4 capitalize">{record.provider?.replace('_',' ')}</td><td className="px-4 py-4">{record.teacherName || lookups.teachers.find(item => item.id === record.teacherKey)?.name || '—'}</td><td className="px-4 py-4">{record.batchName || 'All Batches'}</td><td className="px-4 py-4">{record.scheduledAt ? new Date(record.scheduledAt).toLocaleString() : '—'}</td><td className="px-4 py-4">{record.durationMinutes} min{record.recurringDaily ? ' · Daily' : ''}</td><td className="px-4 py-4"><Status value={record.status}/></td><td className="space-x-2 whitespace-nowrap px-4 py-4">{record.meetingUrl && <a href={record.meetingUrl} target="_blank" rel="noreferrer" className="font-bold text-blue-600">Join</a>}{record.status!=='completed' && <button onClick={() => onAction(record,'completed')} className="font-bold text-emerald-700">Complete</button>}<button onClick={() => onAction(record,'delete')} className="font-bold text-rose-600">Delete</button></td></tr>;
});
function Status({ value }: { value: string }) { return <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold capitalize text-blue-700">{value}</span>; }

function ContentDialog({ kind, lookups, saving, message, onClose, onSubmit }: { kind: Kind; lookups: ContentLookups; saving: boolean; message: string; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const isDownload = kind === 'downloads'; const isVideo = kind === 'videos';
  const input = 'w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500';
  const label = 'block text-xs font-extrabold uppercase tracking-wide text-slate-600';
  const [provider, setProvider] = useState('jitsi');
  const [fileName, setFileName] = useState('');
  const providerNote = provider==='jitsi' ? 'Free Jitsi room — paste a room URL; this page does not create a room automatically.' : provider==='custom' ? 'Paste the custom meeting URL for students.' : `Connect ${provider==='google_meet'?'Google Meet':provider} in Integrations or paste an existing meeting URL.`;
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/50 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="content-dialog-title" className="my-auto max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><header className={`sticky top-0 z-10 flex items-center justify-between px-6 py-5 text-white ${kind==='live-classes'?'bg-gradient-to-r from-slate-900 to-indigo-900':'bg-blue-700'}`}><div><h2 id="content-dialog-title" className="text-xl font-black">{isDownload?'Upload New Content':isVideo?'Add Video Lecture':'Schedule Live Class'}</h2><p className="mt-1 text-sm text-blue-100">{isDownload?'Share PDF documents & images with students & staff.':isVideo?'Add a recorded lecture or external video link.':'Choose your video platform and fill in class details.'}</p></div><button onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-white/10"><Icon name="close"/></button></header><form onSubmit={onSubmit} className="space-y-6 p-6">
    {kind==='live-classes' && <><input type="hidden" name="provider" value={provider}/><div><p className={label}>Video Platform *</p><div className="mt-2 grid gap-2 sm:grid-cols-5">{[['jitsi','Jitsi Meet'],['zoom','Zoom'],['google_meet','Google Meet'],['teams','Teams'],['custom','Custom Link']].map(([value,name])=><button key={value} type="button" onClick={() => setProvider(value)} className={`rounded-xl border p-3 text-sm font-bold ${provider===value?'border-blue-500 bg-blue-50 text-blue-700':'border-slate-200 text-slate-600'}`}>{name}<small className="mt-1 block text-[10px] font-medium text-slate-400">{value==='jitsi'?'Free, no config':value==='custom'?'Any meeting URL':'Provider connection'}</small></button>)}</div><p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{providerNote}</p></div></>}
    <div className="grid gap-4 sm:grid-cols-2"><label className={`${label} ${isDownload||isVideo||kind==='live-classes'?'sm:col-span-2':''}`}>{kind==='live-classes'?'Class Title': 'Title'} *<input name="title" required maxLength={180} className={`${input} mt-2`} placeholder={isVideo?'e.g. Laws of Motion — Complete Chapter':isDownload?'e.g. Chapter 3 Integration Formula Sheet':'e.g. JEE Physics — Electrostatics Revision'}/></label>
      {isDownload && <><label className={label}>Content Type *<select name="contentType" className={`${input} mt-2`}><option>Assignment</option><option>Circular</option><option>Syllabus</option><option>Notes</option><option>Study Material</option><option>Other</option></select></label><label className={label}>Access Permission *<select name="accessPermission" className={`${input} mt-2`}><option value="view_download">View & Download (Allow File Export)</option><option value="view_only">View Only</option><option value="staff_only">Staff Only</option></select></label><label className={label}>Subject (Optional)<select name="subjectId" className={`${input} mt-2`}><option value="">None</option>{lookups.subjects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><input name="subjectName" className={`${input} mt-2`} placeholder="Or enter subject name"/></label><label className={label}>External Video URL (Optional)<input name="externalUrl" type="url" className={`${input} mt-2`} placeholder="https://www.youtube.com/watch?v=…"/></label></>}
      {isVideo && <><label className={label}>Batch<select name="batchId" className={`${input} mt-2`}><option value="">All Batches</option>{lookups.batches.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>{lookups.batches.length===0&&<small className="mt-1 block normal-case text-amber-700">No batches yet. Create batches first, or make this lecture available to all batches.</small>}</label><label className={label}>Subject<select name="subjectId" className={`${input} mt-2`}><option value="">None</option>{lookups.subjects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className={label}>Chapter<input name="chapter" className={`${input} mt-2`} placeholder="e.g. Chapter 3 - Newton's Laws"/></label><label className={label}>Topic<input name="topic" className={`${input} mt-2`} placeholder="e.g. Free Body Diagrams"/></label><label className={`${label} sm:col-span-2`}>YouTube / External URL<input name="externalUrl" type="url" className={`${input} mt-2`} placeholder="https://youtube.com/watch?v=..."/><span className="my-2 block text-center font-medium">OR Upload MP4 (max 50MB)</span><input name="video" type="file" accept="video/mp4,.mp4" className={`${input} font-medium`} onChange={event => setFileName(event.target.files?.[0]?.name || '')}/>{fileName&&<span className="mt-1 block normal-case">{fileName}</span>}</label><label className={label}>Unlock Date (Drip Access)<input name="unlockAt" type="datetime-local" className={`${input} mt-2`}/><small className="mt-1 block normal-case text-slate-500">Leave blank = available immediately.</small></label></>}
      {kind==='live-classes' && <><label className={label}>Topic<input name="topic" className={`${input} mt-2`} placeholder="Specific topic for today"/></label><label className={label}>Teacher *<select name="teacherKey" required className={`${input} mt-2`} defaultValue=""><option value="">Select teacher</option>{lookups.teachers.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>{lookups.teachers.length===0&&<small className="mt-1 block normal-case text-amber-700">Add a staff member first to schedule a class.</small>}</label><label className={label}>Subject<select name="subjectId" className={`${input} mt-2`}><option value="">None</option>{lookups.subjects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className={label}>Batch<select name="batchId" className={`${input} mt-2`}><option value="">All Batches</option>{lookups.batches.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>{lookups.batches.length===0&&<small className="mt-1 block normal-case text-amber-700">No batches yet. Create batches first, or leave this class open to all batches.</small>}</label><label className={label}>Date & Time *<input name="scheduledAt" required type="datetime-local" className={`${input} mt-2`}/></label><label className={label}>Duration (Minutes) *<input name="durationMinutes" required type="number" min={1} max={720} defaultValue={60} className={`${input} mt-2`}/></label><label className={`${label} sm:col-span-2`}>Meeting URL<input name="meetingUrl" type="url" className={`${input} mt-2`} placeholder="https://..."/></label><label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 sm:col-span-2"><input name="recurringDaily" type="checkbox" className="mt-1"/><span><b>Make this a Daily Recurring Class</b><small className="mt-1 block">Students will use the same link every day.</small></span></label></>}
    </div>
    {(isDownload||isVideo) && <label className={`${label} block`}>Description (Optional)<textarea name="description" rows={3} className={`${input} mt-2`} placeholder="Add additional details or instructions for students/staff…"/></label>}
    {isDownload && <><label className={`${label} block`}>Upload Attachments (PDF & Images Only, max 50MB each)<input name="attachments" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className={`${input} mt-2 font-medium`}/></label><label className={label}>Status<select name="status" className={`${input} mt-2`}><option value="published">Publish now</option><option value="draft">Save draft</option><option value="scheduled">Schedule</option></select></label></>}
    {kind==='live-classes'&&<label className={`${label} block`}>Notes<textarea name="notes" rows={2} className={`${input} mt-2`}/></label>}
    {message&&<p role="alert" className="text-sm text-rose-600">{message}</p>}
    <div className="flex justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-5 py-2.5 font-bold text-slate-600">Cancel</button><button disabled={saving} className="rounded-xl bg-blue-600 px-5 py-2.5 font-bold text-white disabled:opacity-60">{saving?'Saving…':kind==='downloads'?'Upload Content':kind==='videos'?'Save Video':'Schedule Class'}</button></div>
  </form></section></div>;
}
