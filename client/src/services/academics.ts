import { apiRequest } from './api';
export type AcademicKind='homework'|'doubts';
export type AcademicRecord={id:string;title:string;status:string;createdAt?:string|null;batchId?:string;batchName?:string;subjectId?:string;subject?:string;studentKey?:string;staffKey?:string;question?:string;description?:string;dueDate?:string};
export type AcademicList={records:AcademicRecord[];total:number;page:number;limit:number;pages:number;schemaPending?:boolean};
export type AcademicLookups={batches:Array<{id:string;name:string}>;subjects:Array<{id:string;name:string;courseId?:string}>;students:Array<{id:string;name:string;batchId?:string}>;staff:Array<{id:string;staffKey?:string;name:string}>;schemaPending?:boolean};
export type AcademicStats={homework_total:number;homework_active:number;homework_pending:number;doubts_total:number;doubts_open:number;schemaPending?:boolean};
export const listAcademicRecords=(kind:AcademicKind,options:{page:number;limit:number;q:string;status:string})=>{const q=new URLSearchParams();Object.entries(options).forEach(([k,v])=>{if(v)q.set(k,String(v));});return apiRequest<AcademicList>(`/api/admin/academics/${kind}?${q}`);};
export const getAcademicLookups=()=>apiRequest<AcademicLookups>('/api/admin/academics/lookups');
export const getAcademicStats=()=>apiRequest<AcademicStats>('/api/admin/academics/stats');
async function csrf(){const response=await apiRequest<{csrfToken:string}>('/api/auth/csrf');return {'X-CSRF-Token':response.csrfToken};}
export const createAcademicRecord=async(kind:AcademicKind,record:Record<string,string>)=>apiRequest<{record:AcademicRecord}>(`/api/admin/academics/${kind}`,{method:'POST',headers:await csrf(),body:record});
export const updateDoubtStatus=async(id:string,status:string)=>apiRequest<{record:AcademicRecord}>(`/api/admin/academics/doubts/${encodeURIComponent(id)}`,{method:'PATCH',headers:await csrf(),body:{status}});
