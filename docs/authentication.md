# Authentication upgrade — 2026-10-13

TripLink keeps its NestJS/GraphQL/Apollo architecture and USER, AGENT and ADMIN roles. Login/signup still return `AuthPayload { accessToken, member }`; the refresh credential is delivered only as an HTTP-only cookie. New REST endpoints live under `/auth`. Existing booking, tour, upload, community, shared-chat and Gemini operations retain their business rules.

## Lifecycle and storage

Access JWTs expire after 15 minutes. Refresh JWTs rotate on demand and expire seven days after the latest successful rotation, clipped to a fixed 30-day session deadline established at login/signup. Ordinary requests and idle tabs do not extend sessions. Each login creates an independent session; tabs sharing a browser cookie share that session. Other devices keep independent sessions.

Access JWTs carry `sub`, `sid`, `type: access`, current role/nickname and timestamps. Refresh JWTs carry `sub`, `sid`, `type: refresh`, a random `jti` and timestamps. HS256 verification uses distinct secrets and rejects token-type substitution. Every protected request and authenticated socket command/broadcast checks the database session and current account status/role. Revocation takes effect at the next protected request/frame; it cannot cancel an already executing operation. Password changes retain the current session and revoke the account's other existing sessions.

`refreshSessions` stores member/session identity, role, SHA-256 refresh hash, random token/family identifiers, issuance/sliding/absolute timestamps, revocation and last-use timestamps, bounded sanitized user-agent and inferred device name. Credential fields are excluded from ordinary selections. Session listings expose only owned display information. No raw refresh JWT is stored. `lastUsedAt` changes on creation/refresh, avoiding an activity write on every API request.

Rotation uses a MongoDB compare-and-swap update on the current token hash and active deadlines. An unrelated reused credential revokes its session/family. A bounded 30-second retry with the same hashed refresh-operation UUID can recover the identical rotated credential after a lost response; it does not perform another rotation or extend expiry. The previous hash, request-ID hash and retry deadline are retained only for this recovery. A stolen credential together with the same operation identifier during this narrow window is indistinguishable from a retry; the identifier must not be treated as an independent security factor.

The frontend holds access credentials only in memory. It removes the old `localStorage.accessToken`. Local storage contains only authentication-version and pending-operation metadata. BroadcastChannel communicates short-lived access credentials between same-origin tabs in memory. Web Locks serialize cookie-changing requests; a SharedWorker queue supplies a fallback when Web Locks are unavailable. Worker request/commit acknowledgements and network timeouts prevent a crashed tab from blocking the queue indefinitely. Browsers unable to coordinate safely show a recoverable compatibility error. Cookie restoration runs on application bootstrap and protected activity, with one shared in-flight refresh per tab; there is no refresh interval or idle polling. A short peer-response wait at lock handoff and a 25-second in-memory memo of a newly published, still-fresh access credential coalesce late expiry responses with the completed renewal. Only non-credential operation metadata persists for bounded retry recovery. Queued logout/session requests from a superseded authentication version are rejected before they can change a newer login cookie. Expired GraphQL/upload/session operations are not retried under a different signed-in session.

Apollo keeps operation variables/context/headers/cancellation, refreshes once on an explicit `ACCESS_TOKEN_EXPIRED` result, and retries only when no root field succeeded. Permission and credential-form errors do not trigger refresh. Uploads retain multipart transport. Chat reauthenticates the existing connection after access renewal, preserving the same-session draft/history; Gemini retains same-session conversation context. Account/session changes clear private state.

## Configuration and deployment

See [the environment template](../.env.example). Required secrets are `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`: distinct random values of at least 32 characters. The optional lifetime settings accept exactly `15m`, `7d`, `30d`. The ignored local backend `.env` was configured with generated separate keys; values were not committed or included in reports. Legacy access tokens are rejected; existing users sign in once. Members, passwords, roles and business records require no migration.

