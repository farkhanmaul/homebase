# Storage decision

SQLite is the small embedded database recommended for this six-person office. PocketBase wraps SQLite with an HTTP API, realtime subscriptions and administration in a single executable. This is a practical operational choice, not a measured claim that PocketBase uses less RAM than every alternative. The PocketBase executable is pinned to 0.40.4 and its SHA-256 is recorded and re-verified on every setup run, so a swapped binary is not trusted.

Sources checked: https://www.sqlite.org/about.html, https://www.sqlite.org/whentouse.html, https://pocketbase.io/docs/, https://pocketbase.io/docs/js-database/, https://pocketbase.io/docs/js-realtime/.

Chat: retain 200 latest messages. Position: keep one latest snapshot per character, not a history row per frame. Broadcast live movement at up to 10 Hz; persist less frequently or when movement stops.

No-login entry still needs a server-issued random session token. Claim a character in an atomic transaction only if its lease has expired. Heartbeat renews the lease; an expired lease is reclaimed after 90 seconds. The 90-second TTL is a fixed constant with no production env override (only a test-only value may shorten it). The server must reject position/chat updates without the matching token, and it authenticates that token before parsing route-specific body fields so anonymous malformed writes get 401 rather than 400. Selecting a name is not proof of identity: anyone who can reach an unprotected website can claim an available character. Use private network access if privacy is required.

GitHub Pages cannot run PocketBase. A deployed API URL on a VPS is required for shared sessions across devices. Local preview may coordinate tabs using browser locks, but must label this limitation.
