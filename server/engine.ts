// Dispatch rules. Every mutation runs in a transaction and ends with servePending(),
// so a caddie who becomes free is immediately given to whoever has been waiting longest.

import { all, get, run, tx, type Row } from './db.ts';
import { clubDate } from './time.ts';
import { decodePhoto, savePhoto } from './photos.ts';
import type { PartyInput, ReturnInput } from '../shared/types.ts';

export class RuleError extends Error {
  statusCode = 409;
}

/** Malformed request (bad ids or values) rather than a broken dispatch rule. */
class InputError extends RuleError {
  statusCode = 400;
}

const today = () => clubDate();

function mustExist(table: 'caddies' | 'carts' | 'members' | 'storage_items', id: unknown, what: string): number {
  const n = Number(id);
  if (!Number.isInteger(n) || !get(`SELECT 1 FROM ${table} WHERE id = ?`, n)) throw new InputError(`${what} not found.`);
  return n;
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], what: string): T {
  if (!allowed.includes(value as T)) throw new InputError(`Invalid ${what}.`);
  return value as T;
}

/**
 * Calls and waiting requests from an earlier day can never be served: cancel them and put their bags
 * back in storage. Sessions still on course from an earlier day stay open so Bag Drop can close them.
 */
export function expireStaleCalls() {
  return tx(() => {
    const date = today();
    const now = Date.now();
    const stale = all(`SELECT id FROM dispatches WHERE date < ? AND status IN ('pending','called','standby')`, date);
    for (const d of stale) {
      run(
        `UPDATE storage_items SET status = 'stored', updated_at = ?
         WHERE id IN (SELECT storage_item_id FROM dispatch_members WHERE dispatch_id = ? AND storage_item_id IS NOT NULL)`,
        now,
        d.id,
      );
      run(`UPDATE dispatches SET status = 'cancelled', cancelled_at = ? WHERE id = ?`, now, d.id);
    }
    return stale.length;
  });
}

function shiftForCaddie(caddieId: number, date = today()): Row | undefined {
  return get(`SELECT * FROM shifts WHERE date = ? AND caddie_id = ?`, date, caddieId);
}

function backOfQueue(date: string): number {
  const r = get(`SELECT MAX(queue_seq) AS m FROM shifts WHERE date = ?`, date);
  return (r?.m ?? 0) + 1;
}

function nextInQueue(date: string): Row | undefined {
  return get(`SELECT * FROM shifts WHERE date = ? AND status = 'waiting' ORDER BY queue_seq LIMIT 1`, date);
}

/** A designated caddie can be called while waiting in the queue or on break in the Caddie House. */
export function isCallable(shift: Row | undefined) {
  return !!shift && (shift.status === 'waiting' || shift.status === 'break');
}

function call(dispatchId: number, shift: Row, now: number) {
  run(
    `UPDATE dispatches SET status = 'called', shift_id = ?, caddie_id = ?, cart_id = ?, called_at = ?, recalled_at = NULL WHERE id = ?`,
    shift.id,
    shift.caddie_id,
    shift.cart_id,
    now,
    dispatchId,
  );
  // Skipped caddies keep their places; the called caddie leaves the queue until their session ends.
  run(`UPDATE shifts SET status = 'called' WHERE id = ?`, shift.id);
}

/** Give free caddies to pending requests: designated requests first, then FIFO requests oldest first. */
function servePending(now = Date.now()) {
  const date = today();
  for (const d of all(
    `SELECT * FROM dispatches WHERE date = ? AND status = 'pending' AND reason = 'designated' ORDER BY created_at, id`,
    date,
  )) {
    const shift = shiftForCaddie(d.requested_caddie_id, date);
    if (isCallable(shift)) call(d.id, shift!, now);
  }
  for (const d of all(
    `SELECT * FROM dispatches WHERE date = ? AND status = 'pending' AND reason = 'fifo' ORDER BY created_at, id`,
    date,
  )) {
    const shift = nextInQueue(date);
    if (!shift) break;
    call(d.id, shift, now);
  }
}

// ---- Caddie Master ----