- `FRONTEND_ORIGINS`: comma-separated exact origins. Development defaults to `http://localhost:3000`; production requires an explicit HTTPS allowlist.
- `AUTH_COOKIE_SECURE`: optional in development; production always enables Secure.
- `AUTH_COOKIE_SAME_SITE`: `lax` by default; `strict` or `none` are supported. `none` requires Secure. Different ports on localhost are same-site. A truly cross-site production frontend requires HTTPS/None and is still subject to browser third-party-cookie restrictions; same-site hosting is preferable.
- `AUTH_TRUST_PROXY_HOPS`: 0 by default, integer 0–5. Set only for a fixed known reverse-proxy topology; client-supplied forwarded addresses are not trusted by default.
- Frontend uses its existing `REACT_APP_API_URL` and `REACT_APP_API_GRAPHQL_URL`, defaulting to localhost:3007 and localhost:3007/graphql. Production frontend/API addresses remain undecided and must be supplied before deployment.

The host-only refresh cookie is `triplink_refresh` in insecure local development or `__Secure-triplink_refresh` when Secure, HTTP-only, `Path=/auth`, persistent with matching Max-Age/Expires, and clipped to the database deadline. Logout clears the same cookie attributes. Refresh responses use no-store. Failed stale refresh requests do not erase a potentially newer cookie; definitive failures clear client state.

Signup/login and cookie-changing REST requests require an allowlisted `Origin` plus `X-TripLink-Auth: 1`. Credentialed CORS permits only explicit origins and required headers/methods. GraphQL ordinary operations use bearer tokens without cookies. Atomic shared MongoDB rate buckets limit signup/login to 30 per IP/minute and 10 per normalized nickname/15 minutes; refresh/logout to 120 per IP/minute. Rate exhaustion returns 429/`AUTH_RATE_LIMITED` and preserves authentication state. Logout-all/session deletion remain authenticated and ownership-scoped.

MongoDB indexes are additive: `refreshSessions(memberId, revokedAt, expiresAt)`, TTL on `absoluteExpiresAt`, and `authRateLimits` TTL on `expiresAt`. TTL cleanup is asynchronous; authorization explicitly checks deadlines and never depends on deletion. No SQL or member data migration exists. Before production rollout, run from the backend root with the intended private database configuration:

```sh
node scripts/auth-session-indexes.cjs
```

This script creates indexes only; it never drops indexes/collections or updates members. It was not run against the development or production database during this task. Test applications initialized indexes in their disposable databases.

## API and Postman recipes

These are exact reusable request recipes, not saved Postman live examples. Automated integration tests sent real HTTP/WebSocket requests against uniquely named disposable databases. No Postman collection was created or changed.

Use a dedicated test backend/database and cookie jar. Never change development members to simulate expiry, blocked accounts, roles or replay. Headers for login/signup: `Content-Type: application/json`, `Origin: http://localhost:3000`, `X-TripLink-Auth: 1`, `Apollo-Require-Preflight: true`. No bearer token is needed. Endpoint: `POST http://localhost:3007/graphql`.

```graphql
mutation Login($input: LoginInput!) {
  login(input: $input) { accessToken member { _id memberNick memberType } }
}
```

Exact Variables JSON (replace with a disposable account):

```json
{"input":{"memberNick":"auth_demo_user","memberPassword":"DisposableAuth123!"}}
```

```graphql
mutation Signup($input: MemberInput!) {
  signup(input: $input) { accessToken member { _id memberNick memberType } }
}
```

```json
{"input":{"memberNick":"auth_demo_user","memberPassword":"DisposableAuth123!","memberType":"USER","memberAuthType":"PHONE","memberPhone":"01012345678"}}
```

Use a separate nickname for AGENT signup. ADMIN public signup is forbidden; provision an ADMIN only in the disposable fixture database using the existing test setup. Success returns GraphQL data and sets the refresh cookie, without a refreshToken JSON field. Invalid credentials/input, disabled accounts and public ADMIN signup return GraphQL errors. Inspect `errors` even for HTTP 200. Omit/alter Origin or the custom header to verify CSRF rejection; restore them before further requests.

