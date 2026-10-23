import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiRequestError } from '../services/api';
import { currentAccount } from '../services/auth';

export default function PasswordChangeGate({children}:{children:ReactNode}){const location=useLocation(),navigate=useNavigate();const initialPath=useRef(location.pathname);const [error,setError]=useState(''),[checking,setChecking]=useState(true),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setChecking(true);setError('');currentAccount().then(({account})=>{if(active&&account.mustChangePassword)navigate('/change-password',{replace:true,state:{from:initialPath.current}})}).catch(cause=>{if(!active)return;if(cause instanceof ApiRequestError&&cause.status===401)return;setError('Your session could not be checked. Retry when the server is available.');}).finally(()=>{if(active)setChecking(false)});return()=>{active=false}},[navigate,retry]);
 if(checking)return <div role="status" className="grid min-h-screen place-items-center text-slate-500">Checking your session…</div>;
 if(error)return <main role="alert" className="grid min-h-screen place-items-center p-6"><section className="max-w-md rounded-2xl border bg-white p-7"><h1 className="text-xl font-bold">Session check failed</h1><p className="mt-2 text-sm text-slate-600">{error}</p><button onClick={()=>setRetry(x=>x+1)} className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white">Retry</button></section></main>;
 return <>{children}</>;
}
