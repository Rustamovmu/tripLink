# TripLink authentication and account security — implementation report

Implementation date: 2026-10-13. The requested full-stack code is integrated with the existing architecture. Production acceptance remains conditional on provider/SMTP credentials, deployment configuration, dependency remediation, and the live checks listed below. No real provider sign-in or email delivery is claimed.

## A. Existing architecture and compatibility

Frontend: Next.js 14 Pages Router, React 18, TypeScript, MUI 5, SCSS, next-i18next (English/Korean/Russian), Apollo 3. Existing GraphQL signup/login/profile mutations, memory-only access token runtime, HttpOnly refresh cookie, protected navigation, cross-tab coordination and session UI are retained.

Backend: NestJS 10 monorepo, GraphQL/Apollo and REST, Mongoose 8/MongoDB transactions, bcrypt credentials, role guards and current-account checks. Existing Member ObjectId, memberNick, memberPassword and USER/AGENT/ADMIN remain authoritative. Provider identities reference the existing member ID; bookings, reviews, favorites, followers, tours and chat relationships are unchanged.

Read-only development audit found 15 members, all using bcrypt, no populated email addresses and no case-insensitive username conflicts. Member records were not rewritten. New public signup is USER-only; existing AGENT and ADMIN members retain their roles. A caller must not depend on public signup to create an agent; provisioning remains an authorized administration operation.

## B–C. Exact file manifest

Paths are relative to their repository. No commits were created.

### Backend — created

- `apps/trip-link/src/components/auth/account-policy.spec.ts`
- `apps/trip-link/src/components/auth/account-policy.ts`
- `apps/trip-link/src/components/auth/account-security.controller.ts`
- `apps/trip-link/src/components/auth/account-security.service.ts`
- `apps/trip-link/src/components/auth/auth-records.service.ts`
- `apps/trip-link/src/components/auth/oidc-provider.service.spec.ts`
- `apps/trip-link/src/components/auth/oidc-provider.service.ts`
- `apps/trip-link/src/components/auth/social-auth.service.ts`
- `apps/trip-link/src/schemas/AuthEvent.model.ts`
- `apps/trip-link/src/schemas/AuthIdentity.model.ts`
- `apps/trip-link/src/schemas/AuthSecurity.model.ts`
- `apps/trip-link/src/schemas/AuthTransaction.model.ts`
- `apps/trip-link/test/account-security.e2e-spec.ts`
- `scripts/auth-account-indexes.cjs`
- `docs/account-security.md`

### Backend — modified

- `.env.example`
- `apps/trip-link/src/components/auth/auth-session.service.ts`
- `apps/trip-link/src/components/auth/auth.config.ts`
- `apps/trip-link/src/components/auth/auth.module.ts`
- `apps/trip-link/src/components/auth/auth.service.spec.ts`
- `apps/trip-link/src/components/auth/auth.service.ts`
- `apps/trip-link/src/components/auth/token.service.spec.ts`
- `apps/trip-link/src/components/auth/token.service.ts`
- `apps/trip-link/src/components/member/member.service.ts`
- `apps/trip-link/src/libs/dto/member/member.input.ts`
- `apps/trip-link/src/libs/dto/member/member.update.ts`
- `apps/trip-link/src/schemas/Member.model.ts`
- `apps/trip-link/src/schemas/RefreshSession.model.ts`
- `apps/trip-link/test/agent-profile.e2e-spec.ts`
- `apps/trip-link/test/auth.e2e-spec.ts`
- `apps/trip-link/test/booking.e2e-spec.ts`
- `apps/trip-link/test/follow.e2e-spec.ts`
- `apps/trip-link/test/refresh-session.e2e-spec.ts`
- `apps/trip-link/test/socket.e2e-spec.ts`
- `package-lock.json`
- `package.json`
- `docs/authentication.md`
- `docs/backend-acceptance.md`
- `docs/COMPLETED_TASKS.md`

### Frontend — created

- `libs/auth/security.ts`
- `libs/components/triplink/AccountRecovery.tsx`
- `libs/components/triplink/ProviderButtons.tsx`
- `libs/components/triplink/SecuritySettings.tsx`
- `libs/components/triplink/SocialAccount.tsx`
- `pages/account/complete.tsx`
- `pages/account/onboarding.tsx`
- `pages/account/recovery.tsx`
- `tests/security-auth.test.cjs`

