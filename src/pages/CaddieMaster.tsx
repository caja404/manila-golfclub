import { useEffect, useMemo, useState } from 'react';
import { TopBar, useAction } from '../components/ui.tsx';
import { NextBar } from '../components/NextBar.tsx';
import { api } from '../lib/api.ts';
import { clock, clubDate, elapsed, isNoShow, isOverdue, memberList, minutesLabel, shortDate, SHIFT_LABEL } from '../lib/format.ts';
import { useLive, useNow } from '../lib/live.tsx';
import type { Member, Report, Shift, Snapshot } from '../../shared/types.ts';
import '../styles/master.css';

type Tab = 'queue' | 'checkin' | 'designated' | 'reports';

export function CaddieMaster() {
  const [tab, setTab] = useState<Tab>(() => {
    const t = location.hash.slice(1) as Tab;
    return ['queue', 'checkin', 'designated', 'reports'].includes(t) ? t : 'queue';
  });
  const { snap } = useLive();
  const notIn = snap ? snap.caddies.length - snap.shifts.length : 0;

  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };

  return (
    <>
      <TopBar station="Caddie Master" />
      <main className="page">
        <div className="page-head">
          <h1>Caddie Master</h1>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'queue'} onClick={() => go('queue')}>
              Queue
            </button>
            <button role="tab" aria-selected={tab === 'checkin'} onClick={() => go('checkin')}>
              Check-in{notIn > 0 && <span className="tab-count num"> {notIn}</span>}
            </button>
            <button role="tab" aria-selected={tab === 'designated'} onClick={() => go('designated')}>
              Designated caddies
            </button>
            <button role="tab" aria-selected={tab === 'reports'} onClick={() => go('reports')}>
              Reports
            </button>
          </div>
          <ResetDemo />
        </div>
        {!snap ? (
          <p className="muted">Connecting to the dispatch server…</p>
        ) : tab === 'queue' ? (
          <QueueTab snap={snap} />
        ) : tab === 'checkin' ? (
          <CheckInTab snap={snap} />
        ) : tab === 'designated' ? (
          <DesignatedTab snap={snap} />
        ) : (
          <ReportsTab />
        )}
      </main>
    </>
  );
}

function ResetDemo() {
  const { run, busy } = useAction();
  const [ask, setAsk] = useState(false);
  return ask ? (
    <span className="confirm">
      Replace all data with the demo morning?
      <button className="btn btn-small btn-danger" disabled={busy} onClick={() => run(() => api.post('/admin/reset-demo'), 'Demo data restored.').then(() => setAsk(false))}>
        Reset
      </button>
      <button className="btn btn-small btn-text" onClick={() => setAsk(false)}>
        Keep
      </button>
    </span>
  ) : (
    <button className="btn btn-text btn-small" onClick={() => setAsk(true)}>
      Reset demo data
    </button>
  );
}

// ---------------------------------------------------------------------------

function statusClass(s: Shift['status']) {
  return { waiting: '', called: 'is-called', out: 'is-out', break: 'is-break', off: 'is-off' }[s];
}

