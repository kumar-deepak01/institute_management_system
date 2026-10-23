import { useEffect, useState, type ChangeEvent } from 'react';
import imageCompression from 'browser-image-compression';
import { Avatar } from './Avatar';

export interface PhotoUploadProps {
  name?: string;
  src?: string | null;
  onSelect: (file: File | null, remove?: boolean) => void;
  disabled?: boolean;
}

const MAX_BYTES = 50 * 1024;

export function PhotoUpload({ name, src, onSelect, disabled = false }: PhotoUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG, or WebP image.');
      setPreview(null);
      onSelect(null, false);
      input.value = '';
      return;
    }
    try {
      let compressed: File | Blob | null = null;
      for (const quality of [0.8, 0.65, 0.5, 0.35]) {
        compressed = await imageCompression(file, {
          maxSizeMB: 0.05, maxWidthOrHeight: 400, useWebWorker: true, fileType: 'image/webp', initialQuality: quality,
        });
        if (compressed.size <= MAX_BYTES) break;
      }
      if (!compressed || compressed.size > MAX_BYTES) throw new Error('Could not compress this image below 50 KB. Choose a simpler image.');
      const webp = new File([compressed], 'profile.webp', { type: 'image/webp', lastModified: Date.now() });
      setPreview(URL.createObjectURL(webp));
      onSelect(webp);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Photo compression failed.');
      setPreview(null);
      onSelect(null, false);
    } finally { input.value = ''; }
  }

  function clear() {
    setPreview(null);
    setError('');
    onSelect(null, true);
  }

  return <div className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-slate-300 p-4">
    <Avatar src={preview || src} name={name} size="xl" />
    <div className="min-w-0 flex-1">
      <p className="text-sm font-bold">Profile photo</p>
      <p className="mt-1 text-xs text-slate-500">JPEG, PNG, or WebP · compressed to 400×400 and under 50 KB.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <label className={`cursor-pointer rounded-lg border px-3 py-2 text-xs font-bold ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
          Choose photo
          <input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={event => void choose(event)} className="sr-only" />
        </label>
        {(preview || src) && <button type="button" disabled={disabled} onClick={clear} className="rounded-lg border px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">Remove</button>}
      </div>
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{error}</p>}
    </div>
  </div>;
}
