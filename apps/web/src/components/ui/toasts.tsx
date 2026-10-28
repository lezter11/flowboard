'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icon';

interface ToastOptions { tone?: 'danger' | 'success'; icon?: string; undo?: () => void }
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
    start(item.undo ? 8000 : 4500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [item.undo, start]);
  return (
    <div
      className={`toast${item.tone ? ` tone-${item.tone}` : ''}`}
      style={{ animation: 'toast-in 180ms cubic-bezier(0.2, 0.75, 0.25, 1) both' }}
      onMouseEnter={() => timer.current && clearTimeout(timer.current)}
      onMouseLeave={() => start(2500)}
    >
      <Icon name={item.icon ?? (item.tone === 'danger' ? 'alert' : 'check')} />
      <span className="toast-message">{item.message}</span>
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
      <div className="toasts" id="toasts" role="status" aria-live="polite" aria-atomic="false">
        {items.map((item) => <ToastView key={item.id} item={item} onDismiss={remove} />)}
      </div>
    </ToastContext.Provider>
  );
}
