import { useEffect, useState } from 'react';

export interface AvatarProps {
  src?: string | null;
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizes: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-14 w-14 text-base', xl: 'h-24 w-24 text-2xl',
};

export function Avatar({ src, name = '', size = 'md', className = '' }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || '').join('') || '•';
  const base = `${sizes[size]} ${className} inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-100 font-bold text-indigo-700`;
  return src && !failed
    ? <img src={src} alt={name ? `${name} profile photo` : 'Profile photo'} onError={() => setFailed(true)} className={`${base} object-cover`} />
    : <span role="img" aria-label={name ? `${name} default avatar` : 'Default avatar'} className={base}>{initials}</span>;
}
