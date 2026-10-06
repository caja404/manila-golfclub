import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Snapshot } from '../../shared/types.ts';

interface Live {
  snap: Snapshot | null;
  connected: boolean;
  /** Milliseconds to add to the local clock to match the server clock. */
  skew: number;
}

type Message = { type: 'snapshot'; snap: Snapshot } | { type: 'status'; connected: boolean } | { type: 'hello' };

const LiveContext = createContext<Live>({ snap: null, connected: false, skew: 0 });

const CHANNEL = 'mgc-live';
const LEADER_LOCK = 'mgc-live-leader';

/**
 * Live board updates. The server pushes the whole board after every change over server-sent events.
 * Browsers allow only six open connections per server, so tabs in the same browser share one stream:
 * the tab holding a Web Lock keeps the stream open and relays it to the others over a BroadcastChannel.
 * When that tab closes, the lock passes to another tab, which opens the stream.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [live, setLive] = useState<Live>({ snap: null, connected: false, skew: 0 });

  useEffect(() => {
    let es: EventSource | null = null;
    let latest: Snapshot | null = null;
    let release: (() => void) | null = null;
    let stopped = false;

    const apply = (snap: Snapshot) => setLive({ snap, connected: true, skew: snap.now - Date.now() });
    const setConnected = (connected: boolean) => setLive((l) => ({ ...l, connected }));

    const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
    const send = (m: Message) => bc?.postMessage(m);

    const lead = () => {
      es = new EventSource('/api/stream');
      es.addEventListener('snapshot', (e) => {
        latest = JSON.parse((e as MessageEvent).data) as Snapshot;
        apply(latest);
        send({ type: 'snapshot', snap: latest });
      });
      es.onerror = () => {
        setConnected(false);
        send({ type: 'status', connected: false });
      };
    };

    if (bc) {
      bc.onmessage = (e: MessageEvent<Message>) => {
        const m = e.data;
        if (m.type === 'snapshot') apply(m.snap);
        else if (m.type === 'status') setConnected(m.connected);
        else if (m.type === 'hello' && es && latest) send({ type: 'snapshot', snap: latest });
      };
    }

    // Paint immediately from a plain request; the stream (direct or relayed) takes over from there.
    fetch('/api/snapshot')
      .then((r) => r.json())
      .then((snap: Snapshot) => setLive((l) => (l.snap ? l : { snap, connected: l.connected, skew: snap.now - Date.now() })))
      .catch(() => {});

    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (bc && locks) {
      locks
        .request(LEADER_LOCK, () => {
          if (stopped) return;
          lead();
          // Hold the lock until this tab unmounts or closes.
          return new Promise<void>((resolve) => (release = resolve));
        })
        .catch(() => {});
      send({ type: 'hello' });
    } else {
      lead();
    }

    return () => {
      stopped = true;
      es?.close();
      release?.();
      bc?.close();
    };
  }, []);

  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);

/** Server-aligned current time, re-rendering every `everyMs`. */
export function useNow(everyMs = 1000) {
  const { skew } = useLive();
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    setNow(Date.now() + skew);
    const t = setInterval(() => setNow(Date.now() + skew), everyMs);
    return () => clearInterval(t);
  }, [skew, everyMs]);
  return now;
}
