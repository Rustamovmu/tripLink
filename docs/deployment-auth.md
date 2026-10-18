# TripLink deployment connection and authentication

## Evidence and scope — 2026-10-18

Source audit covered this repository (`main`), existing `../tripLInk-next` (`master`), and Nestar backend/frontend references. Working trees were clean before the task. Installed versions: NestJS 10.4.22, Mongoose 8.24.4, backend TypeScript 5.9.3; Next.js 14.2.0 Pages Router, React 18.2.0, Apollo Client 3.8.3, frontend TypeScript 4.6.2. Nestar has no equivalent rotating database-backed refresh/OIDC/session implementation; TripLink's current implementation remains the authority.

The supplied screenshot shows frontend `http://127.0.0.1:4000` calling `http://localhost:4001/auth/refresh`, provisional request headers and no visible response status. The user confirmed VPS hosting and IP **72.60.192.189**. The local private backend configuration allowlists `http://localhost:4000`, which differs from the displayed browser origin. This demonstrates inconsistent hostnames, not a proven invalid refresh credential. Tunnel setup, private VPS configuration/logs and the exact failed-request status remain unverified.

Read-only public VPS checks subsequently confirmed the deployed misconfiguration:

- `GET http://72.60.192.189:4000/` returned 200. Its public `/_next/static/chunks/pages/_app-d5c46c413653d3eb.js` bundle embeds `http://localhost:4001` and `http://localhost:4001/graphql`. These URLs target the visitor's computer unless both ports are deliberately tunneled.
- `GET http://72.60.192.189:4001/auth/providers` returned 200. API preflight returned 204 with `Access-Control-Allow-Origin: http://localhost:4000` only for that origin. Preflights using `http://127.0.0.1:4000` or `http://72.60.192.189:4000` returned no allow-origin header. Required custom headers and credentials were advertised. Therefore the screenshot's frontend origin and public-IP frontend origin are not browser-authorized.
- `https://72.60.192.189/` failed its normal TLS handshake with TLSV1_ALERT_INTERNAL_ERROR; certificate verification was not bypassed. No chosen domain or working trusted HTTPS endpoint has been supplied. This does not establish the configuration of any other domain on the shared VPS.

Only public HTML/JavaScript, provider-list and OPTIONS reads were performed. No VPS login, session mutation, data change, deployment, restart, SSH access or server-config inspection occurred. Changing localhost to a plain HTTP public IP alone would still fail the production secure-context/cookie requirements.

Before this patch, an unset production frontend API origin silently became localhost:3007; private local frontend settings point at localhost:4001. These settings are embedded at build time. A remote browser interprets localhost as its own computer. `libs/auth/runtime.ts` also called `crypto.randomUUID()` before handling restoration errors; an HTTP-like context without that API reproducibly threw before making a request. The screenshot includes a refresh operation identifier, so that separate reproduction does **not** explain the screenshot's request. Loopback browser origins can be secure contexts even over HTTP.

`127.0.0.1` and `localhost` are different origins and cookie sites; different ports on the same hostname are cross-origin but generally same-site. Use the same local hostname consistently. In an SSH workflow both frontend 4000 and API 4001 must reach their VPS listeners. Merely changing localhost to a public IP does not supply the HTTPS required for production authentication.

## Actual request path and session contract

Frontend `next.config.js` exposes only the existing three public API endpoints. `apollo/client.ts` sends browser GraphQL directly to `/graphql`; `libs/auth/runtime.ts` sends credentialed REST requests to `/auth`; `libs/auth/security.ts` handles provider/recovery operations. Shared chat uses native `/chat`. There are no Next API handlers, authentication middleware proxy, GraphQL subscriptions, SSR cookie forwarding, Axios interceptors or refresh credentials in localStorage. Middleware handles locale preference only; current pages fetch business data in the browser. SSR Apollo clients are created per request and obtain no browser token.