Protected GraphQL smoke check, all active roles, `Authorization: Bearer <accessToken>`:

```graphql
query CurrentMember { getCurrentMember { _id memberNick memberType memberStatus } }
```

Variables: `{}`. Success returns the current member. Revoked/expired sessions return `UNAUTHENTICATED` with a typed `extensions.authCode`; disabled accounts return `FORBIDDEN`/`ACCOUNT_UNAVAILABLE`. Role denial stays `FORBIDDEN` and does not renew tokens. Existing role-specific tour/booking/admin recipes remain in [backend acceptance](backend-acceptance.md).

| Request | Required state/headers | Expected result |
| --- | --- | --- |
| `POST /auth/refresh` | Cookie jar from login, Origin, X-TripLink-Auth, `X-Refresh-Request-Id: <fresh UUID>`; no bearer required | 201 with only accessToken; rotated cookie and sliding deadline |
| `GET /auth/sessions` | Active USER/AGENT/ADMIN bearer | 200 owned active array: id/deviceName/userAgent/lastUsedAt/createdAt/isCurrentSession; no credential hashes/identifiers |
| `DELETE /auth/sessions/<owned id>` | Active bearer, Origin and X-TripLink-Auth | 200 `{success:true}`; next use of target access token fails; current-target deletion clears cookie |
| `DELETE /auth/sessions/<foreign valid id>` | Same headers, other account's disposable session ID | 200 `{success:false}` without changing foreign session |
| `POST /auth/logout` | Cookie jar, Origin and X-TripLink-Auth; access may be expired | 201 `{success:true}`, current session revoked/cookie cleared; other devices stay active |
| `POST /auth/logout-all` | Active bearer, Origin and X-TripLink-Auth | 201 `{success:true}`, all owned sessions revoked/cookie cleared |

REST requests require no GraphQL operation/Variables/body. An invalid ID is 400. Missing/expired refresh cookies yield 401; disallowed Origin/header yields 403. Reusing the exact operation UUID and preceding credential within 30 seconds returns the same rotated credential; reuse with a fresh UUID returns 401 `REFRESH_TOKEN_REUSED` and revokes that session. For this test, retain credentials only in the disposable cookie jar, clear them afterward, and do not save credential-bearing responses as shared examples.

For independent-device testing use two separate Postman cookie jars/browser contexts for the same disposable account. Revoke one session; verify the other still reaches CurrentMember. Logout-all must reject both previously issued bearer tokens. Browser tabs use one shared jar; simultaneous protected work should coalesce refresh, remain idle without polling, restore after reload/browser restart, and synchronize login/logout. Session UI shows device/browser, localized last-used time and current-device indicator, with confirmations and error recovery for all roles.

For time/replay/status fault injection use the dedicated integration fixture suite, not production/dev records. After recording results, close clients, verify the exact unique disposable database name, drop only that database, remove its temporary uploads, stop only its test server, and clear cookie jars/access variables. Existing servers and development records remain untouched.

## Validation and practical limits

Executed during this upgrade:

- Frontend: 93 tests; typecheck; focused non-fixing lint; GraphQL validation of 63 documents and 15 variable fixtures with zero errors.
- Backend: 141 unit tests in 16 suites, 203 API integration tests in 16 suites, and 17 batch integration tests in three suites. Non-writing typecheck and non-fixing lint accompany the changes.
- Integration coverage includes access/refresh typing, rotation/CAS races, retry/replay, sliding/absolute deadlines, account status/role checks, ownership, multiple devices, logout/all, cookies/CSRF/CORS/rate limits, uploads, tours/bookings, shared sockets and Gemini integration with a controlled provider.
- Isolated Chrome/Playwright checks verified HTTP-only/persistent cookie attributes, absence of localStorage credentials, peer-tab restore/no idle requests, one actual refresh for simultaneous expired tabs, device isolation, confirmation cancellation/revocation, reload/new-context restoration, logout-all, and USER/AGENT/ADMIN session controls. The final seven-check browser run also verified real SharedWorker fallback login and second-tab restoration with Web Locks disabled; its page-error report was empty.
- Desktop (1440px) and emulated mobile (390px) session captures and the confirmation dialog were reviewed. The reviewer requested selected-session detail and truthful failed-load state; both were implemented with UI regression coverage.

