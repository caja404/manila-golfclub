import { RULES, type Dispatch, type Shift } from '../../shared/types.ts';

const TZ = 'Asia/Manila';

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });

/** 7:42 am */
export const clock = (ts: number) => timeFmt.format(ts).replace(' AM', ' am').replace(' PM', ' pm');
export const longDate = (ts: number) => dateFmt.format(ts);
const shortDateFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });
/** Oct 6 */
export const shortDate = (ts: number) => shortDateFmt.format(ts);
const isoDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Club calendar date, YYYY-MM-DD in Manila time. */
export const clubDate = (ts: number) => isoDateFmt.format(ts);

/** Elapsed time as "4 min" or "3 h 12 min". */
export function elapsed(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Elapsed time as a running timer, 4:07 or 1:04:07. */
export function timer(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const minutesLabel = (m: number | null) => (m == null ? '—' : `${m.toFixed(1)} min`);

/** When the current call went on the board (re-calls restart the no-show timer). */
export const callStart = (d: Dispatch) => d.recalledAt ?? d.calledAt ?? d.createdAt;

export const isNoShow = (d: Dispatch, now: number) =>
  d.status === 'called' && now - callStart(d) >= RULES.noShowMinutes * 60_000;

export const isOverdue = (d: Dispatch, now: number) =>
  d.status === 'out' && d.arrivedAt != null && now - d.arrivedAt >= RULES.overdueMinutes[d.holes] * 60_000;

/** "C. Santiago" */
export function shortName(name: string) {
  const parts = name.split(' ');
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

export function memberList(d: Dispatch) {
  return d.members.map((m) => m.name).join(', ');
}

export const SHIFT_LABEL: Record<Shift['status'], string> = {
  waiting: 'In line',
  called: 'Called',
  out: 'On course',
  break: 'On break',
  off: 'Checked out',
};

/** Describes whether a designated caddie can be called right now. */
export function caddieAvailability(
  caddieId: number,
  shifts: Shift[],
  active: Dispatch[],
): { available: boolean; standby?: boolean; shift: Shift | undefined; text: string } {
  const shift = shifts.find((s) => s.caddieId === caddieId);
  if (!shift) return { available: false, shift, text: 'Not checked in today' };
  switch (shift.status) {
    case 'waiting':
      return { available: true, shift, text: `In line, position ${shift.position}` };
    case 'break':
      return { available: true, shift, text: 'On break in the Caddie House' };
    case 'off':
      return { available: false, shift, text: 'Checked out for the day' };
    case 'called': {
      // Called with Next and no member yet: the designated member can take them.
      const open = active.find(
        (x) => x.caddieId === caddieId && (x.status === 'called' || x.status === 'standby') && x.members.length === 0,
      );
      if (open) {
        const standby = open.status === 'standby';
        return { available: true, standby, shift, text: standby ? 'Standing by at Bag Drop' : 'Already called with Next' };
      }
      return { available: false, shift, text: 'Already called to Bag Drop for another member' };
    }
    case 'out': {
      const d = active.find((x) => x.caddieId === caddieId && x.status === 'out');
      return {
        available: false,
        shift,
        text: d?.arrivedAt ? `On course since ${clock(d.arrivedAt)}, ${d.holes} holes` : 'On course',
      };
    }
  }
}
