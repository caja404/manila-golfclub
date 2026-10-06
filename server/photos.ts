// Photo proof for stored bags. Images arrive as data: URLs (already downscaled on the device)
// and are written as files next to the database; the table keeps who, what and when.

import { randomUUID } from 'node:crypto';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { get, PHOTO_DIR, run } from './db.ts';
import { RuleError } from './engine.ts';
import type { PhotoKind } from '../shared/types.ts';

const MAX_BYTES = 6 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const CONTENT_TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Decode and check a photo before any database change, so a bad image rejects the whole action. */
export function decodePhoto(dataUrl: unknown): { bytes: Buffer; ext: string } | null {
  if (dataUrl == null || dataUrl === '') return null;
  const m = typeof dataUrl === 'string' ? /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl) : null;
  const ext = m && TYPES[m[1]];
  if (!m || !ext) throw new RuleError('The photo could not be read. Take it again.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_BYTES) throw new RuleError('The photo is too large. Take it again.');
  return { bytes, ext };
}

/** Store a decoded photo against a bag. Call inside the action's transaction. */
export function savePhoto(itemId: number, kind: PhotoKind, photo: { bytes: Buffer; ext: string }, dispatchId: number | null = null) {
  const file = `${randomUUID()}.${photo.ext}`;
  writeFileSync(join(PHOTO_DIR, file), photo.bytes);
  run(
    `INSERT INTO storage_photos (item_id, kind, taken_at, file, dispatch_id) VALUES (?, ?, ?, ?, ?)`,
    itemId,
    kind,
    Date.now(),
    file,
    dispatchId,
  );
}

export function photoFile(id: number): { path: string; type: string } | null {
  const row = get(`SELECT file FROM storage_photos WHERE id = ?`, id);
  if (!row) return null;
  const file = row.file as string;
  return { path: join(PHOTO_DIR, file), type: CONTENT_TYPES[file.split('.').pop()!] ?? 'application/octet-stream' };
}

/** Demo reset: remove every stored photo file. */
export function clearPhotoFiles() {
  for (const f of readdirSync(PHOTO_DIR)) rmSync(join(PHOTO_DIR, f), { force: true });
}