Backend `main.ts` applies explicit-origin credentialed CORS, bounded proxy trust, validation, multipart `/graphql`, static `/uploads`, native WebSockets and the configured API listener. `app.module.ts` loads `.env` through ConfigModule; process environment takes precedence. No global API prefix is configured. `auth.config.ts` validates keys, origins and lifetimes; `auth.controller.ts`, `auth-cookie.service.ts`, `token.service.ts` and `auth-session.service.ts` implement refresh/logout and durable session checks. `database.module.ts` currently selects **MONGO_PROD for every non-test mode**, including development, and MONGO_DEV only for NODE_ENV=test.

1. Browser login/signup posts GraphQL with Origin, `X-TripLink-Auth: 1`, `Apollo-Require-Preflight: true` and credentials included. The resolver returns `{accessToken, member}` and sets a host-only HttpOnly refresh cookie, never a refresh-token JSON field.
2. Access remains in browser memory. Protected GraphQL carries Bearer auth and omits cookies. Reload calls `POST /auth/refresh` with the cookie, Origin/custom auth header and a UUID `X-Refresh-Request-Id`; no bearer is required. It then hydrates `getCurrentMember`.
3. Only explicit access-expiry failures trigger the bounded GraphQL/session retry. Single-flight renewal, Web Locks/SharedWorker, versioned cross-tab synchronization and stale-response rejection are retained. Form/permission errors do not trigger refresh. Network/429/5xx errors preserve existing state; definitive authentication errors clear it. Anonymous missing-cookie 401 is expected and becomes a signed-out state, not an authenticated rotation defect.
4. Refresh validates typed HS256 claims with a distinct stable key, durable hashed session material, current account/role, revocation and both deadlines. Atomic rotation slides inactivity by seven days while clipping to the unchanged 30-day deadline. Same-operation recovery is bounded to 30 seconds; unrelated replay revokes the session. Access expires after 15 minutes. Database failures propagate as operational errors.
5. Logout revokes the cookie's current session and clears the same cookie scope; logout-all requires bearer auth. Late refresh responses cannot restore a superseded login/logout version. Cookie attributes: host-only, Path=/auth, HttpOnly, Secure in production, SameSite=Lax by default, persistent expiry matching the effective deadline. No cookie/CSRF/replay protection was weakened and no session migration is required. OAuth/recovery implementations are retained; real provider consoles were not accessed.

## Prepared production topology

The example `deploy/nginx.triplink.conf.example` is a **proposed single HTTPS host**, not a claim about the current VPS. A host Nginx proxy routes `/` to loopback 4000 (frontend container 3000) and `/graphql`, `/auth/`, `/uploads/`, `/chat` to loopback 4001 (API container 3007). Original paths, cookies and WebSocket upgrades are preserved. Docker service names are never exposed to the browser; the two existing Docker networks need not communicate directly. Batch uses loopback 4002/container 3008 and is not a browser API. Proxy ports are retained, not presumed free on the VPS; check before activation. Do not replace another project's Nginx server block.

API and batch Compose now explicitly use production mode; production cookies/HTTPS checks are enabled. An old HTTP-only `.env` will intentionally fail startup until configured correctly. Frontend production validation rejects absent origins, public HTTP, loopback/internal names and conflicting GraphQL/WebSocket origin/port/TLS/path settings. A local-only production frontend preview requires `TRIPLINK_LOCAL_PREVIEW=true` with an explicit loopback API origin; this flag cannot permit a public HTTP API and does not weaken backend cookie policy. Browser initialization rejects insecure contexts and inconsistent loopback hostnames with actionable errors rather than an uncaught UUID error. A separately approved two-line Session.tsx translation fallback preserves those diagnostic messages when no translation exists; known translations and role checks remain intact. Its regression, frontend typecheck/lint and isolated production build passed after that final change.

Private `.env` and `.env.local` were **not edited**. Use the actual chosen domain in the private deployment files. `triplink.example` below is a placeholder, not an assigned domain:

```dotenv
# Backend .env; Compose also sets NODE_ENV=production and PORT_API=3007.
MONGO_PROD=<private transaction-capable MongoDB URI>
MONGO_DEV=<private test-capable MongoDB URI>
JWT_ACCESS_SECRET=<stable distinct random secret of at least 32 characters>
JWT_REFRESH_SECRET=<another stable random secret of at least 32 characters>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_SESSION_MAX_AGE=30d
FRONTEND_ORIGINS=https://triplink.example
AUTH_FRONTEND_URL=https://triplink.example
AUTH_COOKIE_SECURE=true
AUTH_COOKIE_SAME_SITE=lax
AUTH_TRUST_PROXY_HOPS=1
# Set 1 only after establishing the single trusted proxy and loopback-only bindings.
# Retain actual enabled providers/SMTP settings. For each enabled provider register:
# GOOGLE_CALLBACK_URL=https://triplink.example/auth/oauth/google/callback
# TELEGRAM_CALLBACK_URL=https://triplink.example/auth/oauth/telegram/callback
# KAKAO_CALLBACK_URL=https://triplink.example/auth/oauth/kakao/callback
```

```dotenv
# Frontend .env.local, supplied BEFORE yarn build / Compose startup.
REACT_APP_API_URL=https://triplink.example
REACT_APP_API_GRAPHQL_URL=https://triplink.example/graphql
REACT_APP_API_WS=wss://triplink.example/chat
# TRIPLINK_LOCAL_PREVIEW must be absent/false for public deployment.
```

GraphQL/WS variables may be omitted to derive `/graphql` and `/chat` from the API origin. Do not retain stale explicit values. Next precedence is process env, environment-specific local file, .env.local, environment-specific file, .env; Compose injects .env.local into process env. No secret belongs in these browser variables. API CORS/CSRF requires the actual browser origin (including scheme/port), not the backend origin; AUTH_FRONTEND_URL must be one allowlisted origin. A separately hosted cross-site frontend/API requires a separately verified cookie topology, not an automatic SameSite=None change.

## Deployment commands — prepared, not executed

Commands below run **on the actual VPS in each existing checkout** after reviewing/committing changes and confirming the selected HTTPS domain, DNS, certificates, free ports, environment and provider callback registrations. No server checkout path or SSH user has been confirmed, so none is invented. The scripts do not pull, reset, checkout or commit; deploy the reviewed revision deliberately using your existing workflow.

```sh
# Backend checkout: inspect intended branch/revision and containers without printing .env.
git branch --show-current
git status --short
git log -1 --oneline
docker compose config --quiet
docker compose ps
ss -ltn '( sport = :4000 or sport = :4001 or sport = :4002 )'
# Existing additive index scripts: execute only against the deliberately configured DB.
NODE_ENV=production node scripts/auth-session-indexes.cjs
NODE_ENV=production node scripts/auth-account-indexes.cjs
# Authorized deployment window only; recreates triplink-api and runs its existing install/build command.
bash deploy.sh
docker compose ps
# Optional batch deployment is separate; do not enable booking expiry without reviewing eligible records.
# docker compose up -d --force-recreate triplink-batch
```

```sh
# Frontend checkout, configured .env.local already in place, authorized deployment window only.
git branch --show-current
git status --short
docker compose config --quiet
bash deploy.sh
docker compose ps
```

The API container runs `npm ci --include=dev`, `npm run build -- trip-link`, then the built API entry point. Frontend uses Yarn exclusively: frozen install, `yarn build`, `yarn start -H 0.0.0.0`. Source/env changes alone do not alter Compose's service hash: the scripts now force recreation to rerun those commands and eliminate stale bundles. Both scripts reject unreviewed working-tree changes, preserve branch/history, and never discard local work.

Install a separately reviewed version of the supplied Nginx example only after provisioning a valid certificate; test with `sudo nginx -t`, then reload Nginx only with deployment authorization. Do not run `nginx -T`, `docker inspect`, `docker compose config` without --quiet, or unredacted environment/log dumps in shared diagnostics: they can disclose credentials. Relevant status commands are `docker compose ps`, `docker compose logs --tail=100 triplink-api` in the backend checkout and `docker compose logs --tail=100 triplink-next` in the frontend checkout; inspect logs privately and share only redacted error/status lines. No PM2 configuration is present.