### Frontend — modified

- `libs/auth/index.ts`
- `libs/auth/returnUrl.ts`
- `libs/auth/runtime.ts`
- `libs/components/triplink/ActiveSessions.tsx`
- `libs/components/triplink/Join.tsx`
- `libs/components/triplink/Members.tsx`
- `libs/components/triplink/Workspace.tsx`
- `libs/types/triplink/index.ts`
- `public/locales/en/common.json`
- `public/locales/kr/common.json`
- `public/locales/ru/common.json`
- `scss/triplink.scss`
- `tests/profile-connections.test.cjs`
- `tests/workspace-profile.test.cjs`


Backend dependencies added: argon2 0.45.1, jose 5.10.0, nodemailer 10.1.0, development types @types/nodemailer 8.0.2. Existing locked package versions were preserved. Frontend dependencies were unchanged. Browser review captures are task evidence under frontend `.impeccable/review/auth/` and are not application runtime dependencies.

## D. Additive database changes

- Member: optional memberPassword permits social-only accounts; hidden authVersion defaults to zero. Existing fields, IDs and role values remain. New memberNick case-insensitive unique index uses `{locale:'en', strength:2}`; existing exact index remains.
- authIdentities: unique `(provider, providerUserId)` and `(memberId, provider)`, indexed memberId. Provider subject is excluded from ordinary selection. A subject cannot belong to two members; each member has at most one identity per provider.
- authSecurity: unique memberId; hidden recoveryEmail and recoveryCodeHashes; partial unique verified recoveryEmail; revision serializes sensitive credential operations. Unverified profile email is never eligible for recovery.
- authTransactions: hashed opaque ID, kind, browser binding and AES-256-GCM encrypted short-lived payload. Expiration TTL plus explicit expiry/consumed checks. Raw state, reset/verification tickets, PKCE verifier and raw recovery codes are not stored in plaintext.
- authEvents: safe action/provider/member references with 90-day TTL. No passwords, tokens, recovery codes or provider secrets are logged.
- refreshSessions: authVersion and lastAuthenticatedAt added; legacy absent versions read as zero. Existing expiration and rotation fields remain.

MongoDB must support transactions (replica set/Atlas). Sensitive transactions update the same authSecurity revision document to serialize concurrent unlink, password and recovery operations. TTL cleanup is asynchronous; authorization always checks expiry directly.

## E. Endpoints and request contracts

The existing GraphQL endpoint `/graphql` remains the primary member API. `signup(input: MemberInput!)`, `login(input: LoginInput!)`, `updateMember(input: MemberUpdate!)`, current-member queries and existing authorization remain. Signup needs memberNick/memberPassword only; memberFullname/memberEmail are optional and memberType can only be USER. memberPhone is optional compatibility input and has no authentication purpose. Existing email/password login is retained through the identifier field.

REST additions use JSON bodies. All state-changing browser requests require an allowlisted Origin, `X-TripLink-Auth: 1`, and credentials included. Authenticated requests additionally require `Authorization: Bearer <memory access token>`. Read-onboarding also checks browser headers. No provider/JWT credentials belong in URL parameters. Provider callback code/state are standard OAuth inputs; frontend callbacks contain no JWT.

