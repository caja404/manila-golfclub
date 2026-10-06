import { api } from '../lib/api.ts';
import { useLive } from '../lib/live.tsx';
import { Plate, useAction } from './ui.tsx';

const BATCH = 5;

/**
 * Call the next caddie in line (or the next five) to Bag Drop before members are assigned.
 * Arriving members are given to these caddies first, in the order they were called.
 */
export function NextBar() {
  const { snap } = useLive();
  const { run, busy } = useAction();
  if (!snap) return null;

  const line = snap.shifts.filter((s) => s.status === 'waiting');
  const next = line[0];
  const batch = Math.min(BATCH, line.length);
  const open = snap.active.filter((d) => (d.status === 'called' || d.status === 'standby') && d.members.length === 0).length;

  const callNext = (count: number) =>
    run(
      () => api.post<{ result: { carts: string[] } }>('/call-next', { count }),
      ({ result: { carts } }) =>
        carts.length === 1 ? `Called Cart ${carts[0]} to Bag Drop.` : `Called ${carts.length} caddies to Bag Drop: Carts ${carts.join(', ')}.`,
    );

  return (
    <section className="nextbar" aria-label="Call next caddie">
      <div className="nextbar-who">
        <span className="label">Next in line</span>
        {next ? (
          <div className="nextbar-next">
            <Plate number={next.cartNumber} />
            <div>
              <div className="nextbar-name">{next.caddieName}</div>
              <div className="small muted">
                {line.length > 1
                  ? `Then ${line
                      .slice(1, 4)
                      .map((s) => `${s.cartNumber} ${s.caddieName.split(' ')[0]}`)
                      .join(', ')}${line.length > 4 ? ` and ${line.length - 4} more` : ''}`
                  : 'Last caddie in line'}
              </div>
            </div>
          </div>
        ) : (
          <p className="nextbar-empty">No caddies waiting in line.</p>
        )}
      </div>
      <div className="nextbar-actions">
        <button className="btn btn-next" disabled={busy || !next} onClick={() => callNext(1)}>
          Call next
        </button>
        {batch > 1 && (
          <button className="btn btn-next-batch" disabled={busy} onClick={() => callNext(batch)}>
            Call next {batch}
          </button>
        )}
      </div>
      {open > 0 && (
        <p className="nextbar-note small">
          {open} called with no member yet. The next members you send out get them first.
        </p>
      )}
    </section>
  );
}
