// Types shared by the API server and the web screens.

export const RULES = {
  /** Minutes after a call before Bag Drop is alerted that the caddie has not shown. */
  noShowMinutes: 5,
  /** Minutes on course before a session is flagged overdue. Never auto-closed. */
  overdueMinutes: { 9: 150, 18: 300 } as Record<Holes, number>,
  /** Minutes a call stays highlighted on the Caddie House display. */
  freshCallMinutes: 1,
};

export type Holes = 9 | 18;

/** A caddie's state for the day (one duty shift per caddie per day). */
export type ShiftStatus = 'waiting' | 'called' | 'out' | 'break' | 'off';

/**
 * pending = waiting for a caddie to become free; called = on the Caddie House board;
 * standby = caddie called with Next is at Bag Drop with no member yet; out = on course.
 */
export type DispatchStatus = 'pending' | 'called' | 'standby' | 'out' | 'done' | 'cancelled';

export type DispatchReason = 'designated' | 'fifo';
export type Equipment = 'own' | 'storage';

export interface Caddie {
  id: number;
  empNo: string;
  name: string;
}

export interface Cart {
  id: number;
  number: string;
}

export interface Member {
  id: number;
  memberNo: string;
  name: string;
  designatedCaddieId: number | null;
  designatedCaddieName?: string | null;
}

export interface Shift {
  id: number;
  caddieId: number;
  caddieName: string;
  empNo: string;
  cartId: number;
  cartNumber: string;
  status: ShiftStatus;
  checkInAt: number;
  queueSeq: number;
  /** 1-based position among caddies waiting in the queue; null when not waiting. */
  position: number | null;
}

export interface DispatchMember {
  id: number;
  memberId: number;
  memberNo: string;
  name: string;
  equipment: Equipment;
  storageItemId: number | null;
  storageTag: string | null;
  storageDescription: string | null;
  returnedTo: 'member' | 'storage' | null;
}

export interface Dispatch {
  id: number;
  partyId: number;
  status: DispatchStatus;
  reason: DispatchReason;
  requestedCaddieId: number | null;
  requestedCaddieName: string | null;
  caddieId: number | null;
  caddieName: string | null;
  cartId: number | null;
  cartNumber: string | null;
  holes: Holes;
  createdAt: number;
  calledAt: number | null;
  recalledAt: number | null;
  /** Caddie reached Bag Drop. */
  readyAt: number | null;
  /** Session started: caddie took the bag. */
  arrivedAt: number | null;
  endedAt: number | null;
  members: DispatchMember[];
}

export interface StorageItem {
  id: number;
  tag: string;
  memberId: number;
  memberName: string;
  memberNo: string;
  description: string;
  status: 'stored' | 'out' | 'withdrawn';
  updatedAt: number;
  /** Most recent photo, if any. */
  photoId: number | null;
  photoCount: number;
}

export type PhotoKind = 'deposit' | 'return' | 'check';

export interface StoragePhoto {
  id: number;
  kind: PhotoKind;
  takenAt: number;
}

export interface Snapshot {
  now: number;
  date: string;
  shifts: Shift[];
  /** Today's pending, called, standing-by and on-course dispatches. */
  active: Dispatch[];
  /** Today's most recently finished sessions. */
  recent: Dispatch[];
  carts: Cart[];
  caddies: Caddie[];
}

// ---- Requests ----

export interface PartyMemberInput {
  memberId: number;
  equipment: Equipment;
  storageItemId?: number | null;
}

export interface CartGroupInput {
  mode: DispatchReason;
  /** Required when mode is designated. */
  caddieId?: number | null;
  members: PartyMemberInput[];
}

export interface PartyInput {
  holes: Holes;
  groups: CartGroupInput[];
}

export interface ReturnInput {
  dispatchMemberId: number;
  to: 'member' | 'storage';
  /** Storage tag when an own bag is deposited into storage on return. */
  tag?: string;
  description?: string;
  /** Optional photo of the bag going into storage, as a data: URL. */
  photo?: string | null;
}

export interface Report {
  from: string;
  to: string;
  log: Dispatch[];
  perCaddie: { caddieId: number; name: string; empNo: string; rounds: number; holes: number; designated: number; avgRoundMin: number | null }[];
  perMember: { memberId: number; name: string; memberNo: string; visits: number; avgWaitMin: number | null; maxWaitMin: number | null }[];
  summary: { sessions: number; avgWaitMin: number | null; noShowAlerts: number };
}
