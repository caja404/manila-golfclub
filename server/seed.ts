// Demo data for the POC. Names and numbers are fictional samples.
// Today's live state is built relative to "now" so the board always looks like a working morning.

import { db, get, run, tx } from './db.ts';
import { addDays, clubDate, clubTime } from './time.ts';
import { clearPhotoFiles } from './photos.ts';

const CADDIES = [
  'Juan Dela Cruz', 'Rodel Bautista', 'Jun Santos', 'Ramil Garcia', 'Arnel Reyes', 'Bong Villanueva',
  'Dindo Mendoza', 'Efren Castillo', 'Rey Navarro', 'Totoy Aquino', 'Noel Ramos', 'Edwin Torres',
  'Ariel Flores', 'Romy Gonzales', 'Nonoy Pascual', 'Jojo Manalo', 'Benjie Salazar', 'Lito Domingo',
  'Mario Cruz', 'Boyet Lim', 'Dante Ocampo', 'Ernie Valdez', 'Gerry Soriano', 'Raffy Bernardo',
];

const MEMBERS: [string, string | null][] = [
  ['Clark Santiago', 'Juan Dela Cruz'],
  ['Antonio Ayala', 'Rodel Bautista'],
  ['Eduardo Cojuangco', null],
  ['Ramon Lopez', 'Arnel Reyes'],
  ['Miguel Zobel', null],
  ['Fernando Sy', 'Dindo Mendoza'],
  ['Ricardo Tan', null],
  ['Jaime Aboitiz', 'Efren Castillo'],
  ['Carlos Gokongwei', null],
  ['Luis Ortigas', null],
  ['Manuel Pangilinan', 'Noel Ramos'],
  ['Roberto Ongpin', null],
  ['Andres Soriano', 'Ariel Flores'],
  ['Felipe Razon', null],
  ['Enrique Yuchengco', null],
  ['Jose Consunji', 'Romy Gonzales'],
  ['Alfonso Puyat', null],
  ['Vicente Madrigal', null],
  ['Paolo Elizalde', 'Jojo Manalo'],
  ['Teodoro Benitez', null],
  ['Gabriel Lhuillier', null],
  ['Rafael Prieto', 'Lito Domingo'],
  ['Santiago Roxas', null],
  ['Bernardo Araneta', null],
  ['Francisco Tuason', 'Boyet Lim'],
  ['Ignacio Legarda', null],
  ['Dominic Uy', null],
  ['Patrick Go', 'Ernie Valdez'],
  ['Martin Romualdez', null],
  ['Leandro Locsin', null],
  ['Victor Concepcion', null],
  ['Emilio Yap', 'Raffy Bernardo'],
  ['Hector Villar', null],
  ['Oscar Lacson', null],
  ['Pablo Zamora', null],
  ['Lorenzo Tanco', null],
];

const STORAGE: [string, string, string][] = [
  ['S-021', 'Clark Santiago', 'Titleist staff bag, black/red, 14 clubs'],
  ['S-004', 'Antonio Ayala', 'Ping cart bag, navy'],
  ['S-009', 'Eduardo Cojuangco', 'Callaway tour bag, white'],
  ['S-012', 'Ramon Lopez', 'TaylorMade stand bag, grey'],
  ['S-017', 'Fernando Sy', 'Honma tour bag, red/white'],
  ['S-023', 'Jaime Aboitiz', 'Titleist cart bag, green'],
  ['S-030', 'Manuel Pangilinan', 'Mizuno staff bag, blue'],
  ['S-031', 'Andres Soriano', 'Ping stand bag, black'],
  ['S-036', 'Jose Consunji', 'Srixon cart bag, yellow/black'],
  ['S-040', 'Rafael Prieto', 'Callaway cart bag, black, travel cover'],
  ['S-042', 'Emilio Yap', 'Honma Beres bag, white/gold'],
  ['S-047', 'Dominic Uy', 'Cobra stand bag, orange'],
];

