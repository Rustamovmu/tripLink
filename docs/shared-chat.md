# Shared chat contract — 2026-10-11

One native WebSocket room at `ws(s)://<API host>/chat` for ACTIVE USER, AGENT and ADMIN accounts. No GraphQL/schema/database migration. Sender identities expose only `_id`, `memberNick`, `memberType`; all are derived from current-account authentication. The frontend labels these Traveler, Agent and Admin and uses initials. ADMIN has no public-profile link.

## Frames and limits

Every frame is JSON `{ "event": "...", "data": ... }`. Authenticate with a raw access token within 10 seconds; wait for `authenticated` before any other command.

Client commands:

```json
{"event":"authenticate","data":{"token":"<local disposable-fixture access token>"}}
{"event":"message","data":"Hello travel group!"}
{"event":"getMessages","data":{}}
{"event":"typing","data":{"isTyping":true}}
{"event":"typing","data":{"isTyping":false}}
```

- `authenticated`: `{ memberData: ChatMember, totalClients: number }`.
- `getMessages`: `{ list: ChatMessage[] }`, latest 50 in chronological room order. Each message is `{ _id: UUID, text: string, createdAt: ISO string, memberData: ChatMember }`.
- `message`: the same `ChatMessage`, broadcast to sender and other authenticated participants.
- `presence`: `{ list: ChatMember[], totalMembers: number, totalClients: number }`. Complete snapshots after authentication/join, departure and revoked-client removal. Members deduplicate by ID; two tabs count as one person and two connections. Snapshots are scoped to this server process, sorted by nickname then ID.
- `typing`: `{ memberData: ChatMember, isTyping: boolean }`. Refreshes throttled per connection to once every 2 seconds, with immediate stop allowed. Tabs aggregate by account: one tab stopping/closing cannot clear another tab's active typing. Refresh expires after 5 seconds; the frontend stops after 3 seconds idle and also clears remote indicators after 5 seconds.
- `info`: existing `{ action: "joined" | "left", memberData, totalClients }`, preserved for compatibility. Counts describe connections, not distinct people.
- `error`: `{ code, message }` with BAD_REQUEST, UNAUTHENTICATED, FORBIDDEN, INTERNAL_SERVER_ERROR or TOO_MANY_REQUESTS.

Messages remain plain text, trimmed to 1–1000 JavaScript string characters (UTF-16 code units). Incoming frames remain limited to 8192 bytes with at most 20 queued commands per connection. Typing data accepts exactly one boolean `isTyping`; sender IDs/roles cannot be supplied. Current account role/status is revalidated on every command and before broadcasts. Credential failures close the socket; the frontend never automatically retries them. Timers, presence and socket references clear on disconnect/logout/account changes/shutdown.

History lives only in this process, disappears on restart and is not shared across server instances. Multiple instances would require shared state before room-wide presence could be promised. Older clients ignore the new events, while new clients and server should be released together for presence/typing. No private conversations, permanent storage, attachments, notifications or read receipts are added.

## Postman WebSocket verification

These are manual recipes, not saved/live Postman examples. Prerequisite: a dedicated test server connected to a uniquely named disposable database, with ACTIVE USER, AGENT and ADMIN fixtures. Use `apps/trip-link/test/socket.e2e-spec.ts` as the fixture/cleanup reference; never promote or disable a development account. Keep tokens only in local Postman environment values, never in saved request/response examples. If port 3007 belongs to the existing server, start the test server on a free port and substitute that port below.

1. Create three Postman WebSocket requests to `ws://localhost:3007/chat` (or the test port). Connect and immediately send the authenticate JSON above with each fixture's token. Expect authenticated, history, joined info and a presence snapshot. Across USER/AGENT/ADMIN, expect `totalMembers: 3` and `totalClients: 3`. Confirm that identities have only the three public fields.
2. Connect a second USER tab/request. Expect `totalMembers: 3`, `totalClients: 4`, and no duplicate roster ID. Close it; expect three connections and the USER still present.
3. Reconnect/authenticate the second USER request. Send `typing:true` from both USER connections before closing one. Other accounts should still see that USER typing. Stop the remaining tab or leave it idle for 5 seconds: expect `typing:false`. Immediate repeated true refreshes produce no extra broadcast.
4. Send the plain-text message command. All authenticated clients, including sender, receive the same stable ID/time/identity. Send 55 uniquely numbered messages sequentially, waiting for each echo to avoid the flood guard. Request history: expect exactly the last 50 in order. Disconnect/reconnect and authenticate again: expect the same retained history. Restart only the test server: expect empty history.
5. Send `{"event":"typing","data":{"isTyping":true,"memberId":"spoof"}}`, a non-boolean typing value, whitespace-only text, or 1001-character text. Expect BAD_REQUEST with unchanged history. A forged sender object is also rejected.
6. Connect without authentication and request history: expect UNAUTHENTICATED, close code 1008 and no room data. Repeat with an invalid/expired token. Disable or change a disposable fixture's role only in the disposable database: its next command or broadcast validation rejects it with FORBIDDEN/UNAUTHENTICATED and removes its presence.
7. Close all fixture clients. Verify the exact disposable database name before dropping it; close the test app and restore test environment values. Leave existing development accounts, server, files and counters untouched.

## Validation record

- Socket unit suites: 16 tests passed.
- Real WebSocket integration suite: 18 tests passed with a uniquely named disposable database, ephemeral port and cleanup.
- Backend non-writing typecheck and focused non-fixing lint passed.
- Frontend full suite: 49 tests passed, including six chat tests using mocked WebSocket/MUI boundaries and real React state. Frontend typecheck and focused lint recorded in the completion log.
- Browser review uses read-only room access; no development messages are sent as fixtures. Native mobile-keyboard behavior requires a physical-device check.
