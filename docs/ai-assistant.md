# TripLink AI assistant

Implemented 2026-10-13. The assistant is separate from the existing authenticated shared WebSocket room. It uses the application's GraphQL/Apollo transport; no REST controller, router migration, database booking write, or new UI library is required.

## Configure and run

In the backend's ignored local environment file, configure:

~~~dotenv
GEMINI_API_KEY=<your Google AI Studio API key>
GEMINI_MODEL=gemini-3.5-flash-lite
~~~

Only GEMINI_API_KEY is required for AI generation; the model has the shown default. Existing MONGO_DEV/MONGO_PROD, SECRET_TOKEN and PORT_API settings remain required. Never add this key to frontend environment variables, next.config.js, source control or saved Postman examples. The credential-free .env.example contains the AI settings.

The official @google/genai SDK is pinned to 2.28.0 in backend package.json and package-lock.json. Its dependency tree was installed with Yarn in isolation and nested under the SDK to preserve every existing dependency version/lock entry. No frontend dependency was added.

Restart the backend through its existing workflow after setting the key. Keep the usual GraphQL endpoint http://localhost:3007/graphql and native WebSocket endpoint ws://localhost:3007/chat. Start the frontend with yarn dev; its existing public endpoint settings are unchanged. FRONTEND_ORIGINS must include the frontend origin.

Log in as an ACTIVE USER, AGENT or ADMIN and open AI Assistant next to Shared chat on public layouts. The launchers remain authenticated, matching the existing community room. The separate admin layout has neither community launcher. On desktop both panels can stay open together; mobile uses the existing MUI focus/scroll handling in a full-height dialog. Closing preserves completed chat exchanges in memory across route navigation. Clear, logout/account/token change and full browser reload discard the conversation. No prompts or answers are written to browser storage or MongoDB.

## Contract, grounding and cost controls

New mutation: aiChat(input: AiChatInput!): AiChatResult!.

Input:
- message: trimmed 1–1000 characters.
- history: optional last five user/assistant messages, each 1–1000 characters; system roles and unknown fields are rejected. With the current question, at most six conversation messages reach Gemini.
- tourId: optional 24-character MongoDB ID for a public tour. A read omits viewer identity and does not record a visit.
- search: optional existing public TourSearch filters; no draft/status/admin fields.
- intent: FIND_TOURS, BEST_RATED, POPULAR_DESTINATIONS or PLAN_TRIP.
- detailed: optional explicit request for a longer answer.

Output: text and sources with tourId, title, destination, effective price, durationDays, rating, reviewCount and status. Source links and figures are built from current backend records, independently of generated prose. Prices use the frontend's existing USD display convention and preserve cents.

The assistant reuses TourService.getTours/getTour and their public ACTIVE/SOLD_OUT restrictions. A tour detail page supplies the current ID; the tour directory supplies its validated applied URL filters. Quick actions deliberately search the catalogue rather than limiting themselves to the detail page's tour. Best-rated uses tourAverageRating; popular-tour destination suggestions use tourBookingCount. These are not platform-wide destination statistics.

Without explicit filters, bounded keyword retrieval removes common question words and recognizes selected Korean/Russian Korea/Seoul/Jeju/Busan aliases. It is not universal semantic search: translated destinations or ambiguous follow-ups can miss inventory. The model must state when information is unavailable and may suggest a clarification or using tour filters. At most five tours, short descriptions/services, and three future departures per tour enter the context. The catalogue is explicitly partial. Long itineraries and private agent/member/booking records are excluded.

A concise system prompt requests the user's language, 1–3 sentences and no invented product prices, availability or actions. Catalogue data is sent as untrusted user context, outside the system instructions. Booking answers explain existing lifecycle rules and direct personal-status questions to the booking workspace; the AI cannot book, pay, cancel, refund or change data. Generated advice may still be inaccurate; the UI asks users to check tour details.