/** Small deterministic PRNG so the demo looks the same every reset. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Replace all data with the demo morning. All or nothing: a failure leaves the old data untouched. */
export function resetDemo() {
  tx(seedAll);
  clearPhotoFiles();
}

function seedAll() {
  // Children before parents, so foreign keys hold at every step.
  db.exec(`
    DELETE FROM storage_photos; DELETE FROM dispatch_members; DELETE FROM dispatches; DELETE FROM shifts;
    DELETE FROM storage_items; DELETE FROM members; DELETE FROM carts; DELETE FROM caddies;
  `);

  const caddieId = new Map<string, number>();
  CADDIES.forEach((name, i) => {
    const r = run(`INSERT INTO caddies (emp_no, name) VALUES (?, ?)`, `CD-${String(101 + i)}`, name);
    caddieId.set(name, Number(r.lastInsertRowid));
  });

  const cartIds: number[] = [];
  for (let n = 1; n <= 26; n++) {
    const r = run(`INSERT INTO carts (number) VALUES (?)`, String(n).padStart(2, '0'));
    cartIds.push(Number(r.lastInsertRowid));
  }

  const memberId = new Map<string, number>();
  MEMBERS.forEach(([name, caddie], i) => {
    const r = run(
      `INSERT INTO members (member_no, name, designated_caddie_id) VALUES (?, ?, ?)`,
      String(1020 + i * 7),
      name,
      caddie ? caddieId.get(caddie)! : null,
    );
    memberId.set(name, Number(r.lastInsertRowid));
  });

  const now = Date.now();
  for (const [tag, member, description] of STORAGE) {
    run(
      `INSERT INTO storage_items (tag, member_id, description, status, updated_at) VALUES (?, ?, ?, 'stored', ?)`,
      tag,
      memberId.get(member)!,
      description,
      now - 3 * 86_400_000,
    );
  }

  seedHistory(caddieId, cartIds, [...memberId.values()]);
  seedToday(now, caddieId, cartIds, memberId);
}

let partySeq = 0;

