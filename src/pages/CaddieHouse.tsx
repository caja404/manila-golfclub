import { useEffect, useState } from 'react';
import { callStart, clock, elapsed, isNoShow, longDate, shortName } from '../lib/format.ts';
import { useLive, useNow } from '../lib/live.tsx';
import { RULES, type Dispatch } from '../../shared/types.ts';
import '../styles/display.css';

/** Calls that fit on screen; rows shrink as calls are added so no-shows stay visible after a Call next 5. */
const MAX_CALLS = 8;

/**
 * Caddie House TV. Read-only and silent: caddies carry no devices and the course has no
 * tolerance for device noise, so a new call is shown in marker yellow for a minute instead.
 */
export function CaddieHouse() {
  const { snap, connected } = useLive();
  const now = useNow();
  const [full, setFull] = useState(false);

  useEffect(() => {
    document.title = 'Caddie House · MGC';
    // Keep the TV awake where the browser allows it.
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<typeof lock> } };
    const ask = () => nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    ask();
    const onVis = () => document.visibilityState === 'visible' && ask();
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      lock?.release().catch(() => {});
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  if (!snap) {
    return (
      <div className="tv">
        <p className="tv-connecting">Connecting to Bag Drop…</p>
      </div>
    );
  }

  // Newest calls first; a batch from Call next 5 keeps queue order.
  const calls = snap.active
    .filter((d) => d.status === 'called')
    .sort((a, b) => callStart(b) - callStart(a) || a.id - b.id);
  const standby = snap.active.filter((d) => d.status === 'standby').sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0));
  const line = snap.shifts.filter((s) => s.status === 'waiting');
  const onBreak = snap.shifts.filter((s) => s.status === 'break');
  const waitingFor = snap.active.filter((d) => d.status === 'pending' && d.reason === 'designated');
  // Keep the side column on one screen: fewer queue rows when members are waiting for a designated caddie.
  const lineRows = waitingFor.length ? 4 : 6;
  const onCourse = snap.active
    .filter((d) => d.status === 'out')
    .sort((a, b) => (a.arrivedAt ?? 0) - (b.arrivedAt ?? 0));

  return (
    <div className="tv" data-calls={Math.min(calls.length, MAX_CALLS)}>
      <header className="tv-head">
        <div className="tv-brand">
          <b>Manila Golf Club</b>
          <span>Caddie House</span>
        </div>
        <div className="tv-time">
          <b className="num">{clock(now)}</b>
          <span>{longDate(now)}</span>
        </div>
      </header>

      <main className="tv-main">
        <section className="tv-calls" aria-live="polite">
          <h2 className="tv-h">
            Report to Bag Drop <span className="num">{calls.length || ''}</span>
          </h2>
          {calls.length === 0 ? (
            <div className="tv-nocall">
              <p>No calls right now.</p>
              {line[0] && (
                <p className="tv-nextup">
                  Next up: <b className="num">Cart {line[0].cartNumber}</b> {line[0].caddieName}
                </p>
              )}
            </div>
          ) : (
            <ol className="tv-calllist">
              {calls.slice(0, MAX_CALLS).map((d) => (
                <CallRow key={d.id} d={d} now={now} />
              ))}
              {calls.length > MAX_CALLS && <li className="tv-more">+{calls.length - MAX_CALLS} more called</li>}
            </ol>
          )}
          {standby.length > 0 && (
            <p className="tv-standby">
              <span>Standing by at Bag Drop</span>
              {standby.map((d) => (
                <b key={d.id} className="num">
                  {d.cartNumber} <span>{d.caddieName}</span>
                </b>
              ))}
            </p>
          )}
        </section>

        <aside className="tv-side">
          <section>
            <h2 className="tv-h">
              Next in line <span className="num">{line.length}</span>
            </h2>
            {line.length === 0 ? (
              <p className="tv-dim">Nobody waiting.</p>
            ) : (
              <ol className="tv-line">
                <li className="tv-cols" aria-hidden="true">
                  <span>No.</span>
                  <span>Cart</span>
                  <span>Caddie</span>
                </li>
                {line.slice(0, lineRows).map((s) => (
                  <li key={s.id}>
                    <span className="tv-pos num">{s.position}</span>
                    <span className="tv-cart num">{s.cartNumber}</span>
                    <span className="tv-name">{s.caddieName}</span>
                  </li>
                ))}
                {line.length > lineRows && <li className="tv-dim tv-moreline">and {line.length - lineRows} more in line</li>}
              </ol>
            )}
          </section>

          {waitingFor.length > 0 && (
            <section>
              <h2 className="tv-h">Member waiting for you</h2>
              <ul className="tv-waitfor">
                {waitingFor.map((d) => (
                  <li key={d.id}>
                    <b>{d.requestedCaddieName}</b>
                    <span>
                      {d.members.map((m) => shortName(m.name)).join(', ')} at Bag Drop, {elapsed(now - d.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="tv-h">
              On course <span className="num">{onCourse.length}</span>
            </h2>
            <ul className="tv-course">
              {onCourse.slice(0, 6).map((d) => (
                <li key={d.id}>
                  <span className="tv-cart num">{d.cartNumber}</span>
                  <span className="tv-name">{d.caddieName}</span>
                </li>
              ))}
            </ul>
          </section>

          {onBreak.length > 0 && (
            <p className="tv-dim tv-break">On break: {onBreak.map((s) => `${s.caddieName} (${s.cartNumber})`).join(', ')}</p>
          )}
        </aside>
      </main>

      {!connected && <div className="tv-offline">Connection lost. Reconnecting…</div>}
      {!full && document.fullscreenEnabled && (
        <button className="tv-fs" onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>
          Full screen
        </button>
      )}
    </div>
  );
}

function CallRow({ d, now }: { d: Dispatch; now: number }) {
  const since = now - callStart(d);
  const fresh = since < RULES.freshCallMinutes * 60_000;
  const late = isNoShow(d, now);
  return (
    <li className={`tv-call${fresh ? ' is-fresh' : ''}${late ? ' is-late' : ''}`}>
      <div className="tv-plate">
        <small>Cart</small>
        <b className="num">{d.cartNumber}</b>
      </div>
      <div className="tv-callbody">
        <div className="tv-callname">{d.caddieName}</div>
        <div className="tv-callmeta">
          <div className="tv-callfor">
            {d.members.length === 0
              ? 'For the next member'
              : `${d.reason === 'designated' ? 'Requested by ' : 'For '}${d.members.map((m) => shortName(m.name)).join(', ')}`}
            {d.members.some((m) => m.storageTag) && (
              <span className="tv-bag"> · Storage bag {d.members.filter((m) => m.storageTag).map((m) => m.storageTag).join(', ')}</span>
            )}
          </div>
          <div className="tv-callwhen">
            {late ? (
              <span className="tv-late num">Called {elapsed(since)} ago</span>
            ) : (
              <span className="num">
                {clock(callStart(d))}
                {d.members.length > 0 && ` · ${d.holes} holes`}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