Generation uses minimal thinking and maxOutputTokens=200, or 600 after the More detail option or recognized English/Korean/Russian requests for detail. The provider makes one request attempt with SDK automatic retries disabled and a 20-second timeout. It does not use paid search tools, embeddings, function-call loops or a second model call. The frontend waits at most 30 seconds, prevents duplicate submissions synchronously, bypasses Apollo cache for chat, and allows manual retry of the same failed turn.

MongoDB ai_usage stores only expiring quota counters and ownership-tagged request leases:
- Per authenticated member: 6 attempts per UTC minute, 60 per UTC day, one concurrent request.
- Across all members/processes sharing the database: 60 attempts per UTC minute, 1000 per UTC day.
- Fixed windows can permit a boundary burst. Failed requests consume quota conservatively.
- A 60-second lease prevents concurrent submissions; owner-checked cleanup cannot delete a replacement lease. Expired leases can be acquired immediately even before MongoDB TTL cleanup.
- Provision the schema's expiresAt TTL index for production (Mongoose initializes it when index creation is enabled). Quotas depend on MongoDB availability and fail closed.

API errors expose only public messages and codes: AI_RATE_LIMITED, AI_UNAVAILABLE, or existing UNAUTHENTICATED/FORBIDDEN/validation errors. No API key, provider response body, exception stack, or private database detail is returned. Clearing or leaving a page cancels the browser request and discards late results; a request already received by Google may still be billed. The next attempt can remain limited until the server finishes/releases its lease.

