import { useEffect, useMemo, useState } from 'react';
import { MemberSearch, Plate, Segmented, TopBar, useAction } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import {
  caddieAvailability,
  callStart,
  clock,
  elapsed,
  isNoShow,
  isOverdue,
  memberList,
  shortDate,
  clubDate,
  timer,
} from '../lib/format.ts';
import { useLive, useNow } from '../lib/live.tsx';
import { StorageTab } from './StorageTab.tsx';
import { NextBar } from '../components/NextBar.tsx';
import { PhotoCapture } from '../components/PhotoCapture.tsx';
import {
  RULES,
  type CartGroupInput,
  type Dispatch,
  type Holes,
  type Member,
  type ReturnInput,
  type Snapshot,
  type StorageItem,
} from '../../shared/types.ts';
import '../styles/bagdrop.css';

export function BagDrop() {
  const [tab, setTab] = useState<'dispatch' | 'storage'>('dispatch');
  return (
    <>
      <TopBar station="Bag Drop" />
      <main className="page">
        <div className="page-head">
          <h1>Bag Drop</h1>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'dispatch'} onClick={() => setTab('dispatch')}>
              Arrivals and caddies
            </button>
            <button role="tab" aria-selected={tab === 'storage'} onClick={() => setTab('storage')}>
              Bag storage
            </button>
          </div>
        </div>
        {tab === 'dispatch' ? (
          <div className="bagdrop">
            <ArrivalForm />
            <Board />
          </div>
        ) : (
          <StorageTab />
        )}
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// New arrival
// ---------------------------------------------------------------------------

interface PartyEntry {
  member: Member;
  equipment: 'own' | 'storage';
  storageItemId: number | null;
  stored: StorageItem[] | null;
  /** What to do when the designated caddie cannot be called right now. */
  ifUnavailable: 'wait' | 'queue';
}

interface PlannedCart {
  mode: 'designated' | 'fifo';
  caddieId: number | null;
  caddieName: string | null;
  cartNumber: string | null;
  note: string;
  waiting: boolean;
  /** Caddie is already standing by at Bag Drop: the session starts on submit. */
  ready: boolean;
  entries: PartyEntry[];
}

function planCarts(party: PartyEntry[], split: boolean, snap: Snapshot): PlannedCart[] {
  const carts: PlannedCart[] = [];
  const fifo: PartyEntry[] = [];
  const designatedNow = new Set<number>();

  for (const e of party) {
    const cid = e.member.designatedCaddieId;
    if (!cid) {
      fifo.push(e);
      continue;
    }
    const a = caddieAvailability(cid, snap.shifts, snap.active);
    if (!a.available && e.ifUnavailable === 'queue') {
      fifo.push(e);
      continue;
    }
    const existing = carts.find((c) => c.caddieId === cid);
    if (existing) {
      existing.entries.push(e);
      continue;
    }
    if (a.available) designatedNow.add(cid);
    carts.push({
      mode: 'designated',
      caddieId: cid,
      caddieName: e.member.designatedCaddieName ?? null,
      cartNumber: a.shift?.cartNumber ?? null,
      ready: !!a.standby,
      note: a.available
        ? a.shift?.status === 'called'
          ? `Designated caddie. ${a.text}.`
          : 'Designated caddie, skips the queue'
        : `Waiting for designated caddie. ${a.text}.`,
      waiting: !a.available,
      entries: [e],
    });
  }

  // Preview who the queue will give us. Caddies already called with Next come first (standing by, then on the way),
  // matching the server's order; then the line, after any requests already waiting.
  const open = snap.active
    .filter((d) => (d.status === 'standby' || d.status === 'called') && d.members.length === 0 && !designatedNow.has(d.caddieId!))
    .sort(
      (a, b) =>
        Number(b.status === 'standby') - Number(a.status === 'standby') ||
        (a.readyAt ?? a.calledAt ?? 0) - (b.readyAt ?? b.calledAt ?? 0),
    );
  const ahead = snap.active.filter((d) => d.status === 'pending' && d.reason === 'fifo').length;
  const line = snap.shifts.filter((s) => s.status === 'waiting' && !designatedNow.has(s.caddieId)).slice(ahead);
  const pool = [
    ...open.map((d) => ({
      caddieId: d.caddieId,
      caddieName: d.caddieName,
      cartNumber: d.cartNumber,
      note: d.status === 'standby' ? 'Standing by at Bag Drop. The session starts now.' : 'Already called with Next, on the way',
      ready: d.status === 'standby',
    })),
    ...line.map((s) => ({ caddieId: s.caddieId, caddieName: s.caddieName, cartNumber: s.cartNumber, note: 'Next in queue', ready: false })),
  ];
  const groups = split ? fifo.map((e) => [e]) : fifo.length ? [fifo] : [];
  groups.forEach((entries, i) => {
    const s = pool[i];
    carts.push({
      mode: 'fifo',
      caddieId: s?.caddieId ?? null,
      caddieName: s?.caddieName ?? null,
      cartNumber: s?.cartNumber ?? null,
      note: s?.note ?? 'No caddie free in the queue. The request will wait for the next one back.',
      waiting: !s,
      ready: s?.ready ?? false,
      entries,
    });
  });
  return carts;
}

function ArrivalForm() {
  const { snap } = useLive();
  const { run, busy } = useAction();
  const [party, setParty] = useState<PartyEntry[]>([]);
  const [holes, setHoles] = useState<Holes>(18);
  const [split, setSplit] = useState(false);

  const add = (m: Member) => {
    setParty((p) => [...p, { member: m, equipment: 'own', storageItemId: null, stored: null, ifUnavailable: 'wait' }]);
    api.get<StorageItem[]>(`/storage?memberId=${m.id}`).then((stored) =>
      setParty((p) => p.map((e) => (e.member.id === m.id ? { ...e, stored } : e))),
    );
  };
  const update = (id: number, patch: Partial<PartyEntry>) =>
    setParty((p) => p.map((e) => (e.member.id === id ? { ...e, ...patch } : e)));

  const busyMembers = useMemo(
    () => new Set(snap?.active.flatMap((d) => d.members.map((m) => m.memberId)) ?? []),
    [snap],
  );

  if (!snap) return <section className="arrival panel" aria-busy="true" />;

  const plan = planCarts(party, split, snap);
  const fifoCount = plan.filter((c) => c.mode === 'fifo').reduce((n, c) => n + c.entries.length, 0);
  const storageMissing = party.some((e) => e.equipment === 'storage' && !e.storageItemId);
  const calling = plan.filter((c) => !c.waiting && !c.ready).length;
  const ready = plan.filter((c) => c.ready).length;

  const submit = async () => {
    const groups: CartGroupInput[] = plan.map((c) => ({
      mode: c.mode,
      caddieId: c.mode === 'designated' ? c.caddieId : null,
      members: c.entries.map((e) => ({ memberId: e.member.id, equipment: e.equipment, storageItemId: e.storageItemId })),
    }));
    const summary = plan
      .filter((c) => !c.waiting && c.cartNumber)
      .map((c) => `Cart ${c.cartNumber}, ${c.caddieName}`)
      .join(' and ');
    const ok = await run(
      () => api.post('/parties', { holes, groups }),
      calling === 0 && ready > 0
        ? `Session started: ${summary}.`
        : summary
          ? `Called ${summary} to Bag Drop.`
          : 'Request saved. It will be called when a caddie is free.',
    );
    if (ok) {
      setParty([]);
      setSplit(false);
    }
  };

  return (
    <section className="arrival panel" aria-labelledby="arrival-title">
      <div className="arrival-head">
        <h2 id="arrival-title">New arrival</h2>
        {party.length > 0 && (
          <button className="btn btn-text btn-small" onClick={() => setParty([])}>
            Clear
          </button>
        )}
      </div>

      <div className="field">
        <label htmlFor="arrival-member">{party.length ? 'Add another member to this group' : 'Member'}</label>
        <MemberSearch id="arrival-member" onPick={add} exclude={party.map((e) => e.member.id)} autoFocus />
      </div>

      {party.length === 0 && (
        <p className="arrival-hint">
          Look up the member by name or member number. Add playing partners to send them out as one group.
        </p>
      )}

      {party.map((e) => {
        const cid = e.member.designatedCaddieId;
        const a = cid ? caddieAvailability(cid, snap.shifts, snap.active) : null;
        const alreadyOut = busyMembers.has(e.member.id);
        return (
          <article className="pm" key={e.member.id}>
            <div className="pm-top">
              <div>
                <div className="pm-name">{e.member.name}</div>
                <div className="pm-no num">Member #{e.member.memberNo}</div>
              </div>
              <button
                className="btn btn-text btn-small"
                onClick={() => setParty((p) => p.filter((x) => x.member.id !== e.member.id))}
                aria-label={`Remove ${e.member.name}`}
              >
                Remove
              </button>
            </div>

            {alreadyOut && <p className="pm-warn">This member already has an active session today.</p>}

            <div className="pm-row">
              <span className="label">Caddie</span>
              {cid && a ? (
                <div className="pm-caddie">
                  <div>
                    <strong>{e.member.designatedCaddieName}</strong>
                    <span className={`status ${a.available ? 'is-out' : 'is-pending'}`}>{a.available ? 'Available' : 'Unavailable'}</span>
                  </div>
                  <div className="small muted">
                    Designated. {a.shift ? `Cart ${a.shift.cartNumber}. ` : ''}
                    {a.text}.
                  </div>
                  {!a.available && (
                    <Segmented
                      label="If designated caddie is unavailable"
                      value={e.ifUnavailable}
                      onChange={(v) => update(e.member.id, { ifUnavailable: v })}
                      options={[
                        { value: 'wait', label: `Wait for ${e.member.designatedCaddieName?.split(' ')[0]}` },
                        { value: 'queue', label: 'Next in queue' },
                      ]}
                    />
                  )}
                </div>
              ) : (
                <div className="pm-caddie small muted">No designated caddie. Normal queue.</div>
              )}
            </div>

            <div className="pm-row">
              <span className="label">Equipment</span>
              <div className="pm-equip">
                <Segmented
                  label="Equipment"
                  value={e.equipment}
                  onChange={(v) => {
                    const first = e.stored?.find((s) => s.status === 'stored');
                    update(e.member.id, { equipment: v, storageItemId: v === 'storage' ? first?.id ?? null : null });
                  }}
                  options={[
                    { value: 'own', label: 'Brought own bag' },
                    { value: 'storage', label: 'From storage' },
                  ]}
                />
                {e.equipment === 'storage' && (
                  <div className="pm-stored">
                    {e.stored === null && <span className="small muted">Checking storage…</span>}
                    {e.stored?.length === 0 && <span className="small muted">No bags in storage for this member.</span>}
                    {e.stored?.map((s) => (
                      <label key={s.id} className={`stored-opt${s.status !== 'stored' ? ' is-disabled' : ''}`}>
                        <input
                          type="radio"
                          name={`stored-${e.member.id}`}
                          checked={e.storageItemId === s.id}
                          disabled={s.status !== 'stored'}
                          onChange={() => update(e.member.id, { storageItemId: s.id })}
                        />
                        <span className="stored-tag num">{s.tag}</span>
                        <span className="small">
                          {s.description}
                          {s.status !== 'stored' && ' (out with a caddie)'}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </article>
        );
      })}

      {party.length > 0 && (
        <>
          <div className="arrival-options">
            <div className="field">
              <span className="label">Round</span>
              <Segmented
                label="Holes"
                value={holes}
                onChange={setHoles}
                options={[
                  { value: 18, label: '18 holes' },
                  { value: 9, label: '9 holes' },
                ]}
              />
            </div>
            {fifoCount > 1 && (
              <div className="field">
                <span className="label">Queue members</span>
                <Segmented
                  label="Queue members"
                  value={split ? 'split' : 'share'}
                  onChange={(v) => setSplit(v === 'split')}
                  options={[
                    { value: 'share', label: 'Share one cart' },
                    { value: 'split', label: 'Separate carts' },
                  ]}
                />
              </div>
            )}
          </div>

          <div className="plan">
            <span className="label">Will call</span>
            {plan.map((c, i) => (
              <div className={`plan-row${c.waiting ? ' is-waiting' : ''}`} key={i}>
                <Plate number={c.waiting ? null : c.cartNumber} small />
                <div className="plan-body">
                  <div className="plan-caddie">{c.caddieName ?? 'Next free caddie'}</div>
                  <div className="small muted">{c.note}</div>
                  <div className="small">For {c.entries.map((e) => e.member.name).join(', ')}</div>
                </div>
              </div>
            ))}
          </div>

          <button
            className="btn btn-primary btn-big"
            disabled={busy || storageMissing || party.some((e) => busyMembers.has(e.member.id))}
            onClick={submit}
          >
            {calling === 0
              ? ready > 0
                ? 'Hand over bag and start session'
                : 'Save request'
              : calling === 1
                ? 'Call caddie to Bag Drop'
                : `Call ${calling} caddies to Bag Drop`}
          </button>
          {storageMissing && <p className="pm-warn">Pick which stored bag to bring out, or switch to “Brought own bag”.</p>}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Live board
// ---------------------------------------------------------------------------

function Board() {
  const { snap } = useLive();
  const now = useNow();
  if (!snap) return <div className="board muted">Connecting to the dispatch server…</div>;

  const called = snap.active.filter((d) => d.status === 'called');
  const standby = snap.active
    .filter((d) => d.status === 'standby')
    .sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0));
  const pending = snap.active.filter((d) => d.status === 'pending');
  const out = snap.active
    .filter((d) => d.status === 'out')
    .sort((a, b) => (a.arrivedAt ?? 0) - (b.arrivedAt ?? 0));
  const inLine = snap.shifts.filter((s) => s.status === 'waiting');
  const noShows = called.filter((d) => isNoShow(d, now)).length;

  return (
    <div className="board">
      <NextBar />

      <section className="section">
        <div className="section-head">
          <h2>Called to Bag Drop</h2>
          <span className="count num">{called.length}</span>
          <span className="aside">
            {noShows > 0 ? (
              <span className="status is-alert">
                {noShows} not here after {RULES.noShowMinutes} min
              </span>
            ) : (
              `Alert after ${RULES.noShowMinutes} min`
            )}
          </span>
        </div>
        {called.length === 0 && <p className="empty">No caddies on the board.</p>}
        {called.map((d) => (
          <CalledRow key={d.id} d={d} now={now} />
        ))}
      </section>

      {standby.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Standing by at Bag Drop</h2>
            <span className="count num">{standby.length}</span>
            <span className="aside">The next members you send out get these caddies, first come first served</span>
          </div>
          {standby.map((d) => (
            <StandbyRow key={d.id} d={d} now={now} />
          ))}
        </section>
      )}

      {pending.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Waiting for a caddie</h2>
            <span className="count num">{pending.length}</span>
          </div>
          {pending.map((d) => (
            <PendingRow key={d.id} d={d} now={now} snap={snap} />
          ))}
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>On course</h2>
          <span className="count num">{out.length}</span>
          <span className="aside">Close a session when the bag comes back</span>
        </div>
        {out.length === 0 && <p className="empty">No one is on the course.</p>}
        {out.map((d) => (
          <OutRow key={d.id} d={d} now={now} />
        ))}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Next in queue</h2>
          <span className="count num">{inLine.length}</span>
        </div>
        {inLine.length === 0 ? (
          <p className="empty">No caddies waiting. New requests will be called as caddies come back.</p>
        ) : (
          <ol className="lineup">
            {inLine.slice(0, 8).map((s) => (
              <li key={s.id}>
                <span className="lineup-pos num">{s.position}</span>
                <span className="lineup-cart num">Cart {s.cartNumber}</span>
                <span className="lineup-name">{s.caddieName}</span>
              </li>
            ))}
            {inLine.length > 8 && <li className="muted small">and {inLine.length - 8} more</li>}
          </ol>
        )}
      </section>

      {snap.recent.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Finished today</h2>
            <span className="count num">{snap.recent.length}</span>
          </div>
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {snap.recent.map((d) => (
                  <tr key={d.id}>
                    <td className="num">Cart {d.cartNumber}</td>
                    <td>{d.caddieName}</td>
                    <td>{memberList(d)}</td>
                    <td className="r">
                      {d.arrivedAt && clock(d.arrivedAt)} to {d.endedAt && clock(d.endedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function ReasonLabel({ d }: { d: Dispatch }) {
  const label = d.reason === 'designated' ? 'Designated' : d.members.length === 0 ? 'Called with Next' : 'Queue';
  return <span className="reason">{label}</span>;
}

function MemberLine({ d }: { d: Dispatch }) {
  if (d.members.length === 0) {
    return <div className="row-members">No member yet. Goes to the next member you send out.</div>;
  }
  return (
    <div className="row-members">
      {d.members.map((m) => (
        <span key={m.id}>
          {m.name}
          {m.equipment === 'storage' && m.storageTag && <span className="bagtag num">Storage {m.storageTag}</span>}
        </span>
      ))}
    </div>
  );
}

function CalledRow({ d, now }: { d: Dispatch; now: number }) {
  const { run, busy } = useAction();
  const late = isNoShow(d, now);
  const open = d.members.length === 0;
  const [confirmCancel, setConfirmCancel] = useState(false);
  return (
    <article className={`row${late ? ' is-alert' : ''}`}>
      <Plate number={d.cartNumber} />
      <div className="row-main">
        <div className="row-title">
          <strong>{d.caddieName}</strong>
          <ReasonLabel d={d} />
        </div>
        <MemberLine d={d} />
        <div className="row-meta">
          {late ? (
            <span className="status is-alert">Not here yet</span>
          ) : (
            <span className="status is-called">Called</span>
          )}
          <span className="small muted">
            {d.recalledAt ? 'Re-called' : 'Called'} {clock(callStart(d))}
            {!open && ` · ${d.holes} holes`}
          </span>
        </div>
      </div>
      <div className={`row-timer num${late ? ' is-alert' : ''}`} aria-label="Time since call">
        {timer(now - callStart(d))}
      </div>
      <div className="row-actions">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            run(
              () => api.post(`/dispatches/${d.id}/arrived`),
              open ? `Cart ${d.cartNumber} is standing by at Bag Drop.` : `Session started for Cart ${d.cartNumber}.`,
            )
          }
        >
          Caddie arrived
        </button>
        {late && (
          <>
            <button className="btn" disabled={busy} onClick={() => run(() => api.post(`/dispatches/${d.id}/recall`), `Cart ${d.cartNumber} called again.`)}>
              Call again
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => run(() => api.post(`/dispatches/${d.id}/pass`), `Passed to the next caddie. ${d.caddieName} moved to the back of the queue.`)}
            >
              Give to next in queue
            </button>
          </>
        )}
        {confirmCancel ? (
          <span className="confirm">
            {open ? 'Send back to their place in line?' : 'Cancel this request?'}
            <button className="btn btn-small btn-danger" disabled={busy} onClick={() => run(() => api.post(`/dispatches/${d.id}/cancel`), open ? `${d.caddieName} is back in their place in line.` : 'Request cancelled. Caddie keeps their place in line.')}>
              {open ? 'Send back' : 'Yes, cancel'}
            </button>
            <button className="btn btn-small btn-text" onClick={() => setConfirmCancel(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button className="btn btn-text btn-small" onClick={() => setConfirmCancel(true)}>
            {open ? 'Not needed' : 'Cancel'}
          </button>
        )}
      </div>
    </article>
  );
}

/** Caddie called with Next is at Bag Drop and waiting for the next member. */
function StandbyRow({ d, now }: { d: Dispatch; now: number }) {
  const { run, busy } = useAction();
  return (
    <article className="row is-standby">
      <Plate number={d.cartNumber} />
      <div className="row-main">
        <div className="row-title">
          <strong>{d.caddieName}</strong>
          <ReasonLabel d={d} />
        </div>
        <div className="row-meta">
          <span className="status is-called">Standing by</span>
          <span className="small muted">At Bag Drop since {d.readyAt && clock(d.readyAt)}</span>
        </div>
      </div>
      <div className="row-timer num" aria-label="Time standing by">
        {d.readyAt ? elapsed(now - d.readyAt) : ''}
      </div>
      <div className="row-actions">
        <button
          className="btn btn-text btn-small"
          disabled={busy}
          onClick={() => run(() => api.post(`/dispatches/${d.id}/cancel`), `${d.caddieName} is back in their place in line.`)}
        >
          Not needed, send back to line
        </button>
      </div>
    </article>
  );
}

function PendingRow({ d, now, snap }: { d: Dispatch; now: number; snap: Snapshot }) {
  const { run, busy } = useAction();
  const a = d.requestedCaddieId ? caddieAvailability(d.requestedCaddieId, snap.shifts, snap.active) : null;
  return (
    <article className="row is-pending">
      <Plate number={null} />
      <div className="row-main">
        <div className="row-title">
          <strong>{d.reason === 'designated' ? `Waiting for ${d.requestedCaddieName}` : 'Waiting for the next free caddie'}</strong>
          <ReasonLabel d={d} />
        </div>
        <MemberLine d={d} />
        <div className="row-meta">
          <span className="status is-pending">Waiting</span>
          <span className="small muted">
            {a ? `${a.text}. Called automatically when available.` : 'Called automatically when a caddie comes back.'}
          </span>
        </div>
      </div>
      <div className="row-timer num" aria-label="Time waiting">
        {timer(now - d.createdAt)}
      </div>
      <div className="row-actions">
        {d.reason === 'designated' && (
          <button className="btn" disabled={busy} onClick={() => run(() => api.post(`/dispatches/${d.id}/queue`), 'Switched to the normal queue.')}>
            Take next in queue
          </button>
        )}
        <button className="btn btn-text btn-small" disabled={busy} onClick={() => run(() => api.post(`/dispatches/${d.id}/cancel`), 'Request cancelled.')}>
          Cancel
        </button>
      </div>
    </article>
  );
}

function OutRow({ d, now }: { d: Dispatch; now: number }) {
  const [returning, setReturning] = useState(false);
  const overdue = isOverdue(d, now);
  return (
    <article className={`row${overdue ? ' is-overdue' : ''}${returning ? ' is-open' : ''}`}>
      <Plate number={d.cartNumber} />
      <div className="row-main">
        <div className="row-title">
          <strong>{d.caddieName}</strong>
          <ReasonLabel d={d} />
        </div>
        <MemberLine d={d} />
        <div className="row-meta">
          {overdue ? (
            <span className="status is-alert">Overdue for {d.holes} holes</span>
          ) : (
            <span className="status is-out">On course</span>
          )}
          <span className="small muted">
            Out {d.arrivedAt && (clubDate(d.arrivedAt) !== clubDate(now) ? `${shortDate(d.arrivedAt)}, ` : '')}
            {d.arrivedAt && clock(d.arrivedAt)} · {d.holes} holes
          </span>
        </div>
      </div>
      <div className={`row-timer num${overdue ? ' is-alert' : ''}`} aria-label="Time on course">
        {d.arrivedAt ? elapsed(now - d.arrivedAt) : ''}
      </div>
      <div className="row-actions">
        {!returning && (
          <button className="btn" onClick={() => setReturning(true)}>
            Bag returned
          </button>
        )}
      </div>
      {returning && <ReturnForm d={d} onClose={() => setReturning(false)} />}
    </article>
  );
}

function ReturnForm({ d, onClose }: { d: Dispatch; onClose: () => void }) {
  const { run, busy } = useAction();
  const [returns, setReturns] = useState<ReturnInput[]>(() =>
    d.members.map((m) => ({ dispatchMemberId: m.id, to: m.equipment === 'storage' ? 'storage' : 'member', tag: '', description: '', photo: null })),
  );
  useEffect(() => {
    document.getElementById(`return-${d.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [d.id]);
  const set = (i: number, patch: Partial<ReturnInput>) => setReturns((r) => r.map((x, j) => (i === j ? { ...x, ...patch } : x)));
  const missingTag = returns.some((r, i) => r.to === 'storage' && !d.members[i].storageItemId && !r.tag?.trim());

  return (
    <div className="return" id={`return-${d.id}`}>
      <p className="return-intro">Where is each bag going? Closing the session puts {d.caddieName} at the back of the queue.</p>
      {d.members.map((m, i) => (
        <div className="return-row" key={m.id}>
          <div className="return-who">
            <strong>{m.name}</strong>
            <span className="small muted">
              {m.equipment === 'storage' ? `Bag from storage ${m.storageTag}` : 'Brought own bag'}
            </span>
          </div>
          <Segmented
            label={`Bag for ${m.name}`}
            value={returns[i].to}
            onChange={(v) => set(i, { to: v })}
            options={[
              { value: 'member', label: m.equipment === 'storage' ? 'Member takes it home' : 'To member' },
              { value: 'storage', label: m.equipment === 'storage' ? `Back to ${m.storageTag}` : 'Into storage' },
            ]}
          />
          {returns[i].to === 'storage' && !m.storageItemId && (
            <div className="return-new">
              <input
                id={`tag-${m.id}`}
                className="input"
                placeholder="Storage tag, e.g. S-052"
                value={returns[i].tag}
                onChange={(e) => set(i, { tag: e.target.value })}
              />
              <input
                id={`desc-${m.id}`}
                className="input"
                placeholder="Bag description"
                value={returns[i].description}
                onChange={(e) => set(i, { description: e.target.value })}
              />
            </div>
          )}
          {returns[i].to === 'storage' && (
            <div className="return-photo">
              <PhotoCapture
                id={`return-photo-${m.id}`}
                label="Photo of the bag going into storage"
                value={returns[i].photo ?? null}
                onChange={(photo) => set(i, { photo })}
              />
            </div>
          )}
        </div>
      ))}
      <div className="return-actions">
        <button
          className="btn btn-primary"
          disabled={busy || missingTag}
          onClick={async () => {
            if (await run(() => api.post(`/dispatches/${d.id}/end`, { returns }), `Session closed. Cart ${d.cartNumber} is back in the queue.`)) onClose();
          }}
        >
          Close session
        </button>
        <button className="btn btn-text" onClick={onClose}>
          Back
        </button>
      </div>
    </div>
  );
}