export function checkIn(caddieIdInput: unknown, cartIdInput: unknown) {
  return tx(() => {
    const caddieId = mustExist('caddies', caddieIdInput, 'Caddie');
    const cartId = mustExist('carts', cartIdInput, 'Cart');
    const date = today();
    if (shiftForCaddie(caddieId, date)) throw new RuleError('This caddie is already checked in today.');
    const cartTaken = get(`SELECT 1 FROM shifts WHERE date = ? AND cart_id = ? AND status != 'off'`, date, cartId);
    if (cartTaken) throw new RuleError('That cart already has a driver today. Pick another cart.');
    const now = Date.now();
    run(
      `INSERT INTO shifts (date, caddie_id, cart_id, check_in_at, status, queue_seq) VALUES (?, ?, ?, ?, 'waiting', ?)`,
      date,
      caddieId,
      cartId,
      now,
      backOfQueue(date),
    );
    servePending(now);
  });
}

export function setShiftStatus(shiftId: number, statusInput: unknown) {
  return tx(() => {
    const status = oneOf(statusInput, ['waiting', 'break', 'off'] as const, 'status');
    const s = get(`SELECT * FROM shifts WHERE id = ?`, shiftId);
    if (!s) throw new RuleError('Shift not found.');
    if (s.status === 'called' || s.status === 'out') {
      throw new RuleError('This caddie is on a call or on course. End or cancel that first.');
    }
    if (s.status === 'off' && status !== 'waiting') throw new RuleError('Put this caddie back on duty first.');
    if (status === 'off') {
      run(`UPDATE shifts SET status = 'off', check_out_at = ? WHERE id = ?`, Date.now(), shiftId);
    } else if (s.status === 'off' && status === 'waiting') {
      // Coming back on duty after checking out: rejoin at the back.
      const cartTaken = get(
        `SELECT 1 FROM shifts WHERE date = ? AND cart_id = ? AND status != 'off' AND id != ?`,
        s.date,
        s.cart_id,
        s.id,
      );
      if (cartTaken) throw new RuleError('Their cart has been given to another driver today.');
      run(`UPDATE shifts SET status = 'waiting', check_out_at = NULL, queue_seq = ? WHERE id = ?`, backOfQueue(s.date), shiftId);
    } else {
      run(`UPDATE shifts SET status = ? WHERE id = ?`, status, shiftId);
    }
    servePending();
  });
}

/** Swap places with the neighbouring caddie in the queue (ignores caddies who are out or off). */
export function moveInQueue(shiftId: number, directionInput: unknown) {
  return tx(() => {
    const direction = oneOf(directionInput, ['up', 'down'] as const, 'direction');
    const s = get(`SELECT * FROM shifts WHERE id = ?`, shiftId);
    if (!s) throw new RuleError('Shift not found.');
    if (s.status !== 'waiting' && s.status !== 'break') throw new RuleError('Only caddies in line can be moved.');
    const neighbour = get(
      direction === 'up'
        ? `SELECT * FROM shifts WHERE date = ? AND status IN ('waiting','break') AND queue_seq < ? ORDER BY queue_seq DESC LIMIT 1`
        : `SELECT * FROM shifts WHERE date = ? AND status IN ('waiting','break') AND queue_seq > ? ORDER BY queue_seq ASC LIMIT 1`,
      s.date,
      s.queue_seq,
    );
    if (!neighbour) return;
    run(`UPDATE shifts SET queue_seq = ? WHERE id = ?`, neighbour.queue_seq, s.id);
    run(`UPDATE shifts SET queue_seq = ? WHERE id = ?`, s.queue_seq, neighbour.id);
  });
}

export function setDesignatedCaddie(memberIdInput: unknown, caddieIdInput: unknown) {
  const memberId = mustExist('members', memberIdInput, 'Member');
  const caddieId = caddieIdInput == null ? null : mustExist('caddies', caddieIdInput, 'Caddie');
  run(`UPDATE members SET designated_caddie_id = ? WHERE id = ?`, caddieId, memberId);
}

// ---- Bag Drop ----

const nextPartyId = () => ((get(`SELECT MAX(party_id) AS m FROM dispatches`)?.m as number) ?? 0) + 1;

const OPEN_CALL = `
  SELECT d.* FROM dispatches d
  WHERE d.date = ? AND d.status IN ('called','standby')
    AND NOT EXISTS (SELECT 1 FROM dispatch_members dm WHERE dm.dispatch_id = d.id)`;

/** A caddie called with Next who has no member yet: standing by at Bag Drop first, then the earliest called. */
function nextOpenCall(date: string): Row | undefined {
  return get(`${OPEN_CALL} ORDER BY (d.status = 'standby') DESC, COALESCE(d.ready_at, d.called_at), d.id LIMIT 1`, date);
}

function openCallFor(caddieId: number, date: string): Row | undefined {
  return get(`${OPEN_CALL} AND d.caddie_id = ? LIMIT 1`, date, caddieId);
}

