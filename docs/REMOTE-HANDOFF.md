# Continuation checkpoint

The current commit is a static preview, not the completed multiplayer backend.

Implemented: opening character chooser, browser Web Locks for exclusive character claims between tabs of the same browser/origin, manual release, updated room background (computer direction, taller Malla desk and printer), responsive canvas shell. Chat in preview is local to the page and is not persisted or shared. Sprite artwork still needs true four-direction frames; the current sheet has only two rows.

User confirmed: no VPS yet; prepare a local PocketBase backend next. Do not connect the public Pages preview to a localhost API.

## Next work

1. Add pinned PocketBase executable setup, migrations and hooks. SQLite recommendation and primary sources are in `database-decision.md`.
2. Implement atomic character leases with random bearer tokens and 90-second expiry; validate tokens for writes. Do not trust a character ID sent by the client.
3. Implement the API contract used by `lib/office-session.ts`: GET `characters` returns `{characters:[{id,active,x,y,direction,status}]}`; POST `claim` with `{id}` returns `{token}`; POST `release`; POST `heartbeat` with latest position/direction/status; GET `messages` returns `{messages:[{id,name,text,time,sprite}]}`; POST `messages` with `{text}`. All routes are under `/api/office/`, tokens use `X-Office-Session`.
4. Validate length, rate limits, coordinates and directions; retain 200 latest messages. Add concurrency, expiry and unauthorized-write tests. The adapter currently polls at 2 seconds, not realtime movement; add realtime subscriptions/interpolation separately.
5. Configure `public/config.json` only for a reachable, tested backend. An empty `apiUrl` keeps static preview mode. Use private access controls if deployed: choosing a name does not establish identity.
6. Browser QA at desktop and 320px, verify seat/desk alignment, complete directional sprites and avatar customization. No visual browser QA is claimed for this checkpoint.

Build: `npm run build:pages`. Output: `dist-pages`. GitHub Pages workflow deploys pushes to main.
