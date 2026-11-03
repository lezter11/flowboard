'use client';
import { useState } from 'react';
import { initials, toneFor } from '@/lib/people';
import { safeGoogleAvatar } from '@/lib/preferences-state';

export function Avatar({ id, name, className, avatarUrl }: { id: string; name: string; className?: string; avatarUrl?:string|null }) {
  const src=safeGoogleAvatar(avatarUrl);const [failed,setFailed]=useState<string|null>(null);
  return <span className={`avatar ${toneFor(id)}${className ? ` ${className}` : ''}`} title={name} aria-hidden="true">
    {src&&failed!==src ? <img className="avatar-image" src={src} alt="" referrerPolicy="no-referrer" crossOrigin="anonymous" loading="lazy" onError={()=>setFailed(src)} /> : initials(name)}
  </span>;
}
