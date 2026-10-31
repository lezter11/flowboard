'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icon';
import { RESUME_MS, toastLifetime, toastRegion } from '@/lib/toast-policy';

interface ToastOptions { tone?: 'danger' | 'success'; icon?: string; undo?: () => void; /** A remedy button, such as Try again. A toast with one never times out. */ action?: { label: string; onClick: () => void } }
interface ToastItem extends ToastOptions { id: number; message: string }
type ToastFn = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<ToastFn | null>(null);

export function useToast(): ToastFn {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast must be used inside ToastProvider');
  return toast;
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useCallback(() => onDismiss(item.id), [item.id, onDismiss]);
  const start = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(dismiss, ms);
  }, [dismiss]);
  useEffect(() => {
    const ms = toastLifetime(item);
    if (ms !== null) start(ms);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [item, start]);
  const pause = () => { if (timer.current) clearTimeout(timer.current); };
  const resume = () => { if (toastLifetime(item) !== null) start(RESUME_MS); };
  return (
    <div
      className={`toast${item.tone ? ` tone-${item.tone}` : ''}`}
      style={{ animation: 'toast-in 180ms cubic-bezier(0.2, 0.75, 0.25, 1) both' }}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <Icon name={item.icon ?? (item.tone === 'danger' ? 'alert' : 'check')} />
      <span className="toast-message">{item.message}</span>
      {item.action && <button className="toast-undo" type="button" onClick={() => { item.action?.onClick(); dismiss(); }}>{item.action.label}</button>}
      {item.undo && <button className="toast-undo" type="button" onClick={() => { item.undo?.(); dismiss(); }}>Undo</button>}
      <button className="toast-close" type="button" aria-label="Dismiss notification" onClick={dismiss}><Icon name="x" /></button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const toast = useCallback<ToastFn>((message, options) => {
    const id = nextId.current++;
    setItems((current) => [...current.slice(-2), { id, message, ...options }]);
  }, []);
  const remove = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const value = useMemo(() => toast, [toast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" id="toasts">
        <div role="status" aria-live="polite" aria-atomic="false">{items.filter((i) => toastRegion(i) === 'polite').map((item) => <ToastView key={item.id} item={item} onDismiss={remove} />)}</div>
        <div role="alert" aria-live="assertive" aria-atomic="false">{items.filter((i) => toastRegion(i) === 'assertive').map((item) => <ToastView key={item.id} item={item} onDismiss={remove} />)}</div>
      </div>
    </ToastContext.Provider>
  );
}