/**
 * Call the next caddies in line to Bag Drop before members are assigned (busy mornings, group arrivals).
 * Each becomes an open call; arriving members are given to open calls before anyone else is taken from the line.
 */
export function callNext(count: number) {
  return tx(() => {
    const date = today();
    const now = Date.now();
    const n = Math.max(1, Math.min(10, Math.floor(count) || 1));
    const line = all(`SELECT * FROM shifts WHERE date = ? AND status = 'waiting' ORDER BY queue_seq LIMIT ?`, date, n);
    if (!line.length) throw new RuleError('No caddies are waiting in line.');
    const partyId = nextPartyId();
    for (const shift of line) {
      const res = run(
        `INSERT INTO dispatches (date, party_id, status, reason, holes, created_at) VALUES (?, ?, 'pending', 'fifo', 18, ?)`,
        date,
        partyId,
        now,
      );
      call(Number(res.lastInsertRowid), shift, now);
    }
    const carts = line.map((s) => get(`SELECT number FROM carts WHERE id = ?`, s.cart_id)!.number as string);
    return { called: line.length, carts };
  });
}

export function createParty(input: PartyInput) {
  return tx(() => {
    if (!Array.isArray(input?.groups) || !input.groups.length || input.groups.some((g) => !Array.isArray(g?.members) || !g.members.length)) {
      throw new RuleError('Add at least one member to each cart.');
    }
    oneOf(input.holes, [9, 18] as const, 'number of holes');
    const date = today();
    const now = Date.now();
    const partyId = nextPartyId();
    const ids: number[] = [];

    const seen = new Set<number>();
    for (const g of input.groups) {
      oneOf(g.mode, ['designated', 'fifo'] as const, 'caddie choice');
      if (g.mode === 'designated') mustExist('caddies', g.caddieId, 'Designated caddie');
      for (const m of g.members) {
        mustExist('members', m.memberId, 'Member');
        oneOf(m.equipment, ['own', 'storage'] as const, 'equipment');
        if (seen.has(m.memberId)) throw new RuleError('A member can only be in one cart.');
        seen.add(m.memberId);
        // Today's requests, plus any session still on course from an earlier day.
        const busy = get(
          `SELECT 1 FROM dispatch_members dm JOIN dispatches d ON d.id = dm.dispatch_id
           WHERE dm.member_id = ? AND (d.status = 'out' OR (d.date = ? AND d.status IN ('pending','called','standby')))`,
          m.memberId,
          date,
        );
        if (busy) throw new RuleError('One of these members already has an active session.');
      }
    }

    // Designated carts first, so a designated caddie already called with Next is not given to a queue cart.
    const groups = [...input.groups].sort((a, b) => Number(b.mode === 'designated') - Number(a.mode === 'designated'));
    for (const g of groups) {
      if (g.mode === 'designated' && !g.caddieId) throw new RuleError('Pick the designated caddie for this cart.');
      const open = g.mode === 'designated' ? openCallFor(g.caddieId!, date) : nextOpenCall(date);
      let dispatchId: number;
      if (open) {
        // Fill an open call. A caddie already standing by at Bag Drop takes the bag now: the session starts.
        const standby = open.status === 'standby';
        run(
          `UPDATE dispatches SET party_id = ?, reason = ?, requested_caddie_id = ?, holes = ?, created_at = ?, status = ?, arrived_at = ?
           WHERE id = ?`,
          partyId,
          g.mode,
          g.mode === 'designated' ? g.caddieId! : null,
          input.holes,
          now,
          standby ? 'out' : 'called',
          standby ? now : null,
          open.id,
        );
        if (standby) run(`UPDATE shifts SET status = 'out' WHERE id = ?`, open.shift_id);
        dispatchId = open.id;
      } else {
        const res = run(
          `INSERT INTO dispatches (date, party_id, status, reason, requested_caddie_id, holes, created_at)
           VALUES (?, ?, 'pending', ?, ?, ?, ?)`,
          date,
          partyId,
          g.mode,
          g.mode === 'designated' ? g.caddieId! : null,
          input.holes,
          now,
        );
        dispatchId = Number(res.lastInsertRowid);
      }
      ids.push(dispatchId);

      for (const m of g.members) {
        let storageItemId: number | null = null;
        if (m.equipment === 'storage') {
          const item = get(`SELECT * FROM storage_items WHERE id = ? AND member_id = ?`, m.storageItemId ?? -1, m.memberId);
          if (!item) throw new RuleError('Pick which stored bag to bring out.');
          if (item.status !== 'stored') throw new RuleError(`Bag ${item.tag} is not in storage.`);
          run(`UPDATE storage_items SET status = 'out', updated_at = ? WHERE id = ?`, now, item.id);
          storageItemId = item.id;
        }
        run(
          `INSERT INTO dispatch_members (dispatch_id, member_id, equipment, storage_item_id) VALUES (?, ?, ?, ?)`,
          dispatchId,
          m.memberId,
          m.equipment,
          storageItemId,
        );
      }
    }
    servePending(now);
    return { partyId, dispatchIds: ids };
  });
}