| Method/path | Body | Authentication / behavior |
| --- | --- | --- |
| GET /auth/providers | — | Public enabled provider names; disabled providers omitted |
| POST /auth/oauth/:provider/start | `{intent: LOGIN\|LINK\|REAUTH, returnTo?: string}` | LOGIN public; LINK/REAUTH require active session; LINK recent authentication |
| GET /auth/oauth/:provider/callback | OAuth query code/state or error | Consumes one browser-bound transaction; redirects safely |
| POST /auth/social/finish | `{}` | Consumes HttpOnly one-time login ticket; issues usual session through cross-tab cookie lock |
| GET /auth/social/onboarding | — | Browser-bound pending ticket; safe profile suggestion |
| POST /auth/social/onboarding | `{memberNick, memberFullname?}` | Unique member+identity atomically created; USER-only; no mandatory password/email/phone |
| GET /auth/security | — | Owned safe connected methods, recovery status and recent events |
| POST /auth/security/reauthenticate | `{password}` | Current password; marks current session recent |
| DELETE /auth/identities/:provider | — | Owned identity; recent authentication; last usable method protected |
| POST /auth/password/set | `{password}` | Social-only account, recent authentication; strong password, retains current session and revokes others |
| POST /auth/recovery-codes/generate | `{}` | Recent authentication; returns ten one-time codes once; replaces old hashes |
| POST /auth/email/verification/request | `{email}` | Recent authentication; optional SMTP; verification link expires in 30 minutes |
| POST /auth/email/verification/confirm | `{token}` | One-time token; confirms recovery email ownership; unique address enforcement |
| POST /auth/password/forgot | `{identifier}` | Generic response whether eligible or not; verified email only |
| POST /auth/password/reset | `{token, password}` OR `{memberNick, recoveryCode, password}` | One-use transaction/code; strong password; revokes all sessions |
| POST /auth/sessions/revoke-others | `{}` | Recent authentication; retains current session |

Existing REST `/auth/refresh`, `/auth/logout`, `/auth/logout-all`, `/auth/sessions` and individual session revoke are retained. Invalid ownership, expired/replayed transactions, suspended accounts and unavailable providers are rejected. Sensitive operations require authentication within the preceding five minutes, using current password or an explicitly connected provider REAUTH flow. A REAUTHENTICATION_REQUIRED response preserves the browser's working session.

Example GraphQL variables (synthetic values only):

```graphql
mutation Register($input: MemberInput!) {
  signup(input: $input) { accessToken member { _id memberNick memberType } }
}
```

```json
{"input":{"memberNick":"travel_example","memberPassword":"A long example travel passphrase!"}}
```

Use the project's existing login mutation with `{"input":{"memberNick":"travel_example","memberPassword":"A long example travel passphrase!"}}`. The test request must include Origin and Apollo preflight headers as required by the existing server. Tokens are sensitive; do not save live token responses as shared examples. Automated integration responses are not saved Postman examples; no Postman collection or examples were modified in this task.

## F. Provider implementation

All three providers use official Authorization Code flow with state, nonce and S256 PKCE. Server-side exchange has a timeout, no redirect following, and RS256 signature/JWKS validation. Issuer, audience, expiry, issued-at, nonce, subject and authorized-party rules are enforced. Client secrets remain backend-only. Provider access/refresh tokens are discarded after extracting a safe verified identity.

Google scopes: `openid email profile`; permanent key is sub. Telegram scopes: `openid profile`, confidential-client HTTP Basic token exchange; permanent key is sub, no phone/bot-access permission and no fake email. Kakao scope: `openid`, OIDC must be enabled, permanent key is sub; email is optional. Profile suggestions do not overwrite an existing member's chosen data.

New verified identities enter a bounded pending-onboarding ticket; no partial member exists until username submission. Explicit LINK verifies the initiating member and current refresh session again at callback. LOGIN, LINK and REAUTH are distinct intents. Email/display name/phone/photo never auto-merge accounts. A returned email conflicting with an existing account produces an explicit linking requirement. Identity uniqueness and transaction rollback protect concurrent ownership attempts.

