# MGC Caddie Dispatch

Caddie dispatching and queue management for Manila Golf Club. Proof of concept.

Three screens share one live board. Every change at one station appears on the others within a second.

| Screen | URL | Who uses it |
| --- | --- | --- |
| Bag Drop | `/bag-drop` | Bag Drop staff (tablet) |
| Caddie House display | `/caddie-house` | TV in the Caddie House. Read-only and silent |
| Caddie Master | `/caddie-master` | Caddie Master (desktop) |

## Run it

Requires Node 22.13 or newer (it uses the built-in SQLite module).

```sh
npm install
npm run build      # build the screens
npm start          # http://localhost:3000
```

Other devices on the same network open `http://<this-computer's-IP>:3000`.

For development with hot reload, run `npm run dev` and open http://localhost:5173.

Demo data loads automatically on first start. To restore it, use **Reset demo data** on the Caddie Master screen, or run `npm run seed`. All names and numbers are fictional samples.

### Docker (cloud or on-premise)

```sh
docker build -t mgc-caddie .
docker run -p 3000:3000 -v mgc-data:/data mgc-caddie
```

The database is a single SQLite file in `/data`. Club time is always Manila time (UTC+8), wherever the server runs.

## How dispatch works

1. **Morning check-in.** Each caddie checks in with the Caddie Master and is given a cart for the day. Check-in order is the starting queue order.
2. **Member arrives at Bag Drop.** Staff look the member up by name or member number, add any playing partners, and record the equipment: brought their own bag, or a bag from storage (by tag).
3. **Caddie is chosen.** There are two ways:
   - **Designated caddie.** The member always gets this caddie, ahead of the queue. Skipped caddies keep their places. If the designated caddie is out on course or not checked in, staff choose **Wait** (the caddie is called automatically when free) or **Next in queue**.
   - **Queue (FIFO).** The caddie first in line is called.
4. **Call.** The Caddie House TV shows the cart number, the caddie, and who they're for. A new call is highlighted in yellow for one minute. There is no sound.
5. **No-show.** If the caddie hasn't reached Bag Drop after 5 minutes, the call turns red at Bag Drop and on the TV. Staff can **Call again** (restarts the timer) or **Give to next in queue** (the missed caddie goes to the back).
6. **Session starts.** Staff press **Caddie arrived** when the caddie takes the bag.
7. **Session ends** when the bag comes back to Bag Drop. Staff record where each bag goes: to the member, or into storage (back to its tag, or a new tag). The caddie goes to the back of the queue. If anyone is waiting for them, they are called straight away.

### Call next / Call next 5

For busy mornings or group arrivals, Bag Drop or the Caddie Master can call caddies before members are assigned. The buttons are at the top of both screens.

- **Call next** calls the first caddie in line. **Call next 5** calls the next five in line order.
- The TV shows them as "For the next member". When one reaches Bag Drop, staff press **Caddie arrived** and the caddie is **standing by**.
- The next member sent out without a designated caddie gets a standing-by caddie first, then one already on the way. Their session starts the moment the bag is handed over.
- If a member's designated caddie was in the batch, the member gets that caddie.
- A caddie who isn't needed can be **sent back to line** and returns to their old place.

A session on course longer than 5 h for 18 holes, or 2 h 30 min for 9 holes, is flagged as overdue. It is never closed automatically.

A party can be one member or a group. Each member with a designated caddie gets that caddie. Members without one share a queue cart, or take separate carts.

## Bag storage and photo proof

Bag Drop → **Bag storage** is the register of stored bags, by tag. A photo records each bag's condition:

- **On deposit:** take a photo in the Deposit a bag form.
- **Back from a round:** when a bag goes back into storage at the end of a session, the return form asks for a photo.
- **Any time:** tap a bag's photo, or **No photo**, in the register to see its full photo history and add a condition check.

On tablets and phones, **Take photo** opens the device's camera app. This works over plain http on the club network. On a computer opened at `localhost` or over https, it shows a live camera view in the page, with **Upload a photo** as a fallback. Photos are resized on the device to about 1280 px (roughly 150–300 KB) before upload. They are stored as files in `photos/` next to the database, which is the `/data` volume in Docker. Photos are optional for now.

## Reports

Found on Caddie Master → Reports, for any date range:

- Daily log: request, call, out and back times for each session
- Rounds per caddie: rounds, holes, designated rounds, and average round length
- Wait per member: from the request at Bag Drop until the caddie arrives

## Demo script

1. Open the TV display on a second screen, and Bag Drop on the laptop or a tablet.
2. **Bag Drop:** type `Clark`, choose **From storage** (S-021), and add `Eduardo` as a partner. The plan shows Juan Dela Cruz skipping the queue for Clark, and the next caddie in line for Eduardo. Press **Call 2 caddies**. Both appear in yellow on the TV.
3. Dindo Mendoza's call has gone unanswered for more than 5 minutes. Show **Give to next in queue**.
4. Patrick Go is waiting for Ernie Valdez, who hasn't checked in yet. On **Caddie Master → Check-in**, check Ernie in. He is called at once.
5. On course, Arnel Reyes is overdue. Press **Bag returned**, then **Back to S-012**, then **Close session**. Arnel moves to the back of the queue on the TV.
6. Press **Call next 5**. Five carts appear on the TV. Mark the first one **Caddie arrived** so they are standing by, then send out a walk-in member. The bag goes straight to the standing-by caddie.
7. **Caddie Master → Reports → Last 7 days.**

## Code map

```
shared/types.ts      types and rules (no-show minutes, overdue limits)
server/engine.ts     dispatch rules: calling, queue, sessions, storage
server/queries.ts    read models: live board, member lookup, reports
server/index.ts      HTTP API and live updates (server-sent events)
server/seed.ts       demo data
src/pages/           Bag Drop, Caddie House display, Caddie Master
```

## Not in the POC yet

- **Membership database:** member lookup is `searchMembers` in `server/queries.ts`. Point it at the club's system.
- **Equipment tracking:** storage is a simple tag register (`storage_items`). The planned AI tracker can write to the same table.
- **Staff sign-in and roles.**
- **Postgres** for multi-server production (the SQL is portable).