function activeDispatch(id: number, allowed: string[]): Row {
  const d = get(`SELECT * FROM dispatches WHERE id = ?`, id);
  if (!d) throw new RuleError('Dispatch not found.');
  if (!allowed.includes(d.status)) throw new RuleError(`This request is already ${d.status}.`);
  return d;
}

/**
 * Caddie has reached Bag Drop. With a member assigned they take the bag and the session starts;
 * an open call from Next stands by until the next member arrives.
 */
export function markArrived(id: number) {
  return tx(() => {
    const d = activeDispatch(id, ['called']);
    const now = Date.now();
    if (!get(`SELECT 1 FROM dispatch_members WHERE dispatch_id = ?`, id)) {
      run(`UPDATE dispatches SET status = 'standby', ready_at = ? WHERE id = ?`, now, id);
      return;
    }
    run(`UPDATE dispatches SET status = 'out', ready_at = ?, arrived_at = ? WHERE id = ?`, now, now, id);
    run(`UPDATE shifts SET status = 'out' WHERE id = ?`, d.shift_id);
  });
}

/** Put the call back on the board and restart the no-show timer. */
export function recall(id: number) {
  return tx(() => {
    activeDispatch(id, ['called']);
    run(`UPDATE dispatches SET recalled_at = ? WHERE id = ?`, Date.now(), id);
  });
}

/** Caddie did not show: they go to the back of the queue and the request goes to the next caddie in line. */
export function passToNext(id: number) {
  return tx(() => {
    const d = activeDispatch(id, ['called']);
    const shift = get(`SELECT * FROM shifts WHERE id = ?`, d.shift_id);
    run(
      `UPDATE dispatches SET status = 'pending', reason = 'fifo', shift_id = NULL, caddie_id = NULL, cart_id = NULL,
       called_at = NULL, recalled_at = NULL WHERE id = ?`,
      id,
    );
    // Serve the request before the missed caddie rejoins, so it is not handed straight back to them.
    servePending();
    run(`UPDATE shifts SET status = 'waiting', queue_seq = ? WHERE id = ?`, backOfQueue(shift!.date), shift!.id);
    servePending();
  });
}

/** Designated caddie is unavailable and the member chose not to wait. */
export function switchToQueue(id: number) {
  return tx(() => {
    activeDispatch(id, ['pending']);
    run(`UPDATE dispatches SET reason = 'fifo' WHERE id = ?`, id);
    servePending();
  });
}

export function cancelDispatch(id: number) {
  return tx(() => {
    const d = activeDispatch(id, ['pending', 'called', 'standby']);
    const now = Date.now();
    run(`UPDATE dispatches SET status = 'cancelled', cancelled_at = ? WHERE id = ?`, now, id);
    // A cancelled or unneeded call is not the caddie's fault: they return to their old place in line.
    if (d.status === 'called' || d.status === 'standby') run(`UPDATE shifts SET status = 'waiting' WHERE id = ?`, d.shift_id);
    run(
      `UPDATE storage_items SET status = 'stored', updated_at = ?
       WHERE id IN (SELECT storage_item_id FROM dispatch_members WHERE dispatch_id = ? AND storage_item_id IS NOT NULL)`,
      now,
      id,
    );
    servePending(now);
  });
}