function QueueTab({ snap }: { snap: Snapshot }) {
  const { run, busy } = useAction();
  const now = useNow(15_000);
  const line = snap.shifts.filter((s) => s.status === 'waiting' || s.status === 'break');
  const busyShifts = snap.shifts.filter((s) => s.status === 'called' || s.status === 'out');
  const off = snap.shifts.filter((s) => s.status === 'off');
  const dispatchFor = (s: Shift) => snap.active.find((d) => d.caddieId === s.caddieId && (d.status === 'called' || d.status === 'standby' || d.status === 'out'));

  return (
    <>
    <NextBar />
    <div className="master-grid">
      <section className="section">
        <div className="section-head">
          <h2>In line</h2>
          <span className="count num">{line.filter((s) => s.status === 'waiting').length}</span>
          <span className="aside">First in line is called next. Designated caddies skip ahead.</span>
        </div>
        {line.length === 0 && <p className="empty">No caddies in line. Check caddies in from the Check-in tab.</p>}
        <ol className="qlist">
          {line.length > 0 && (
            <li className="q-cols" aria-hidden="true">
              <span>No.</span>
              <span>Cart</span>
              <span>Caddie</span>
              <span>Status</span>
              <span />
            </li>
          )}
          {line.map((s, i) => (
            <li key={s.id} className={s.status === 'break' ? 'is-break' : ''}>
              <span className="q-pos num">{s.position ?? ''}</span>
              <span className="q-cart num">{s.cartNumber}</span>
              <span className="q-name">
                {s.caddieName}
                <span className="muted small num"> {s.empNo}</span>
              </span>
              <span className={`status ${statusClass(s.status)}`}>{SHIFT_LABEL[s.status]}</span>
              <span className="q-actions">
                <button className="btn btn-small" aria-label={`Move ${s.caddieName} up`} disabled={busy || i === 0} onClick={() => run(() => api.post(`/shifts/${s.id}/move`, { direction: 'up' }))}>
                  ↑
                </button>
                <button
                  className="btn btn-small"
                  aria-label={`Move ${s.caddieName} down`}
                  disabled={busy || i === line.length - 1}
                  onClick={() => run(() => api.post(`/shifts/${s.id}/move`, { direction: 'down' }))}
                >
                  ↓
                </button>
                {s.status === 'break' ? (
                  <button className="btn btn-small" disabled={busy} onClick={() => run(() => api.post(`/shifts/${s.id}/status`, { status: 'waiting' }), `${s.caddieName} is back in line.`)}>
                    Back in line
                  </button>
                ) : (
                  <button className="btn btn-small" disabled={busy} onClick={() => run(() => api.post(`/shifts/${s.id}/status`, { status: 'break' }), `${s.caddieName} is on break and keeps their place.`)}>
                    Break
                  </button>
                )}
                <button className="btn btn-small btn-text" disabled={busy} onClick={() => run(() => api.post(`/shifts/${s.id}/status`, { status: 'off' }), `${s.caddieName} checked out.`)}>
                  Check out
                </button>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div>
        <section className="section">
          <div className="section-head">
            <h2>Called and on course</h2>
            <span className="count num">{busyShifts.length}</span>
          </div>
          {busyShifts.length === 0 && <p className="empty">Nobody is out.</p>}
          <div className="table-wrap">
            <table className="data">
              {busyShifts.length > 0 && (
                <thead>
                  <tr>
                    <th>Cart</th>
                    <th>Caddie and members</th>
                    <th>Status</th>
                    <th className="r">Time</th>
                  </tr>
                </thead>
              )}
              <tbody>
                {busyShifts.map((s) => {
                  const d = dispatchFor(s);
                  const alert = d && (isNoShow(d, now) || isOverdue(d, now));
                  return (
                    <tr key={s.id}>
                      <td className="num q-cart">{s.cartNumber}</td>
                      <td>
                        {s.caddieName}
                        {d && <div className="small muted">{d.members.length ? memberList(d) : 'Called with Next, no member yet'}</div>}
                      </td>
                      <td>
                        <span className={`status ${alert ? 'is-alert' : statusClass(s.status)}`}>
                          {d && isNoShow(d, now) ? 'Not at Bag Drop' : d && isOverdue(d, now) ? 'Overdue' : d?.status === 'standby' ? 'Standing by' : SHIFT_LABEL[s.status]}
                        </span>
                      </td>
                      <td className="r small">
                        {d?.status === 'out' && d.arrivedAt ? `${elapsed(now - d.arrivedAt)}, ${d.holes} holes` : d?.calledAt ? `since ${clock(d.calledAt)}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {off.length > 0 && (
          <section className="section">
            <div className="section-head">
              <h2>Checked out</h2>
              <span className="count num">{off.length}</span>
            </div>
            <ul className="offlist">
              {off.map((s) => (
                <li key={s.id}>
                  <span>
                    {s.caddieName} <span className="muted small">Cart {s.cartNumber}</span>
                  </span>
                  <button className="btn btn-small" disabled={busy} onClick={() => run(() => api.post(`/shifts/${s.id}/status`, { status: 'waiting' }), `${s.caddieName} rejoined at the back.`)}>
                    Back on duty
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function CheckInTab({ snap }: { snap: Snapshot }) {
  const { run, busy } = useAction();
  const [carts, setCarts] = useState<Record<number, number>>({});
  const checkedIn = new Set(snap.shifts.map((s) => s.caddieId));
  const usedCarts = new Set(snap.shifts.filter((s) => s.status !== 'off').map((s) => s.cartId));
  const freeCarts = snap.carts.filter((c) => !usedCarts.has(c.id));
  const waitingFor = snap.caddies.filter((c) => !checkedIn.has(c.id));
  const pendingFor = (caddieId: number) => snap.active.filter((d) => d.status === 'pending' && d.requestedCaddieId === caddieId);

  return (
    <div className="master-grid">
      <section className="section">
        <div className="section-head">
          <h2>Not yet checked in</h2>
          <span className="count num">{waitingFor.length}</span>
          <span className="aside">Check-in order sets the queue order</span>
        </div>
        {waitingFor.length === 0 && <p className="empty">Every caddie is checked in today.</p>}
        <ul className="checkin">
          {waitingFor.map((c, i) => {
            const chosen = carts[c.id];
            const cart = chosen && freeCarts.some((k) => k.id === chosen) ? chosen : (freeCarts[i]?.id ?? freeCarts[0]?.id);
            const waiting = pendingFor(c.id);
            return (
              <li key={c.id}>
                <div className="ci-who">
                  <strong>{c.name}</strong>
                  <span className="muted small num">{c.empNo}</span>
                  {waiting.length > 0 && (
                    <span className="status is-pending">
                      {waiting.map((d) => d.members.map((m) => m.name).join(', ')).join('; ')} waiting
                    </span>
                  )}
                </div>
                <label className="ci-cart">
                  <span className="label">Cart</span>
                  <select
                    id={`cart-${c.id}`}
                    className="input"
                    value={cart ?? ''}
                    onChange={(e) => setCarts((m) => ({ ...m, [c.id]: Number(e.target.value) }))}
                  >
                    {freeCarts.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.number}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn btn-primary"
                  disabled={busy || !cart}
                  onClick={() =>
                    run(
                      () => api.post('/shifts', { caddieId: c.id, cartId: cart }),
                      `${c.name} checked in on Cart ${snap.carts.find((k) => k.id === cart)?.number}.`,
                    )
                  }
                >
                  Check in
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Carts today</h2>
          <span className="count num">
            {usedCarts.size}/{snap.carts.length}
          </span>
        </div>
        <div className="cartmap">
          {snap.carts.map((k) => {
            const s = snap.shifts.find((x) => x.cartId === k.id && x.status !== 'off');
            return (
              <div key={k.id} className={`cartcell${s ? '' : ' is-free'}`}>
                <b className="num">{k.number}</b>
                <span>{s ? s.caddieName.split(' ')[0] + ' ' + s.caddieName.split(' ').slice(-1)[0][0] + '.' : 'Free'}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DesignatedTab({ snap }: { snap: Snapshot }) {
  const { run, busy } = useAction();
  const [members, setMembers] = useState<Member[]>([]);
  const [q, setQ] = useState('');
  const [onlyAssigned, setOnlyAssigned] = useState(false);

  useEffect(() => {
    api.get<Member[]>('/designations').then(setMembers);
  }, [snap]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return members.filter(
      (m) => (!onlyAssigned || m.designatedCaddieId) && (!t || m.name.toLowerCase().includes(t) || m.memberNo.startsWith(t)),
    );
  }, [members, q, onlyAssigned]);

  const load = new Map<number, number>();
  for (const m of members) if (m.designatedCaddieId) load.set(m.designatedCaddieId, (load.get(m.designatedCaddieId) ?? 0) + 1);

  return (
    <section className="section designated">
      <div className="section-head">
        <h2>Designated caddies</h2>
        <span className="count num">{members.filter((m) => m.designatedCaddieId).length}</span>
        <span className="aside">A member with a designated caddie always gets that caddie, ahead of the queue.</span>
      </div>
      <div className="filters">
        <input id="designated-filter" className="input" placeholder="Filter by member name or number" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={onlyAssigned} onChange={(e) => setOnlyAssigned(e.target.checked)} /> Only members with a designated caddie
        </label>
      </div>
      <div className="table-wrap panel">
        <table className="data">
          <thead>
            <tr>
              <th>Member</th>
              <th>No.</th>
              <th>Designated caddie</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className="num muted">{m.memberNo}</td>
                <td>
                  <select
                    id={`des-${m.id}`}
                    className="input des-select"
                    disabled={busy}
                    value={m.designatedCaddieId ?? ''}
                    onChange={(e) =>
                      run(
                        () => api.post(`/members/${m.id}/designated`, { caddieId: e.target.value ? Number(e.target.value) : null }),
                        e.target.value ? `${m.name} now always gets ${snap.caddies.find((c) => c.id === Number(e.target.value))?.name}.` : `${m.name} now uses the normal queue.`,
                      )
                    }
                  >
                    <option value="">None, normal queue</option>
                    {snap.caddies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {load.get(c.id) ? ` (${load.get(c.id)} member${load.get(c.id)! > 1 ? 's' : ''})` : ''}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function ReportsTab() {
  const { snap } = useLive();
  const today = snap?.date ?? clubDate(Date.now());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Report | null>(null);

  useEffect(() => {
    if (from && to) api.get<Report>(`/reports?from=${from}&to=${to}`).then(setData);
  }, [from, to, snap?.recent.length]);

  const weekAgo = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6);
    return d.toISOString().slice(0, 10);
  })();
  const maxRounds = Math.max(1, ...(data?.perCaddie.map((c) => c.rounds) ?? [1]));

  return (
    <div className="reports">
      <div className="report-range">
        <div className="field">
          <label htmlFor="r-from">From</label>
          <input id="r-from" type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="r-to">To</label>
          <input id="r-to" type="date" className="input" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn" onClick={() => (setFrom(today), setTo(today))}>
          Today
        </button>
        <button className="btn" onClick={() => (setFrom(weekAgo), setTo(today))}>
          Last 7 days
        </button>
      </div>

      {data && (
        <>
          <dl className="summary">
            <div>
              <dt>Sessions</dt>
              <dd className="num">{data.summary.sessions}</dd>
            </div>
            <div>
              <dt>Average wait for a caddie</dt>
              <dd className="num">{minutesLabel(data.summary.avgWaitMin)}</dd>
            </div>
            <div>
              <dt>Caddies late to Bag Drop</dt>
              <dd className="num">{data.summary.noShowAlerts}</dd>
            </div>
          </dl>

          <div className="master-grid">
            <section className="section">
              <div className="section-head">
                <h2>Rounds per caddie</h2>
                <span className="count num">{data.perCaddie.length}</span>
              </div>
              <div className="table-wrap panel">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Caddie</th>
                      <th className="r">Rounds</th>
                      <th />
                      <th className="r">Designated</th>
                      <th className="r">Holes</th>
                      <th className="r">Avg round</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perCaddie.map((c) => (
                      <tr key={c.caddieId}>
                        <td>
                          {c.name} <span className="muted small num">{c.empNo}</span>
                        </td>
                        <td className="r">{c.rounds}</td>
                        <td className="bar-cell" aria-hidden="true">
                          <span className="bar" style={{ width: `${(c.rounds / maxRounds) * 100}%` }} />
                        </td>
                        <td className="r">{c.designated}</td>
                        <td className="r">{c.holes}</td>
                        <td className="r">{c.avgRoundMin == null ? '—' : elapsed(c.avgRoundMin * 60_000)}</td>
                      </tr>
                    ))}
                    {data.perCaddie.length === 0 && (
                      <tr>
                        <td colSpan={6} className="muted">
                          No rounds in this range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="section">
              <div className="section-head">
                <h2>Wait per member</h2>
                <span className="count num">{data.perMember.length}</span>
                <span className="aside">From request at Bag Drop to caddie arrival</span>
              </div>
              <div className="table-wrap panel">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th className="r">Visits</th>
                      <th className="r">Avg wait</th>
                      <th className="r">Longest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perMember.map((m) => (
                      <tr key={m.memberId}>
                        <td>
                          {m.name} <span className="muted small num">#{m.memberNo}</span>
                        </td>
                        <td className="r">{m.visits}</td>
                        <td className="r">{minutesLabel(m.avgWaitMin)}</td>
                        <td className="r">{minutesLabel(m.maxWaitMin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="section">
            <div className="section-head">
              <h2>Daily log</h2>
              <span className="count num">{data.log.length}</span>
            </div>
            <div className="table-wrap panel">
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Cart</th>
                    <th>Caddie</th>
                    <th>Members</th>
                    <th>Type</th>
                    <th className="r">Requested</th>
                    <th className="r">Called</th>
                    <th className="r">Out</th>
                    <th className="r">Back</th>
                    <th className="r">Wait</th>
                    <th className="r">Holes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.log.map((d) => (
                    <tr key={d.id}>
                      <td className="num small">{shortDate(d.createdAt)}</td>
                      <td className="num">{d.cartNumber}</td>
                      <td>{d.caddieName}</td>
                      <td>{memberList(d)}</td>
                      <td className="small muted">{d.reason === 'designated' ? 'Designated' : 'Queue'}</td>
                      <td className="r">{clock(d.createdAt)}</td>
                      <td className="r">{d.calledAt ? clock(d.calledAt) : '—'}</td>
                      <td className="r">{d.arrivedAt ? clock(d.arrivedAt) : '—'}</td>
                      <td className="r">{d.endedAt ? clock(d.endedAt) : <span className="status is-out">On course</span>}</td>
                      <td className="r">{d.arrivedAt ? elapsed(d.arrivedAt - d.createdAt) : '—'}</td>
                      <td className="r">{d.holes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
