import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ServerResponse } from 'node:http';
import * as engine from './engine.ts';
import { listDesignations, listPhotos, listStorage, report, searchMembers, snapshot } from './queries.ts';
import { photoFile } from './photos.ts';
import { createReadStream, existsSync as fileExists } from 'node:fs';
import { ensureSeeded, resetDemo } from './seed.ts';
import { addDays, clubDate } from './time.ts';
import type { PartyInput, ReturnInput } from '../shared/types.ts';

ensureSeeded();
engine.expireStaleCalls();

const app = Fastify({ logger: { level: 'warn' } });

/** Room for one downscaled photo sent as a data: URL. */
const PHOTO_BODY_LIMIT = 10 * 1024 * 1024;

// ---- Live updates: every screen holds one SSE connection and receives the full board on each change ----

const clients = new Set<ServerResponse>();

function broadcast() {
  const data = `event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(data);
}

app.get('/api/stream', (req, reply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 2000\nevent: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
  clients.add(res);
  req.raw.on('close', () => clients.delete(res));
});

// Heartbeat keeps proxies from closing idle streams; a fresh snapshot also rolls the board over at midnight,
// when calls nobody answered yesterday are cleared.
setInterval(() => {
  engine.expireStaleCalls();
  broadcast();
}, 30_000);

/** Wrap a mutation: run it, push the new board to every screen, return ok. */
function mutation<T>(fn: (body: any, params: any) => T) {
  return async (req: any) => {
    const result = fn(req.body ?? {}, req.params ?? {});
    broadcast();
    return { ok: true, result: result ?? null };
  };
}

app.setErrorHandler((err: any, _req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  reply.status(status).send({ error: err.message ?? 'Something went wrong.' });
});

app.get('/api/snapshot', async () => snapshot());

app.get('/api/members', async (req: any) => searchMembers(String(req.query.q ?? '')));
app.get('/api/designations', async () => listDesignations());
app.get('/api/storage', async (req: any) => listStorage(req.query.memberId ? Number(req.query.memberId) : undefined));

app.get('/api/reports', async (req: any) => {
  const to = String(req.query.to ?? clubDate());
  const from = String(req.query.from ?? addDays(to, 0));
  return report(from, to);
});

// Caddie Master
app.post('/api/shifts', mutation((b) => engine.checkIn(Number(b.caddieId), Number(b.cartId))));
app.post('/api/shifts/:id/status', mutation((b, p) => engine.setShiftStatus(Number(p.id), b.status)));
app.post('/api/shifts/:id/move', mutation((b, p) => engine.moveInQueue(Number(p.id), b.direction)));
app.post(
  '/api/members/:id/designated',
  mutation((b, p) => engine.setDesignatedCaddie(Number(p.id), b.caddieId ? Number(b.caddieId) : null)),
);

// Bag Drop
app.post('/api/parties', mutation((b) => engine.createParty(b as PartyInput)));
app.post('/api/call-next', mutation((b) => engine.callNext(Number(b.count ?? 1))));
app.post('/api/dispatches/:id/arrived', mutation((_b, p) => engine.markArrived(Number(p.id))));
app.post('/api/dispatches/:id/recall', mutation((_b, p) => engine.recall(Number(p.id))));
app.post('/api/dispatches/:id/pass', mutation((_b, p) => engine.passToNext(Number(p.id))));
app.post('/api/dispatches/:id/queue', mutation((_b, p) => engine.switchToQueue(Number(p.id))));
app.post('/api/dispatches/:id/cancel', mutation((_b, p) => engine.cancelDispatch(Number(p.id))));
app.post(
  '/api/dispatches/:id/end',
  { bodyLimit: PHOTO_BODY_LIMIT * 4 },
  mutation((b, p) => engine.endSession(Number(p.id), (b.returns ?? []) as ReturnInput[])),
);
app.post(
  '/api/storage',
  { bodyLimit: PHOTO_BODY_LIMIT },
  mutation((b) => engine.depositBag(Number(b.memberId), String(b.tag ?? ''), String(b.description ?? ''), b.photo)),
);
app.post('/api/storage/:id/photos', { bodyLimit: PHOTO_BODY_LIMIT }, mutation((b, p) => engine.addStoragePhoto(Number(p.id), b.photo)));
app.get('/api/storage/:id/photos', async (req: any) => listPhotos(Number(req.params.id)));
app.get('/api/photos/:id', async (req: any, reply) => {
  const f = photoFile(Number(req.params.id));
  if (!f || !fileExists(f.path)) return reply.status(404).send({ error: 'Photo not found.' });
  // Photos never change once taken.
  return reply.type(f.type).header('Cache-Control', 'private, max-age=31536000, immutable').send(createReadStream(f.path));
});
app.post('/api/storage/:id/withdraw', mutation((_b, p) => engine.withdrawBag(Number(p.id))));

app.post('/api/admin/reset-demo', mutation(() => resetDemo()));

// Built screens (production). In development Vite serves them and proxies /api here.
const webRoot = resolve('dist/web');
if (existsSync(resolve(webRoot, 'index.html'))) {
  await app.register(fastifyStatic, { root: webRoot });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Not found.' });
    return reply.sendFile('index.html');
  });
}

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`MGC Caddie Dispatch API on http://localhost:${port}`);
