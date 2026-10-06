import { all, type Row } from './db.ts';
import { clubDate } from './time.ts';
import { RULES, type Dispatch, type DispatchMember, type Holes, type Member, type Report, type Shift, type Snapshot, type StorageItem, type StoragePhoto } from '../shared/types.ts';

const DISPATCH_SELECT = `
  SELECT d.*, c.name AS caddie_name, k.number AS cart_number, rc.name AS requested_name
  FROM dispatches d
  LEFT JOIN caddies c ON c.id = d.caddie_id
  LEFT JOIN carts k ON k.id = d.cart_id
  LEFT JOIN caddies rc ON rc.id = d.requested_caddie_id`;

function hydrate(rows: Row[]): Dispatch[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const memberRows = all(
    `SELECT dm.*, m.name, m.member_no, s.tag, s.description
     FROM dispatch_members dm
     JOIN members m ON m.id = dm.member_id
     LEFT JOIN storage_items s ON s.id = dm.storage_item_id
     WHERE dm.dispatch_id IN (${ids.map(() => '?').join(',')})
     ORDER BY dm.id`,
    ...ids,
  );
  const byDispatch = new Map<number, DispatchMember[]>();
  for (const m of memberRows) {
    const list = byDispatch.get(m.dispatch_id) ?? [];
    list.push({
      id: m.id,
      memberId: m.member_id,
      memberNo: m.member_no,
      name: m.name,
      equipment: m.equipment,
      storageItemId: m.storage_item_id,
      storageTag: m.tag,
      storageDescription: m.description,
      returnedTo: m.returned_to,
    });
    byDispatch.set(m.dispatch_id, list);
  }
  return rows.map((r) => ({
    id: r.id,
    partyId: r.party_id,
    status: r.status,
    reason: r.reason,
    requestedCaddieId: r.requested_caddie_id,
    requestedCaddieName: r.requested_name,
    caddieId: r.caddie_id,
    caddieName: r.caddie_name,
    cartId: r.cart_id,
    cartNumber: r.cart_number,
    holes: r.holes as Holes,
    createdAt: r.created_at,
    calledAt: r.called_at,
    recalledAt: r.recalled_at,
    readyAt: r.ready_at,
    arrivedAt: r.arrived_at,
    endedAt: r.ended_at,
    members: byDispatch.get(r.id) ?? [],
  }));
}

export function getDispatch(id: number): Dispatch | undefined {
  return hydrate(all(`${DISPATCH_SELECT} WHERE d.id = ?`, id))[0];
}

export function getShifts(date: string): Shift[] {
  const rows = all(
    `SELECT s.*, c.name AS caddie_name, c.emp_no, k.number AS cart_number
     FROM shifts s JOIN caddies c ON c.id = s.caddie_id JOIN carts k ON k.id = s.cart_id
     WHERE s.date = ? ORDER BY s.queue_seq`,
    date,
  );
  let pos = 0;
  return rows.map((r) => ({
    id: r.id,
    caddieId: r.caddie_id,
    caddieName: r.caddie_name,
    empNo: r.emp_no,
    cartId: r.cart_id,
    cartNumber: r.cart_number,
    status: r.status,
    checkInAt: r.check_in_at,
    queueSeq: r.queue_seq,
    position: r.status === 'waiting' ? ++pos : null,
  }));
}

export function snapshot(): Snapshot {
  const now = Date.now();
  const date = clubDate(now);
  return {
    now,
    date,
    shifts: getShifts(date),
    active: hydrate(
      // Sessions left on course from an earlier day stay visible so Bag Drop can close them.
      all(
        `${DISPATCH_SELECT} WHERE (d.date = ? AND d.status IN ('pending','called','standby','out')) OR (d.date < ? AND d.status = 'out')
         ORDER BY d.created_at, d.id`,
        date,
        date,
      ),
    ),
    recent: hydrate(all(`${DISPATCH_SELECT} WHERE d.date = ? AND d.status = 'done' ORDER BY d.ended_at DESC LIMIT 12`, date)),
    carts: all(`SELECT id, number FROM carts WHERE active = 1 ORDER BY CAST(number AS INTEGER), number`).map((r) => ({
      id: r.id,
      number: r.number,
    })),
    caddies: all(`SELECT id, emp_no, name FROM caddies WHERE active = 1 ORDER BY name`).map((r) => ({
      id: r.id,
      empNo: r.emp_no,
      name: r.name,
    })),
  };
}

const MEMBER_SELECT = `
  SELECT m.id, m.member_no, m.name, m.designated_caddie_id, c.name AS caddie_name
  FROM members m LEFT JOIN caddies c ON c.id = m.designated_caddie_id`;

const toMember = (r: Row): Member => ({
  id: r.id,
  memberNo: r.member_no,
  name: r.name,
  designatedCaddieId: r.designated_caddie_id,
  designatedCaddieName: r.caddie_name,
});