This is local automated/browser acceptance, not production deployment, a load test or live Gemini-provider verification. Physical mobile devices, Safari, Firefox, inaccessible storage modes and every proxy deployment were not exercised. Same-origin injected JavaScript can read an in-memory access token; HTTP-only refresh protection does not replace XSS prevention. Multiple devices require separate cookie jars, and closing an ordinary browser window does not revoke a persistent cookie session.

## Files and follow-up

The following manifest records this upgrade's exact frontend/backend source, tests and documentation. Private `.env` is listed separately and excluded from Git. No commit was created. Suggested commits: backend `feat(auth): add rotating database-backed device sessions`; frontend `feat(auth): add coordinated refresh and session management`.

Next backend task: choose production HTTPS origins/proxy topology and verify cookie behavior in the target hosting environment before rollout. Production index execution and live Postman example saving were not performed.

The UI finish reviewer scored both requested fixes resolved (`ship`, at that verdict-pass scope). The fresh read-only documenter compared the ordinary extension with existing workspace styles and screenshots: no design-artifact changes were warranted. Existing global MUI red/Roboto versus locally scoped teal/Jakarta controls remain pre-existing theme drift; no theme rewrite was performed.

An intermediate repeated API run reported one article ownership assertion failure (202/203 passed); its fresh isolated 12-test rerun and subsequent full 203-test rerun passed. This history is retained rather than treating every attempted run as successful.

### Exact changed/new file manifest

Backend:

- `.env.example`
- `apps/batch/test/app.e2e-spec.ts`
- `apps/batch/test/booking-expiry.e2e-spec.ts`
- `apps/batch/test/ranking.e2e-spec.ts`
- `apps/trip-link/src/app.module.ts`
- `apps/trip-link/src/components/auth/auth-cookie.service.ts`
- `apps/trip-link/src/components/auth/auth-rate-limit.service.ts`
- `apps/trip-link/src/components/auth/auth-session.service.ts`
- `apps/trip-link/src/components/auth/auth.config.ts`
- `apps/trip-link/src/components/auth/auth.controller.ts`
- `apps/trip-link/src/components/auth/auth.module.ts`
- `apps/trip-link/src/components/auth/auth.service.spec.ts`
- `apps/trip-link/src/components/auth/auth.service.ts`
- `apps/trip-link/src/components/auth/decorators/auth-member.decorator.ts`
- `apps/trip-link/src/components/auth/guards/auth-entry.guard.ts`
- `apps/trip-link/src/components/auth/guards/auth.guard.ts`
- `apps/trip-link/src/components/auth/token.service.spec.ts`
- `apps/trip-link/src/components/auth/token.service.ts`
- `apps/trip-link/src/components/member/member.resolver.ts`
- `apps/trip-link/src/components/member/member.service.ts`
- `apps/trip-link/src/libs/utils/graphql-error.spec.ts`
- `apps/trip-link/src/libs/utils/graphql-error.ts`
- `apps/trip-link/src/main.ts`
- `apps/trip-link/src/schemas/AuthRateLimit.model.ts`
- `apps/trip-link/src/schemas/RefreshSession.model.ts`
- `apps/trip-link/src/socket/socket.gateway.spec.ts`
- `apps/trip-link/src/socket/socket.gateway.ts`
- `apps/trip-link/src/socket/socket.types.ts`
- `apps/trip-link/test/agent-profile.e2e-spec.ts`
- `apps/trip-link/test/ai.e2e-spec.ts`
- `apps/trip-link/test/app.e2e-spec.ts`
- `apps/trip-link/test/auth-test-support.ts`
- `apps/trip-link/test/auth.e2e-spec.ts`
- `apps/trip-link/test/board-article.e2e-spec.ts`
- `apps/trip-link/test/booking.e2e-spec.ts`
- `apps/trip-link/test/comment.e2e-spec.ts`
- `apps/trip-link/test/follow.e2e-spec.ts`
- `apps/trip-link/test/help-center.e2e-spec.ts`
- `apps/trip-link/test/ranking.e2e-spec.ts`
- `apps/trip-link/test/refresh-session.e2e-spec.ts`
- `apps/trip-link/test/review.e2e-spec.ts`
- `apps/trip-link/test/socket.e2e-spec.ts`
- `apps/trip-link/test/tour-interactions.e2e-spec.ts`
- `apps/trip-link/test/tour.e2e-spec.ts`
- `apps/trip-link/test/upload.e2e-spec.ts`
- `docs/COMPLETED_TASKS.md`
- `docs/authentication.md`
- `docs/backend-acceptance.md`
- `scripts/auth-session-indexes.cjs`

