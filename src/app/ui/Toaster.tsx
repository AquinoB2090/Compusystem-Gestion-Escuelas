'use client';

import { useEffect, useRef, useState } from 'react';

export type ToastTone = 'success' | 'error' | 'info';

type ToastItem = { id: number; message: string; tone: ToastTone };

const TOAST_EVENT = 'compusystem:toast';
const DURATIONS: Record<ToastTone, number> = { success: 4500, info: 4500, error: 7000 };
let nextId = 0;

function notify(message: string, tone: ToastTone) {
  if (typeof window === 'undefined' || !message) return;
  nextId += 1;
  window.dispatchEvent(new CustomEvent<ToastItem>(TOAST_EVENT, { detail: { id: nextId, message, tone } }));
}

export const toast = {
  success: (message: string) => notify(message, 'success'),
  error: (message: string) => notify(message, 'error'),
  info: (message: string) => notify(message, 'info'),
};

export default function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = viewportRef.current as (HTMLDivElement & { showPopover?: () => void }) | null;
    if (!el) return;
    if (items.length) {
      try {
        if (!el.matches(':popover-open')) el.showPopover?.();
      } catch {
        /* el navegador no soporta popover; el aviso se muestra igual */
      }
    } else {
      try {
        if (el.matches(':popover-open')) el.hidePopover?.();
      } catch {
        /* sin soporte de popover */
      }
    }
  }, [items.length]);

  useEffect(() => {
    const dismiss = (id: number) => {
      setItems((current) => current.filter((item) => item.id !== id));
      const timer = timers.current.get(id);
      if (timer) {
        window.clearTimeout(timer);
        timers.current.delete(id);
      }
    };

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ToastItem>).detail;
      if (!detail?.message) return;
      setItems((current) => [...current.filter((item) => item.id !== detail.id), detail].slice(-4));
      const timer = window.setTimeout(() => dismiss(detail.id), DURATIONS[detail.tone]);
      timers.current.set(detail.id, timer);
    };

    window.addEventListener(TOAST_EVENT, handler);
    const activeTimers = timers.current;
    return () => {
      window.removeEventListener(TOAST_EVENT, handler);
      activeTimers.forEach((timer) => window.clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  const dismiss = (id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  };

  return (
    <div ref={viewportRef} popover="manual" className="toast-viewport" aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <div
          className={`toast toast-${item.tone}`}
          key={item.id}
          role={item.tone === 'error' ? 'alert' : 'status'}
          style={{ ['--toast-duration' as string]: `${DURATIONS[item.tone]}ms` }}
        >
          <span className="toast-icon" aria-hidden="true">
            {item.tone === 'success' ? '✓' : item.tone === 'error' ? '!' : 'i'}
          </span>
          <p>{item.message}</p>
          <button type="button" className="toast-close" onClick={() => dismiss(item.id)} aria-label="Cerrar aviso">
            ×
          </button>
          <span className="toast-progress" aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}