/**
 * Member lookup by name or member number.
 * POC: reads the local members table. Production: swap for the club's membership database.
 */
export function searchMembers(q: string, limit = 12): Member[] {
  const term = q.trim();
  if (!term) return all(`${MEMBER_SELECT} ORDER BY m.name LIMIT ?`, limit).map(toMember);
  return all(
    `${MEMBER_SELECT}
     WHERE m.member_no LIKE ? OR m.name LIKE ? OR m.name LIKE ?
     ORDER BY (m.member_no = ?) DESC, m.name LIMIT ?`,
    `${term}%`,
    `${term}%`,
    `% ${term}%`,
    term,
    limit,
  ).map(toMember);
}

export function listDesignations(): Member[] {
  return all(`${MEMBER_SELECT} ORDER BY m.name`).map(toMember);
}

export function listStorage(memberId?: number): StorageItem[] {
  const rows = all(
    `SELECT s.*, m.name AS member_name, m.member_no,
       (SELECT p.id FROM storage_photos p WHERE p.item_id = s.id ORDER BY p.taken_at DESC, p.id DESC LIMIT 1) AS photo_id,
       (SELECT COUNT(*) FROM storage_photos p WHERE p.item_id = s.id) AS photo_count
     FROM storage_items s JOIN members m ON m.id = s.member_id
     WHERE s.status != 'withdrawn' ${memberId ? 'AND s.member_id = ?' : ''}
     ORDER BY s.tag`,
    ...(memberId ? [memberId] : []),
  );
  return rows.map((r) => ({
    id: r.id,
    tag: r.tag,
    memberId: r.member_id,
    memberName: r.member_name,
    memberNo: r.member_no,
    description: r.description,
    status: r.status,
    updatedAt: r.updated_at,
    photoId: r.photo_id,
    photoCount: r.photo_count,
  }));
}

export function listPhotos(itemId: number): StoragePhoto[] {
  return all(`SELECT id, kind, taken_at FROM storage_photos WHERE item_id = ? ORDER BY taken_at DESC, id DESC`, itemId).map((r) => ({
    id: r.id,
    kind: r.kind,
    takenAt: r.taken_at,
  }));
}

const minutes = (ms: number) => Math.round((ms / 60_000) * 10) / 10;
const avg = (xs: number[]) => (xs.length ? minutes(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function report(from: string, to: string): Report {
  const log = hydrate(
    all(
      `${DISPATCH_SELECT} WHERE d.date BETWEEN ? AND ? AND d.status IN ('out','done') ORDER BY d.arrived_at DESC`,
      from,
      to,
    ),
  );

  const caddies = new Map<number, Report['perCaddie'][number] & { durations: number[] }>();
  const members = new Map<number, Report['perMember'][number] & { waits: number[] }>();
  const waits: number[] = [];
  let noShowAlerts = 0;

  const empNos = new Map(all(`SELECT id, emp_no FROM caddies`).map((r) => [r.id as number, r.emp_no as string]));
  for (const d of log) {
    if (d.caddieId == null || d.arrivedAt == null) continue;
    const empNo = empNos.get(d.caddieId) ?? '';
    const c = caddies.get(d.caddieId) ?? {
      caddieId: d.caddieId,
      name: d.caddieName ?? '',
      empNo,
      rounds: 0,
      holes: 0,
      designated: 0,
      avgRoundMin: null,
      durations: [],
    };
    c.rounds += 1;
    c.holes += d.holes;
    if (d.reason === 'designated') c.designated += 1;
    if (d.endedAt) c.durations.push(d.endedAt - d.arrivedAt);
    caddies.set(d.caddieId, c);

    // Member wait: from request at Bag Drop until the caddie arrives for the bag.
    const wait = d.arrivedAt - d.createdAt;
    waits.push(wait);
    if (d.calledAt && (d.readyAt ?? d.arrivedAt) - d.calledAt > RULES.noShowMinutes * 60_000) noShowAlerts += 1;
    for (const m of d.members) {
      const e = members.get(m.memberId) ?? {
        memberId: m.memberId,
        name: m.name,
        memberNo: m.memberNo,
        visits: 0,
        avgWaitMin: null,
        maxWaitMin: null,
        waits: [],
      };
      e.visits += 1;
      e.waits.push(wait);
      members.set(m.memberId, e);
    }
  }

  return {
    from,
    to,
    log,
    perCaddie: [...caddies.values()]
      .map(({ durations, ...c }) => ({ ...c, avgRoundMin: avg(durations) }))
      .sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name)),
    perMember: [...members.values()]
      .map(({ waits: w, ...m }) => ({ ...m, avgWaitMin: avg(w), maxWaitMin: w.length ? minutes(Math.max(...w)) : null }))
      .sort((a, b) => (b.avgWaitMin ?? 0) - (a.avgWaitMin ?? 0)),
    summary: { sessions: log.length, avgWaitMin: avg(waits), noShowAlerts },
  };
}