Official references verified during implementation: [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [Telegram Login](https://core.telegram.org/bots/telegram-login), [Kakao REST login](https://developers.kakao.com/docs/latest/en/kakaologin/rest-api), [Kakao OIDC discovery](https://kauth.kakao.com/.well-known/openid-configuration).

## G–H. Sessions and security

Access JWT: 15 minutes, HS256, fixed issuer `triplink` and audience `triplink-api`, separate access/refresh signing keys. Access tokens stay in process memory on the frontend. Refresh cookie is HttpOnly, host-only, path `/auth`, Secure in production; SameSite=Lax by default. OAuth flow binding uses a separate HttpOnly Lax cookie for the top-level callback. Strict refresh cookies are rejected at startup when an OAuth provider is enabled.

Refresh expiry slides seven days on successful rotation, capped by the original thirty-day absolute session age. Sessions are separate per device. Rotation/reuse detection and bounded thirty-second same-operation recovery remain; existing browser Locks/SharedWorker coordination also covers social login/onboarding session commits. Old credentials, revoked sessions, changed authVersion or non-ACTIVE accounts cannot authorize protected operations. Current-device logout, logout-all and owned per-session revocation remain operational.

New password hashes use Argon2id (64 MiB, three iterations, one parallel lane). Existing bcrypt passwords and grandfathered names remain valid; successful bcrypt login uses a compare-and-swap rehash, preserving races with password changes. New passwords accept spaces and long passphrases (12–1024 characters) without composition rules; a small known-weak denylist is used, not a full breached-password database. Existing login accepts old short passwords; new credentials must meet current policy. New usernames normalize to lowercase, trim whitespace, use 3–30 ASCII letters/digits/underscore/period/hyphen (hyphen retained for project compatibility) and reject reserved names. Existing unchanged profile names are grandfathered.

Password changes/additions retain the initiating session with its updated authVersion and revoke other sessions. Recovery revokes all sessions. Recovery codes are 144-bit random values, hashed at rest, consumed atomically, displayed once and invalidated on regeneration. Verification and reset links use fragments, removed immediately into component memory; neither raw recovery material nor JWT is stored in localStorage. A verified recovery address remains effective until a replacement is verified. Accounts with no verified recovery email/codes/other connected method have no insecure fallback; the security UI explains this limitation.

Authentication requests use existing distributed MongoDB rate-limit records and bounded endpoint-specific limits; no permanent username lockout is added. Explicit Origin/custom-header browser checks, exact allowed CORS origins, owned-resource guards, safe redirects, generic login/recovery errors and safe DTOs remain. Frontend callbacks/recovery reject unsafe return URLs and self-referencing authentication loops. Account switching clears sensitive transient UI. Private member data is loaded after browser authentication; this Pages Router application does not SSR authenticated member data or forward access tokens into page props.

No SMS, phone OTP, mandatory phone/email, paid authentication platform, automatic account merge, provider token storage or new elevated-role signup was introduced.

## I. Executed validation

- Backend unit regression in the applied sibling repository: 161 tests, 18 suites passed. The focused OIDC suite also passed (16 tests), including the Strict-cookie startup guard.
- Complete backend API integration: 230 tests, 17 suites passed against disposable databases.
- Complete batch integration: 17 tests, 3 suites passed.
- Frontend: 103 tests passed, including actual component forms, reauthentication session preservation, provider availability and redirect defenses. Five added two-session component regressions verify immediate list refresh after revocation, password change/addition and provider disconnection; rejected revocation preserves both sessions. Total across frontend/backend/batch: 511 tests.
- Frontend/back-end non-writing type checks, whole-backend non-fixing lint and focused frontend non-fixing lint passed; frontend lint reported no warnings/errors after cleanup. GraphQL contract validation: 63 documents, 15 fixtures, zero errors.
- Provider cryptographic tests use offline RSA-signed tokens/local JWKS; API provider exchange and SMTP are mocked. Tests cover all providers, no-email onboarding, uniqueness races, linkage ownership, intent/browser/state/replay rejection, role preservation, last-method concurrency, recent authentication, password migration, recovery-code concurrency, token expiry, session revocation and suspended members.
- Disposable fixture databases were exact-name guarded. No development member records or counters were modified. Existing localhost servers were left running. The task-owned frontend/backend QA servers were stopped, their exact-name-guarded disposable database was dropped, and the original Chrome tab was restored.
- Production npm audit: 32 inherited production advisories (1 critical, 15 high, 15 moderate, 1 low). Critical package: proxy-addr. High paths include Apollo/Nest GraphQL, upload/parser dependencies, multer, lodash, ws and glob tooling. New direct auth dependencies do not account for these paths. Package-version upgrades were not silently folded into this auth change. Remediation plus regression testing is required before a production release.
- Browser evidence uses an isolated temporary frontend build cache and an exact-name-guarded disposable backend database on 127.0.0.1 ports 3012/3013. Synthetic sessions and the explicitly labeled Offline UI fixture were used; no real provider authentication was simulated in the deployed application. Desktop/mobile login, signup, recovery and onboarding captures are retained under frontend `.impeccable/review/auth/`. A full-page 393px mobile security capture and desktop security sessions-region capture are retained with the other eight route captures. The independent finish reviewer scored the session-list refresh fix resolved (disposition: ship); its verdict covers that single fix and the scoped UI evidence, not live provider or SMTP operation. The incumbent-system documenter recorded its final comparison in the same review directory. Automated component tests alone are not full visual/mobile acceptance. The Impeccable detector reported three unchanged pre-existing warnings in homepage/article SCSS, with no authentication-component findings; the incumbent styles were preserved.

Repeatable commands (frontend uses Yarn):

```bash
# frontend
yarn typecheck
yarn test
TRIPLINK_BACKEND_ROOT=/Users/a1234/Developer/trip-link yarn validate:contracts
# backend, from its root
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/jest --runInBand
node -r dotenv/config ./node_modules/jest/bin/jest.js --config apps/trip-link/test/jest-e2e.json --runInBand
node -r dotenv/config ./node_modules/jest/bin/jest.js --config apps/batch/test/jest-e2e.json --runInBand
```

Use non-production configuration and the test suites' disposable database guards. Do not run live test mutations against development members. Review the existing backend acceptance guide for test-specific environment conventions.

## J. Configuration

Keep backend credentials in its ignored environment/deployment secret manager. Frontend has only `REACT_APP_API_URL`, `REACT_APP_API_GRAPHQL_URL`, `REACT_APP_API_WS`; no OAuth/SMTP secret may be placed in frontend variables.

Backend `.env.example` documents:

- Existing MONGO_DEV / MONGO_PROD and PORT_API (API normally 3007), transaction-capable MongoDB.
- JWT_ACCESS_SECRET and JWT_REFRESH_SECRET: distinct random values at least 32 characters. JWT_ACCESS_EXPIRES_IN=15m, JWT_REFRESH_EXPIRES_IN=7d, JWT_SESSION_MAX_AGE=30d are enforced.
- FRONTEND_ORIGINS: explicit comma-separated origins, HTTPS in production, no wildcard. AUTH_FRONTEND_URL: one exact allowlisted frontend origin used for redirects and email links.
- AUTH_COOKIE_SECURE (production always Secure), AUTH_COOKIE_SAME_SITE=lax (or none with Secure for cross-site deployments). Strict cannot be used with enabled providers. AUTH_TRUST_PROXY_HOPS: 0–5, match the actual fixed proxy topology rather than blindly trusting headers.
- GOOGLE_ENABLED=false, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALLBACK_URL.
- TELEGRAM_ENABLED=false, TELEGRAM_CLIENT_ID, TELEGRAM_CLIENT_SECRET, TELEGRAM_CALLBACK_URL.
- KAKAO_ENABLED=false, KAKAO_REST_API_KEY, KAKAO_CLIENT_SECRET, KAKAO_CALLBACK_URL.
- SMTP_ENABLED=false, SMTP_HOST, SMTP_PORT=587 (STARTTLS) or 465 (implicit TLS), SMTP_USER, SMTP_PASSWORD, EMAIL_FROM. Certificate verification remains enabled.

Disabled providers are omitted from the UI and reject starts; enabled providers with incomplete credentials or wrong callback paths fail startup. SMTP-disabled verification returns an honest configuration error; forgot-password stays generic. Existing local authentication remains available with all provider flags off.

## K. Google setup

Create a Google Cloud OAuth web application, configure consent/authorized domains and register the exact backend HTTPS callback `https://<api-host>/auth/oauth/google/callback`. Set client ID/secret and callback variables; enable only after registration. Request only openid/email/profile. In staging, test new-account onboarding, existing-linked login, cancel, nonce/state expiry, explicit linking and admin-role retention. Real credentials and callback registration are required; no live sign-in has been verified.

## L. Telegram setup

Use BotFather's official Telegram Login setup to obtain the Login client ID and client secret and configure the allowed site/redirect URLs. Register the exact backend callback `https://<api-host>/auth/oauth/telegram/callback`; set TELEGRAM variables. The adapter uses official oauth.telegram.org OIDC with openid/profile and confidential-client Basic authentication. Do not enable phone scope or bot messaging permission for authentication. Confirm no-email signup, permanent subject continuity after Telegram username changes, explicit linking and cancellation in a live staging test.

## M. Kakao setup

Create/configure the Kakao Developers application, enable Kakao Login and OpenID Connect, configure the REST API key/client secret and required consent items, and register exact callback `https://<api-host>/auth/oauth/kakao/callback`. Set KAKAO variables and enable the flag. Adapter uses openid and S256 from official discovery. Verify no-email accounts, missing optional profile claims, repeat login and linked-account ownership with real staging credentials.

For local testing, callback examples use localhost:3007. Each provider console must actually permit the registered development callback; otherwise use a properly registered HTTPS staging/tunnel hostname and matching allowlisted frontend origin. Never bypass browser TLS warnings or invent a final production domain.

## N. Migration and rollback

1. Back up the target database; keep member IDs/relationships intact. Deploy first with provider/SMTP flags disabled and public registration gated until indexes are verified.
2. From backend root run `node scripts/auth-account-indexes.cjs`. It defaults to read-only dry-run and reports counts without member PII. If collisions exist, stop and review them manually; no rename/merge/delete operation is automated.
3. After explicit operational authorization, run `node scripts/auth-account-indexes.cjs --apply --database=<exact-connected-name>`. It creates additive indexes only, refuses a mismatched database, and never drops indexes/collections or rewrites members. Development database index application was not performed as part of this implementation.
4. Install the backend locked dependencies and deploy this application version. Mongoose development auto-indexing may also create additive schema indexes on a normal development restart; production must verify indexes deliberately before enabling signup/providers.
5. Confirm existing bcrypt users, mixed-case/legacy usernames, role gates and data ownership. Password rehash happens only after successful login; no batch credential rewrite is needed.
6. New issuer/audience validation can reject old access JWTs. Existing refresh sessions remain version-zero compatible and can mint new access tokens; clients without a usable refresh session must sign in again. Do not promise old access-token bytes remain usable.
7. Enable providers one at a time after exact console/callback live tests; configure optional SMTP last and verify actual delivery/one-time use.

Rollback: disable provider/SMTP flags and roll application code forward to a compatible version. Once new Argon2 hashes exist, a historical bcrypt-only binary cannot authenticate them; retain the dual Argon2/bcrypt verifier in any rollback release. Never delete identities, restore old password hashes over current credentials, merge accounts or drop indexes automatically. Secret rotation invalidates sealed pending auth transactions and applicable tokens; require a new flow/sign-in rather than restoring leaked secrets.

## O–P. Production checklist and remaining acceptance work

- Resolve inherited dependency advisories, review compatible updates and rerun the whole application regression suite. No production security acceptance is claimed while the critical advisory remains.
- Configure actual domain names, HTTPS certificates, secrets, CORS origins and fixed proxy trust. Same-site frontend/API subdomains generally use Lax; genuinely cross-site deployments need None+Secure and browser third-party-cookie validation. Verify the host-only `/auth` cookie and top-level callbacks in the actual hosting topology.
- Verify MongoDB transactions, all additive indexes, TTL policies, backups and least-privilege application access.
- Register each exact provider callback, complete provider consent requirements and test all three real flows. Provider credentials, console actions and final domain were unavailable in this task.
- Configure SMTP and test verified address replacement, reset expiry/replay and actual delivery. Forgot-password delivery is intentionally asynchronous in-process to keep responses generic; it is not a durable mail outbox. Add durable delivery/retries if the production service requires guaranteed recovery-message delivery.
- Test desktop/mobile browsers, keyboard/focus, provider-enabled states and actual production cookie behavior. Browser finish evidence is separate from component regression tests.
- Run concurrency/load/abuse testing appropriate to production traffic, including Argon2 memory cost, rate-limit behavior behind the chosen proxy, refresh rotation and credential mutations. No performance/load certification was performed.
- Ensure observability excludes cookies, Authorization, passwords, raw recovery tokens/codes, OAuth secrets/code/state and email links from proxy/APM logs. Review safe audit-event retention (90 days) against operational needs.
- No live Postman examples were created. An actual Postman acceptance run with disposable fixtures is still separate work.

Suggested commits (not created): backend `feat(auth): unify social identities and secure account recovery`; frontend `feat(auth): add provider onboarding and account security settings`.

Next backend task suggestion: resolve the production dependency advisories in a separately reviewed upgrade, then run real-provider and SMTP staging acceptance.