function insertDispatch(o: {
  date: string;
  status: string;
  reason: 'designated' | 'fifo';
  requested?: number | null;
  shiftId?: number | null;
  caddie?: number | null;
  cart?: number | null;
  holes: 9 | 18;
  created: number;
  called?: number | null;
  arrived?: number | null;
  ended?: number | null;
  members: { id: number; equipment: 'own' | 'storage'; storageItemId?: number | null; returnedTo?: string | null }[];
}) {
  const r = run(
    `INSERT INTO dispatches (date, party_id, status, reason, requested_caddie_id, shift_id, caddie_id, cart_id, holes,
       created_at, called_at, arrived_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    o.date,
    ++partySeq,
    o.status,
    o.reason,
    o.requested ?? null,
    o.shiftId ?? null,
    o.caddie ?? null,
    o.cart ?? null,
    o.holes,
    o.created,
    o.called ?? null,
    o.arrived ?? null,
    o.ended ?? null,
  );
  const id = Number(r.lastInsertRowid);
  for (const m of o.members) {
    run(
      `INSERT INTO dispatch_members (dispatch_id, member_id, equipment, storage_item_id, returned_to) VALUES (?, ?, ?, ?, ?)`,
      id,
      m.id,
      m.equipment,
      m.storageItemId ?? null,
      m.returnedTo ?? null,
    );
  }
  return id;
}

/** Six previous days of finished rounds, for the reports. */
function seedHistory(caddieId: Map<string, number>, cartIds: number[], memberIds: number[]) {
  const rand = rng(20261006);
  const caddies = [...caddieId.values()];
  const designated = new Map<number, number>(
    (db.prepare(`SELECT id, designated_caddie_id FROM members WHERE designated_caddie_id IS NOT NULL`).all() as any[]).map(
      (r) => [r.id, r.designated_caddie_id],
    ),
  );
  const today = clubDate();
  for (let back = 6; back >= 1; back--) {
    const date = addDays(today, -back);
    const rounds = 14 + Math.floor(rand() * 10);
    const pool = [...memberIds].sort(() => rand() - 0.5);
    for (let i = 0; i < rounds && pool.length; i++) {
      const size = rand() < 0.35 ? 2 : 1;
      const members = pool.splice(0, size);
      const lead = members[0];
      const des = designated.get(lead);
      const caddie = des ?? caddies[Math.floor(rand() * caddies.length)];
      const holes: 9 | 18 = rand() < 0.25 ? 9 : 18;
      const created = clubTime(date, 5, 30) + Math.floor(rand() * 7 * 60) * 60_000;
      const called = created + Math.floor(rand() * 3 * 60_000);
      const late = rand() < 0.1;
      const arrived = called + Math.floor((late ? 6 + rand() * 5 : 1.5 + rand() * 3) * 60_000);
      const roundMin = holes === 18 ? 230 + rand() * 60 : 115 + rand() * 30;
      insertDispatch({
        date,
        status: 'done',
        reason: des ? 'designated' : 'fifo',
        requested: des ?? null,
        caddie,
        cart: cartIds[caddies.indexOf(caddie) % cartIds.length],
        holes,
        created,
        called,
        arrived,
        ended: arrived + Math.floor(roundMin * 60_000),
        members: members.map((id) => ({ id, equipment: 'own' as const, returnedTo: 'member' })),
      });
    }
  }
}

/** A working morning: caddies checked in, some on course, a couple of calls on the board. */
function seedToday(now: number, caddieId: Map<string, number>, cartIds: number[], memberId: Map<string, number>) {
  const date = clubDate(now);
  const min = (m: number) => now - m * 60_000;
  const C = (name: string) => caddieId.get(name)!;
  const M = (name: string) => memberId.get(name)!;
  const storageId = (tag: string) => get(`SELECT id FROM storage_items WHERE tag = ?`, tag)!.id as number;

  // [caddie, cart index, status, checked-in minutes ago]. Order here is queue order for those waiting.
  const roster: [string, number, string, number][] = [
    ['Rodel Bautista', 1, 'out', 400],
    ['Jun Santos', 2, 'out', 395],
    ['Ramil Garcia', 3, 'out', 390],
    ['Arnel Reyes', 4, 'out', 385],
    ['Bong Villanueva', 5, 'out', 380],
    ['Efren Castillo', 7, 'out', 370],
    ['Dindo Mendoza', 6, 'called', 375],
    ['Rey Navarro', 8, 'called', 365],
    ['Edwin Torres', 11, 'waiting', 350],
    ['Ariel Flores', 12, 'break', 345],
    ['Romy Gonzales', 13, 'waiting', 340],
    ['Juan Dela Cruz', 14, 'waiting', 335],
    ['Nonoy Pascual', 15, 'waiting', 330],
    ['Jojo Manalo', 16, 'waiting', 325],
    ['Benjie Salazar', 17, 'waiting', 320],
    ['Lito Domingo', 18, 'waiting', 315],
    ['Mario Cruz', 19, 'waiting', 300],
    // Finished 9-hole rounds earlier today, so they are at the back.
    ['Totoy Aquino', 9, 'waiting', 360],
    ['Noel Ramos', 10, 'waiting', 355],
  ];
  // Not yet checked in: Boyet Lim, Dante Ocampo, Ernie Valdez, Gerry Soriano, Raffy Bernardo.

  const shift = new Map<string, number>();
  roster.forEach(([name, cart, status, ago], i) => {
    const r = run(
      `INSERT INTO shifts (date, caddie_id, cart_id, check_in_at, status, queue_seq) VALUES (?, ?, ?, ?, ?, ?)`,
      date,
      C(name),
      cartIds[cart - 1],
      min(ago),
      status,
      i + 1,
    );
    shift.set(name, Number(r.lastInsertRowid));
  });

  const onCourse = (
    caddie: string,
    members: [string, ('own' | 'storage')?, string?][],
    holes: 9 | 18,
    teeAgo: number,
    designated = false,
  ) => {
    for (const [, eq, tag] of members) {
      if (eq === 'storage' && tag) run(`UPDATE storage_items SET status = 'out' WHERE tag = ?`, tag);
    }
    insertDispatch({
      date,
      status: 'out',
      reason: designated ? 'designated' : 'fifo',
      requested: designated ? C(caddie) : null,
      shiftId: shift.get(caddie)!,
      caddie: C(caddie),
      cart: get(`SELECT cart_id FROM shifts WHERE id = ?`, shift.get(caddie)!)!.cart_id,
      holes,
      created: min(teeAgo + 6),
      called: min(teeAgo + 5),
      arrived: min(teeAgo),
      members: members.map(([n, eq, tag]) => ({
        id: M(n),
        equipment: eq ?? 'own',
        storageItemId: eq === 'storage' && tag ? storageId(tag) : null,
      })),
    });
  };

  onCourse('Arnel Reyes', [['Ramon Lopez', 'storage', 'S-012']], 18, 318, true); // overdue
  onCourse('Rodel Bautista', [['Antonio Ayala', 'storage', 'S-004'], ['Luis Ortigas']], 18, 236, true);
  onCourse('Jun Santos', [['Ricardo Tan'], ['Carlos Gokongwei']], 18, 192);
  onCourse('Ramil Garcia', [['Miguel Zobel']], 9, 158); // overdue on 9 holes
  onCourse('Bong Villanueva', [['Teodoro Benitez'], ['Hector Villar']], 18, 74);
  onCourse('Efren Castillo', [['Jaime Aboitiz', 'storage', 'S-023']], 18, 31, true);

  // On the board: one designated call 7 minutes old (no-show alert), one FIFO call just made.
  run(`UPDATE storage_items SET status = 'out' WHERE tag = 'S-017'`);
  insertDispatch({
    date,
    status: 'called',
    reason: 'designated',
    requested: C('Dindo Mendoza'),
    shiftId: shift.get('Dindo Mendoza'),
    caddie: C('Dindo Mendoza'),
    cart: cartIds[5],
    holes: 18,
    created: min(7),
    called: min(7),
    members: [{ id: M('Fernando Sy'), equipment: 'storage', storageItemId: storageId('S-017') }],
  });
  insertDispatch({
    date,
    status: 'called',
    reason: 'fifo',
    shiftId: shift.get('Rey Navarro'),
    caddie: C('Rey Navarro'),
    cart: cartIds[7],
    holes: 9,
    created: min(1),
    called: min(1),
    members: [{ id: M('Pablo Zamora'), equipment: 'own' }],
  });

  // Waiting for a designated caddie who has not checked in yet.
  insertDispatch({
    date,
    status: 'pending',
    reason: 'designated',
    requested: C('Ernie Valdez'),
    holes: 18,
    created: min(4),
    members: [{ id: M('Patrick Go'), equipment: 'own' }],
  });

  // Finished earlier today.
  const doneToday: [string, string, 9 | 18, number, number][] = [
    ['Totoy Aquino', 'Santiago Roxas', 9, 300, 165],
    ['Noel Ramos', 'Manuel Pangilinan', 9, 290, 150],
  ];
  for (const [caddie, member, holes, startAgo, endAgo] of doneToday) {
    insertDispatch({
      date,
      status: 'done',
      reason: member === 'Manuel Pangilinan' ? 'designated' : 'fifo',
      requested: member === 'Manuel Pangilinan' ? C(caddie) : null,
      shiftId: shift.get(caddie),
      caddie: C(caddie),
      cart: get(`SELECT cart_id FROM shifts WHERE id = ?`, shift.get(caddie)!)!.cart_id,
      holes,
      created: min(startAgo + 5),
      called: min(startAgo + 4),
      arrived: min(startAgo),
      ended: min(endAgo),
      members: [{ id: M(member), equipment: 'own', returnedTo: 'member' }],
    });
  }
}

export function ensureSeeded() {
  const count = get(`SELECT COUNT(*) AS n FROM caddies`)?.n as number;
  if (!count) resetDemo();
}