/** Bag is back at Bag Drop: the session ends and the caddie goes to the back of the queue. */
export function endSession(id: number, returns: ReturnInput[]) {
  const list = Array.isArray(returns) ? returns : [];
  const photos = new Map(list.map((r) => [r?.dispatchMemberId, r?.to === 'storage' ? decodePhoto(r.photo) : null]));
  return tx(() => {
    const d = activeDispatch(id, ['out']);
    const now = Date.now();
    const members = all(`SELECT * FROM dispatch_members WHERE dispatch_id = ?`, id);
    for (const m of members) {
      const r = list.find((x) => x?.dispatchMemberId === m.id);
      const to = r?.to == null ? (m.equipment === 'storage' ? 'storage' : 'member') : oneOf(r.to, ['member', 'storage'] as const, 'bag destination');
      let storedItemId: number | null = null;
      if (m.storage_item_id) {
        run(`UPDATE storage_items SET status = ?, updated_at = ? WHERE id = ?`, to === 'storage' ? 'stored' : 'withdrawn', now, m.storage_item_id);
        if (to === 'storage') storedItemId = m.storage_item_id;
      } else if (to === 'storage') {
        const tag = String(r?.tag ?? '').trim().toUpperCase();
        if (!tag) throw new RuleError('Enter the storage tag for bags going into storage.');
        const existing = get(`SELECT * FROM storage_items WHERE tag = ?`, tag);
        if (existing && existing.status !== 'withdrawn') throw new RuleError(`Storage tag ${tag} is already in use.`);
        const description = String(r?.description ?? '').trim() || 'Golf bag';
        if (existing) {
          run(
            `UPDATE storage_items SET member_id = ?, description = ?, status = 'stored', updated_at = ? WHERE id = ?`,
            m.member_id,
            description,
            now,
            existing.id,
          );
          run(`UPDATE dispatch_members SET storage_item_id = ? WHERE id = ?`, existing.id, m.id);
          storedItemId = existing.id;
        } else {
          const res = run(
            `INSERT INTO storage_items (tag, member_id, description, status, updated_at) VALUES (?, ?, ?, 'stored', ?)`,
            tag,
            m.member_id,
            description,
            now,
          );
          storedItemId = Number(res.lastInsertRowid);
          run(`UPDATE dispatch_members SET storage_item_id = ? WHERE id = ?`, storedItemId, m.id);
        }
      }
      const photo = photos.get(m.id);
      if (photo && storedItemId) savePhoto(storedItemId, 'return', photo, id);
      run(`UPDATE dispatch_members SET returned_to = ? WHERE id = ?`, to, m.id);
    }
    run(`UPDATE dispatches SET status = 'done', ended_at = ? WHERE id = ?`, now, id);
    const shift = get(`SELECT * FROM shifts WHERE id = ?`, d.shift_id);
    if (shift && shift.status !== 'off') {
      run(`UPDATE shifts SET status = 'waiting', queue_seq = ? WHERE id = ?`, backOfQueue(shift.date), shift.id);
    }
    servePending(now);
  });
}

// ---- Storage ----

export function depositBag(memberIdInput: unknown, tag: string, description: string, photoInput?: unknown) {
  const photo = decodePhoto(photoInput);
  return tx(() => {
    const memberId = mustExist('members', memberIdInput, 'Member');
    const clean = tag.trim().toUpperCase();
    if (!clean) throw new RuleError('Enter a storage tag.');
    const existing = get(`SELECT * FROM storage_items WHERE tag = ?`, clean);
    const now = Date.now();
    if (existing && existing.status !== 'withdrawn') throw new RuleError(`Storage tag ${clean} is already in use.`);
    let itemId: number;
    if (existing) {
      itemId = existing.id;
      run(
        `UPDATE storage_items SET member_id = ?, description = ?, status = 'stored', updated_at = ? WHERE id = ?`,
        memberId,
        description.trim() || 'Golf bag',
        now,
        existing.id,
      );
    } else {
      const res = run(
        `INSERT INTO storage_items (tag, member_id, description, status, updated_at) VALUES (?, ?, ?, 'stored', ?)`,
        clean,
        memberId,
        description.trim() || 'Golf bag',
        now,
      );
      itemId = Number(res.lastInsertRowid);
    }
    if (photo) savePhoto(itemId, 'deposit', photo);
  });
}

/** A later photo of a bag in the register, e.g. a condition check or a bag stored before photos existed. */
export function addStoragePhoto(itemIdInput: unknown, photoInput: unknown) {
  const photo = decodePhoto(photoInput);
  if (!photo) throw new RuleError('Take a photo first.');
  return tx(() => {
    const itemId = mustExist('storage_items', itemIdInput, 'Bag');
    savePhoto(itemId, 'check', photo);
  });
}

export function withdrawBag(itemId: number) {
  const item = get(`SELECT * FROM storage_items WHERE id = ?`, itemId);
  if (!item) throw new RuleError('Bag not found.');
  if (item.status !== 'stored') throw new RuleError('This bag is out with a caddie. Close that session instead.');
  run(`UPDATE storage_items SET status = 'withdrawn', updated_at = ? WHERE id = ?`, Date.now(), itemId);
}