Google references: [model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [SDK retries](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpRetryOptions.html), [generation configuration](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html).

## Postman verification

These are manual recipes, not saved live responses. For requests that generate replies or change fixture status, use a dedicated test server on a free port (for example http://localhost:3008/graphql), connected to a uniquely named disposable database. Do not change development members, tours or counters. Provision ACTIVE USER, AGENT and ADMIN fixtures; public signup cannot create ADMIN. Use fresh fixture IDs and tokens; store the token locally in Bearer authorization, not in exported Variables or saved examples.

POST with Content-Type: application/json and Apollo-Require-Preflight: true. Exact operation:

~~~graphql
mutation AI_CHAT($input: AiChatInput!) {
  result: aiChat(input: $input) {
    text
    sources {
      tourId
      title
      destination
      price
      durationDays
      rating
      reviewCount
      status
    }
  }
}
~~~

Exact Variables:

~~~json
{
  "input": {
    "message": "Show me the best-rated TripLink tours.",
    "history": [],
    "intent": "BEST_RATED",
    "detailed": false
  }
}
~~~

1. Send using each ACTIVE role's token. With a configured key and eligible fixture tours, expect HTTP 200, no errors, concise text and source IDs/prices matching the fixtures. Empty sources are valid when no public tours match.
2. Ask a Korean or Russian travel question using the same operation and Variables shape. Verify the generated answer uses that language. This requires real Gemini; mocked-provider tests verify transport, not live model language quality.
3. Set tourId in input to a fresh public fixture's ID and ask what is included. Confirm tour view/visit counters remain unchanged. Supply a DRAFT or absent tour ID: expect a safe AI_UNAVAILABLE response with no hidden catalogue data.
4. Remove authorization or use an expired/invalid/stale-role token: HTTP 200 with data:null and UNAUTHENTICATED. Disable only a disposable member: FORBIDDEN. Restore that fixture after the test.
5. Supply an empty/1001-character message, six history entries, or a system history role: expect GraphQL BAD_REQUEST validation without a provider call. Unknown fields, such as apiKey, fail GraphQL coercion/validation (typically HTTP 400).
6. Send seven valid requests within the same UTC minute from one member (avoid crossing a window boundary): at most six reach the provider, then HTTP 200 with AI_RATE_LIMITED and data:null. Parallel requests for the same member are also limited. Tests cover shared instances and global budgets without costly live calls.
7. With the key omitted on the dedicated server, expect AI_UNAVAILABLE; rate-limit/provider failures must contain no internal details. Do not deliberately trigger paid provider failures against the development server.

Inspect errors[].extensions.code; HTTP 200 alone is not GraphQL success. Confirm rejected requests do not change tours/bookings/reviews. Quota/lease writes are expected, with no stored conversation text.

Cleanup: stop only the dedicated test server, close its browser/WebSocket clients, verify the exact disposable database name before dropping it, and clear fixture tokens/IDs from Postman settings. Never drop or alter the development database. No Postman collection or live example was created by this implementation.

## Files

Backend created:
- apps/trip-link/src/components/ai/ai.module.ts
- apps/trip-link/src/components/ai/ai.resolver.ts
- apps/trip-link/src/components/ai/ai.service.ts
- apps/trip-link/src/components/ai/gemini.provider.ts
- apps/trip-link/src/components/ai/ai-rate-limit.service.ts
- apps/trip-link/src/components/ai/ai.constants.ts
- apps/trip-link/src/components/ai/ai-system.prompt.ts
- apps/trip-link/src/components/ai/ai.service.spec.ts
- apps/trip-link/src/components/ai/gemini.provider.spec.ts
- apps/trip-link/src/libs/dto/ai/ai-chat.input.ts
- apps/trip-link/src/libs/dto/ai/ai-chat.ts
- apps/trip-link/src/schemas/AiUsage.model.ts
- apps/trip-link/test/ai.e2e-spec.ts
- .env.example
- docs/ai-assistant.md

Backend modified: apps/trip-link/src/components/components.module.ts, package.json, package-lock.json, docs/COMPLETED_TASKS.md.

Frontend created: apollo/user/ai.ts, libs/types/triplink/ai.ts, libs/triplink/useAiAssistant.ts, libs/components/AiAssistant.tsx, libs/components/ChatTools.tsx, tests/ai-assistant.test.cjs.

Frontend modified: libs/components/layout/LayoutHome.tsx, LayoutBasic.tsx, LayoutFull.tsx, scss/triplink.scss, public/locales/en/common.json, kr/common.json, ru/common.json, scripts/validate-contracts.cjs. LayoutFull's returned component now has a display name for lint compliance. Existing Chat.tsx, useChat.ts, socket gateway and their business logic are unchanged.

## Recorded validation

- Frontend yarn typecheck passed after implementation and the final UI refinement.
- All 79 frontend tests passed, including five new AI tests and the existing seven chat tests.
- Backend non-writing TypeScript and focused non-fixing AI/module lint passed.
- 23 focused AI unit tests passed.
- 27 real HTTP/MongoDB/WebSocket integration tests passed: eight new AI tests with mocked Gemini, and 19 existing shared-chat tests. Dedicated fixture database names were verified before cleanup and applications/clients closed.
- Frontend contract validation passed: 63 documents, 15 existing variable fixtures, zero errors. AI DTO Variables were additionally exercised in the unit/HTTP suites.
- Chrome preview used an isolated frontend copy on 3011 and a disposable backend on 3088, with mocked Gemini. Verified adjacent launchers, completed AI response/source links, shared-chat echo with both panels open, and the 390px mobile panel. Sources came from disposable fixture tours.
- The sandboxed MongoDB attempt failed at DNS; the same integration command passed with approved network access.
- The backend environment has no GEMINI_API_KEY. No real Gemini request or live model-quality/latency check was performed. This is not a production/load or whole-backend acceptance run.
- The preview showed an existing homepage date-picker hydration warning and a shared-chat focus warning while switching device modes; these are outside the new AI transport. The preview catalogue was deliberately incomplete for unrelated homepage/agent queries.
- The Impeccable detector binary was unavailable; screenshot/source review was used.

- Focused non-fixing frontend lint passed with zero warnings/errors; both repository diff checks passed.
- The independent screenshot/source review returned ship with no material fixes; documentation review confirmed an ordinary extension of the incumbent system.
- The task-owned browser tab and preview servers were closed; ports 3011/3088 were verified closed. The exact preview database was verified and dropped. Existing 3000/3007 servers remained untouched.