Frontend:

- `apollo/client.ts`
- `apollo/store.ts`
- `libs/auth/index.ts`
- `libs/auth/runtime.ts`
- `libs/auth/token.ts`
- `libs/components/AiAssistant.tsx`
- `libs/components/Chat.tsx`
- `libs/components/Top.tsx`
- `libs/components/layout/LayoutAdmin.tsx`
- `libs/components/triplink/ActiveSessions.tsx`
- `libs/components/triplink/Session.tsx`
- `libs/components/triplink/Workspace.tsx`
- `libs/triplink/useAiAssistant.ts`
- `libs/triplink/useChat.ts`
- `libs/uploads/index.ts`
- `public/locales/en/common.json`
- `public/locales/kr/common.json`
- `public/locales/ru/common.json`
- `public/triplink-auth-worker.js`
- `scss/triplink.scss`
- `tests/ai-assistant.test.cjs`
- `tests/auth-refresh.test.cjs`
- `tests/auth-sessions-ui.test.cjs`
- `tests/chat.test.cjs`
- `tests/migration.test.cjs`
- `tests/workspace-profile.test.cjs`

Private configuration: backend `.env` (ignored; only separate generated JWT keys were added, with no values published).

### Reproducible checks and local evidence

Run frontend commands with Yarn from `tripLInk-next`:

```sh
yarn typecheck
yarn test
yarn validate:contracts
```

From the backend root, typecheck without generated build metadata and run non-fixing lint:

```sh
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/eslint 'apps/**/*.ts'
node -r dotenv/config ./node_modules/jest/bin/jest.js --runInBand --silent
node -r dotenv/config ./node_modules/jest/bin/jest.js --config ./apps/trip-link/test/jest-e2e.json --runInBand --silent
node -r dotenv/config ./node_modules/jest/bin/jest.js --config ./apps/batch/test/jest-e2e.json --runInBand --silent
```

Integration suites require the configured private MongoDB connection and create/drop only their verified dedicated databases. Do not run them with NODE_ENV=production. Temporary task evidence: `/private/tmp/triplink-auth-unit-final.log`, `triplink-auth-full-api-final.log`, `triplink-auth-batch.log`, `triplink-auth-frontend-final.log`, `triplink-auth-contracts-final.log`, and `/private/tmp/triplink-auth-captures/final-report.json`. These local artifacts are not permanent repository fixtures. The final browser report records seven passing checks and no page errors. Final fixture audit is `/private/tmp/triplink-auth-orphan-audit-final.json`; task-owned backend/browser processes were closed, leaving the user's existing servers running.


## Unified account security update — 2026-10-13

[Account security implementation and deployment guide](account-security.md) supersedes earlier signup/password-policy details: new public accounts are USER-only, phone/email are optional, new passwords use Argon2id, bcrypt verification is retained, and explicit Google/Telegram/Kakao identity linking plus recovery are available behind configuration. Existing GraphQL contracts, session rotation and authorization remain. Real providers/SMTP and production acceptance are pending the documented setup and dependency remediation.