## Post-deployment verification

1. Open the chosen **HTTPS** frontend in a fresh browser context. Verify network destinations for `/auth/refresh`, `/graphql`, `/uploads` and `/chat`: selected public host, no localhost/internal container name, correct TLS and unmodified paths. A first refresh 401 with no cookie is normal; there must be no repeating loop or alarming session banner. A failed fetch/CORS 403/5xx is a different failure.
2. Login with a dedicated authorized test member. Verify successful GraphQL data, HttpOnly/Secure/Path=/auth cookie with no blocking reason, authenticated getCurrentMember, and no credentials in localStorage. Reload and open a second tab; both must remain signed in. Confirm CORS preflight includes the exact Origin, credentials, custom auth/request-ID headers and Apollo multipart header. Never share Cookie/Authorization/Set-Cookie values.
3. In a disposable test backend, use controlled time to expire access and verify one renewal/retry, concurrent-tab coordination, seven-day inactivity and fixed 30-day cap, unrelated replay rejection, revoked/expired accounts, and logout winning over late refresh. Do not alter a production session's dates. Backend restart with unchanged keys/DB must preserve otherwise valid sessions. A live production restart is not part of this task.
4. Verify authorized roles and existing Google/Kakao/Telegram flows only where actually enabled/configured. Check provider start/callback paths and finish/onboarding cookies through the proxy. Preserve recovery email/codes; no phone verification is added. Real provider and SMTP acceptance requires their existing configured external services.
5. For uploads, use a disposable image association, a valid role/token, true multipart bodies and browser-managed boundaries; no cookie/path rewrite or missing preflight header. Verify native `/chat` upgrade/authentication. These transport checks must use the chosen deployed browser origin.

Use disposable fixtures and existing [authentication](authentication.md) / [account security](account-security.md) recipes, not development records. If using Postman, use Login and CurrentMember from authentication.md and the current USER-only signup input in account-security.md, with headers adjusted to the selected frontend origin. The older PHONE/AGENT signup recipe in authentication.md is superseded by account-security.md. REST refresh/logout has no GraphQL Variables/body. No API/schema contract changed here. No actual Postman request or saved live example is claimed. Delete only fixture records/databases after checking their exact names and close task-owned apps/clients. Do not delete production data or revoke unrelated sessions.

## Task validation and remaining limits

Validation completed on the approved patch:

| Check | Result |
| --- | --- |
| Frontend `yarn test` | 156/156 passed, including eight new context/configuration/anonymous/banner regressions |
| Backend Jest unit suites | 181/181 passed in 19 suites |
| Auth, refresh-session, account-security, local-provider API integration suites | 82/82 passed in four suites on disposable MongoDB fixtures; provider exchange/SMTP mocked |
| Frontend/backend non-writing typechecks | Passed |
| Backend whole-app non-fixing ESLint; frontend focused ESLint and production-build lint | Passed |
| GraphQL contract validation | 63 documents, 22 variable fixtures, zero errors |
| Isolated backend production build | `NODE_ENV=production npm run build -- trip-link` passed |
| Isolated frontend production build | `yarn build` passed, 74 static pages; explicit local-preview URLs used for browser testing |
| Both Compose `config --quiet`, deploy `bash -n`, diff checks | Passed |

Total configured tests run after the patch: **419**. Earlier baseline results overlap and are not added to this total. Builds ran in `/private/tmp/triplink-deploy-qa-4zuzk6bp/{frontend,backend}`, excluding private env files and reusing installed dependencies; repository build directories were not overwritten. The first temporary frontend copy accidentally omitted `libs/uploads`; restoring that source directory fixed the harness copy and the final build passed. The first sandboxed baseline API run had blocked DNS and inherited test callback-origin mismatch; the isolated rerun passed. Test support now pins its frontend callback origin. The formatter's first invocation did not write files; its corrected invocation succeeded with the pre-existing ignored Prettier `extends` warning.

