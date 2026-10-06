import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { clock } from '../lib/format.ts';
import { useLive, useNow } from '../lib/live.tsx';
import { api } from '../lib/api.ts';
import type { Member } from '../../shared/types.ts';

export function TopBar({ station }: { station: string }) {
  const now = useNow(10_000);
  const { connected, snap } = useLive();
  return (
    <header className="topbar">
      <NavLink to="/" className="wordmark">
        <b>Manila Golf Club</b>
        <span>{station}</span>
      </NavLink>
      <nav aria-label="Stations">
        <NavLink to="/bag-drop">Bag Drop</NavLink>
        <NavLink to="/caddie-master">Caddie Master</NavLink>
        <NavLink to="/caddie-house" target="_blank">
          Caddie House display
        </NavLink>
      </nav>
      {snap && !connected && <span className="conn">Reconnecting…</span>}
      <span className="clock num">{clock(now)}</span>
    </header>
  );
}

export function Plate({ number, small }: { number: string | null; small?: boolean }) {
  return (
    <div className={`plate${number ? '' : ' is-empty'}${small ? ' is-small' : ''}`} aria-label={number ? `Cart ${number}` : 'No cart yet'}>
      {!small && <small>CART</small>}
      <b>{number ?? '—'}</b>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- Toasts and actions ----

type Toast = { text: string; error?: boolean } | null;
const ToastContext = createContext<(t: Toast) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  const timer = useRef<number>();
  const show = useCallback((t: Toast) => {
    setToast(t);
    window.clearTimeout(timer.current);
    if (t) timer.current = window.setTimeout(() => setToast(null), t.error ? 6000 : 3000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast${toast.error ? ' is-error' : ''}`} role={toast.error ? 'alert' : 'status'}>
          {toast.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}

/** Run an API action, show the result as a toast, and track busy state. */
export function useAction() {
  const toast = useContext(ToastContext);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string | ((result: T) => string)) => {
      setBusy(true);
      try {
        const result = await fn();
        const text = typeof success === 'function' ? success(result) : success;
        if (text) toast({ text });
        return true;
      } catch (e) {
        toast({ text: (e as Error).message, error: true });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

// ---- Member lookup (name or member number) ----

export function MemberSearch({
  id,
  onPick,
  exclude = [],
  placeholder = 'Name or member number',
  autoFocus,
}: {
  id: string;
  onPick: (m: Member) => void;
  exclude?: number[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  // Closing waits briefly so a click on a result lands; refocusing or typing cancels it.
  const closeTimer = useRef<number>();
  const show = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.get<Member[]>(`/members?q=${encodeURIComponent(q)}`).then((r) => {
        setResults(r.filter((m) => !exclude.includes(m.id)));
        setHi(0);
      });
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, exclude.join(',')]);

  const pick = (m: Member) => {
    onPick(m);
    setQ('');
    setResults([]);
  };

  return (
    <div className="msearch">
      <input
        id={id}
        className="input"
        value={q}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value);
          show();
        }}
        onFocus={show}
        onBlur={() => (closeTimer.current = window.setTimeout(() => setOpen(false), 150))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, results.length - 1));
          if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0));
          if (e.key === 'Enter' && results[hi]) {
            e.preventDefault();
            pick(results[hi]);
          }
        }}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
      />
      {open && q.trim() && (
        <ul className="msearch-list" id={`${id}-list`} role="listbox">
          {results.length === 0 && <li className="msearch-none">No member matches “{q}”.</li>}
          {results.map((m, i) => (
            <li
              key={m.id}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(m);
              }}
              onMouseEnter={() => setHi(i)}
            >
              <span className="msearch-name">{m.name}</span>
              <span className="msearch-no num">#{m.memberNo}</span>
              {m.designatedCaddieName && <span className="msearch-des">Caddie: {m.designatedCaddieName}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