Native Chrome with the optimized local frontend and a uniquely named disposable API database verified initial anonymous no-session behavior without an error banner, credential login, authenticated navigation, refresh-cookie acceptance/rotation after reload, current-member hydration and the Security page/session endpoints. Captured local CORS preflights were 204 with the exact frontend origin; refresh transitioned from expected anonymous 401 to authenticated 201. Local cookie attributes were HttpOnly, Path=/auth, SameSite=Lax with seven-day persistence; Secure was deliberately absent in this non-production HTTP fixture. Production Secure configuration is covered by backend unit tests; actual trusted-HTTPS browser cookie transport was not tested. No browser DevTools cookie-blocking panel, fresh multi-tab browser matrix or live OAuth provider was exercised in this task; concurrency/provider regressions are automated.

Six additional real HTTP lifecycle checks passed against the compiled disposable API: login/current member; rejection of the screenshot-style mismatched origin; controlled access expiration, refresh and original-request retry with sliding/fixed deadlines; concurrent same-operation recovery; **separate API process restart** preserving valid access/refresh using stable keys and the same database; logout preventing subsequent access/refresh. These HTTP checks are distinct from native UI actions and Postman. The initial in-process restart harness failed from reloading bundled classes; it cleaned its database and was replaced with the passing separate-process harness, with no application fix needed.

Task-owned API/frontend processes and the QA browser tab were closed; the QA cookie was cleared. Exact-name-guarded browser fixture databases were dropped. The local-provider integration suite emptied its fixture database; a separate exact-name audit found zero documents and removed that empty task-created database. Other integration suites perform guarded cleanup themselves. Development/production records, existing user servers/tabs, private environment files and authentication credentials were not changed. Reports/harnesses are local-only artifacts under `/private/tmp/triplink-deploy-qa-4zuzk6bp/`: `browser-report.json`, `browser-report-v2.json`, `http-lifecycle-report.json`; reports omit raw tokens and cookie values.

Confirmed public IP/HTTP/CORS/bundle observations appear above. Production DNS/domain, private proxy configuration, certificates, API tunnels and deployed authenticated cookies remain unverified. Local Docker daemon and Nginx are unavailable; Compose parsing passed offline, but container execution and actual Nginx syntax/runtime require their hosts. Production deployment/restarts and private environment changes are not authorized by the code patch. Do not run the production Compose files with the unchanged HTTP-only local env settings; choose the trusted HTTPS origin and register enabled provider callbacks first.

Changed backend files: `.env.example`, `docker-compose.yml`, `deploy.sh`, `apps/trip-link/test/auth-test-support.ts`, `deploy/nginx.triplink.conf.example`, `docs/deployment-auth.md`, `docs/COMPLETED_TASKS.md`. Changed frontend files: `.env.example`, `docker-compose.yml`, `deploy.sh`, `next.config.js`, `libs/auth/runtime.ts`, `libs/auth/index.ts`, `libs/components/triplink/Session.tsx`, `tests/auth-refresh.test.cjs`, `tests/deployment-config.test.cjs`. No dependency, runtime API, schema, migration, signing/session rule, OAuth provider or recovery-flow implementation changed.

Suggested commits (not created): backend `fix(deploy): prepare secure TripLink API hosting and auth verification`; frontend `fix(auth): validate deployment endpoints and handle browser initialization failures`.
Next backend task: under separate deployment authorization, configure the chosen trusted HTTPS origin/provider callbacks on the confirmed VPS and validate authenticated browser sessions through its real proxy.

References: [Next.js environment loading/build-time values](https://nextjs.org/docs/14/pages/building-your-application/configuring/environment-variables), [Next config env inlining](https://nextjs.org/docs/14/pages/api-reference/next-config-js/env), [secure-context UUID availability](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID).
