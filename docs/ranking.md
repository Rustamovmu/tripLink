# Tour and agent popularity rankings

Implemented 2026-10-10. Nestar's `Property.model.ts`, `Member.model.ts`, ranking sort allowlists and `nestar-batch` service/controller supply the stored-score and cron structure. TripLink adapts the business rules:

- `tourRank = tourFavoriteCount * 2 + tourViewCount` for ACTIVE/SOLD_OUT tours; other tours receive zero.
- `agentRank = publicTourCount * 5 + memberFollowers * 3 + memberLikes * 2 + memberViews` for ACTIVE AGENT members; others receive zero.
- `publicTourCount` counts the agent's ACTIVE/SOLD_OUT tours, matching current public-profile visibility. It is computed from tours, not the all-status `memberTours` counter. Followers replace Nestar's article contribution because TripLink has no member article counter.

These are popularity scores, not review-quality scores or ordinal positions. Rating sorting remains separate. GraphQL exposes non-null Float scores (to avoid GraphQL Int's 32-bit limit); frontend results are numbers. Missing legacy fields resolve to zero, including nested Tour/Member outputs. DTO TypeScript properties remain optional to represent records that predate this addition. Scores are not accepted in signup/create/update/admin mutation inputs.

## Scheduling and consistency

The batch application's `RankingService` registers `RECALCULATE_RANKINGS` at `0 0 1 * * *`, explicitly in `Asia/Seoul`. Set `BATCH_RANKING_ENABLED=true` in the batch environment to opt in. Every other value, including omission, disables writes. This flag is independent of `BATCH_BOOKING_EXPIRY_ENABLED`. No environment file was changed and no job was enabled on development data during implementation.

Only the batch application runs the job. It does not run automatically at startup. `runRanking()` is a service method for testing/operations, not an HTTP or GraphQL endpoint. Do not expose an unauthenticated trigger. To verify scheduling manually, use a dedicated disposable batch/API database and wait for the next scheduled time; automated tests invoke the registered cron callback directly.

Scores are recalculated directly, without a separate reset window. Tours use MongoDB pipeline updates. Agents use a cursor with a batch size of 100 and a per-agent public-tour count; writes recheck the current role/status and read interaction counters at write time. Missing counters contribute zero. Recalculation preserves interaction counters, seats, booking state and `updatedAt`. New schema defaults are zero; legacy database records are populated on the first enabled pass. Status/interaction changes can leave stale scores until the next pass; ordinary API visibility and authorization continue to apply immediately.

A pass is not a cross-collection transaction: readers can see a mix of old/new scores, and tour counts can change while the job runs. A failed pass can leave partial score updates; the next pass recomputes them. An in-process guard prevents overlap, and shutdown waits for current writes and closes the cursor. Run one enabled batch instance; there is no distributed lease. This is portfolio-scale scheduling, not a production/load-test claim. Rank indexes are declared, but aggregation normalization of missing fields can require an in-memory sort; index-backed performance is not claimed.

## GraphQL usage and Postman verification

Endpoint: HTTP POST `{{apiOrigin}}/graphql`, where `apiOrigin` uses the actual configured `PORT_API`. Use Postman's GraphQL body, with the operation in Query and the exact corresponding JSON in Variables. For JSON requests use `Content-Type: application/json`.

Public queries below require no token. Choose No Auth and omit Authorization for anonymous tests. Alternatively use a fresh access token for any current ACTIVE USER/AGENT/ADMIN. An invalid supplied token is rejected even for public reads. Owner mutation rejection tests require the owning ACTIVE AGENT token.

### Fixtures and prerequisites

Use a separate temporary API server and batch application configured with the same uniquely named disposable database, such as `tl_rpm_<24-character ObjectId>`. Confirm the exact connected database name and ensure `NODE_ENV` is not production before creating fixtures. Use a transaction-capable replica set. Do not point an enabled ranking worker at development records for testing.

Create two disposable ACTIVE agents, a USER and an ADMIN; signup cannot create ADMIN, so use an isolated database fixture provisioned for this test. Use the existing signup/tour/upload/publication recipes in [backend acceptance](backend-acceptance.md) to create publishable tours. All fixture nicknames/titles must say `disposable-rank`. Include ACTIVE, SOLD_OUT and DRAFT tours, plus a blocked AGENT fixture. Modify statuses only on these disposable fixtures. Record the current returned IDs/tokens, not IDs from old examples.

For deterministic formula verification, provision fixture counters only in that disposable database: a tour with three favorites and seven views expects 13; an agent with two public tours, two followers, three likes and four views expects 26. Include a legacy fixture with score/counter fields absent. The automated ranking suites demonstrate this isolated fixture approach; their databases are deleted after execution and cannot be reused by Postman. For API-driven counter changes instead, use disposable member interactions and compare against the resulting actual counters. Do not overwrite development counters.

### Tour list

```graphql
query RankedTours($input: ToursInquiry!) {
  getTours(input: $input) {
    list { _id tourTitle tourStatus tourRank tourFavoriteCount tourViewCount }
    metaCounter { total }
  }
}
```

```json
{"input":{"page":1,"limit":10,"sort":"tourRank","direction":"DESC","search":{}}}
```

Expected success: `data.getTours.list` contains only public tours, ordered by descending score and descending `_id` for ties. `metaCounter` contains the total, or is empty if no matches. Reverse `direction` to `"ASC"` to verify ascending score and `_id`. Use page 1/page 2 with limit 1 to verify stable pagination when scores are unchanged. Existing default sorting remains createdAt descending. The same `tourRank` sort is accepted by `AgentToursInquiry` and `AllToursInquiry` under their existing ownership/admin guards.

### Agent list

```graphql
query RankedAgents($input: AgentsInquiry!) {
  getAgents(input: $input) {
    list { _id memberNick agentRank memberFollowers memberLikes memberViews }
    metaCounter { total }
  }
}
```

```json
{"input":{"page":1,"limit":10,"sort":"agentRank","direction":"DESC","search":{}}}
```

Expected success: only ACTIVE AGENT members, sorted by score and `_id` descending. Draft tours contribute nothing to the score; USER/ADMIN and blocked agents do not appear. Repeat ascending and paginated checks as above. The generic admin member inquiry does not gain an agentRank sort.

### Detail scores

```graphql
query RankingDetails($tourId: String!, $memberId: String!) {
  getTour(tourId: $tourId) { _id tourRank agentData { _id agentRank } }
  getMember(memberId: $memberId) { _id agentRank recentTours { _id tourRank } }
}
```

```json
{"tourId":"{{rankTourId}}","memberId":"{{rankAgentId}}"}
```

Set both Postman environment values to current fixture 24-character hexadecimal IDs. No token required. Anonymous tour reads avoid creating visit history. Expected success: stored scores are exposed on details and nested outputs; missing legacy scores return zero. After the enabled batch recalculation, verify 13/26 for the deterministic fixtures. A hidden tour ID returns NOT_FOUND. Do not assume a joined agent always exists.

### Rejection cases

Using RankedTours with this exact Variables JSON:

```json
{"input":{"page":1,"limit":10,"sort":"propertyRank","direction":"DESC","search":{}}}
```

Expected `errors[0].extensions.code`: `BAD_REQUEST`. Repeat RankedAgents using `sort: "memberRank"` in the same JSON structure; it also rejects unsupported sorts. Numeric direction values reject enum coercion (`BAD_USER_INPUT`); use `"ASC"`/`"DESC"`.

Send the valid list operations with `Authorization: Bearer invalid`: expect `UNAUTHENTICATED`. A correctly signed token for a blocked disposable account expects `FORBIDDEN`. Check GraphQL `errors` even when HTTP status is 200.

With the owning ACTIVE AGENT token, submit:

```graphql
mutation RejectTourRankWrite($input: TourUpdate!) {
  updateTour(input: $input) { _id tourRank }
}
```

```json
{"input":{"tourId":"{{rankTourId}}","tourRank":999}}
```

```graphql
mutation RejectAgentRankWrite($input: MemberUpdate!) {
  updateMember(input: $input) { member { _id agentRank } }
}
```

```json
{"input":{"agentRank":999}}
```

Both expect `BAD_USER_INPUT` because the input types do not contain these fields. Verify scores/counters are unchanged. No role can assign a score through these mutations.

### Cleanup and response provenance

Stop only the temporary servers/workers started for the test. Verify the exact disposable database name before dropping it. Remove task-owned temporary uploads and clear fixture IDs/tokens from active Postman settings. Dropping the disposable database removes its fixture interactions and counter increments together. Existing development records/counters and the user's running server must remain untouched.

These instructions are a manual recipe. Implementation validation uses real automated MongoDB/HTTP responses, not Postman requests, mock responses or saved Postman examples. Actual Postman runs and clearly named `(live)` examples require a separate request; scrub tokens from saved data and treat deleted fixture IDs as historical.

## Validation commands

```sh
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/eslint "{src,apps,libs,test}/**/*.ts"
./node_modules/.bin/jest --runInBand --no-cache --silent
node -r dotenv/config ./node_modules/jest/bin/jest.js --config apps/batch/test/jest-e2e.json --runInBand --no-cache --silent --runTestsByPath apps/batch/test/ranking.e2e-spec.ts apps/batch/test/booking-expiry.e2e-spec.ts
node -r dotenv/config ./node_modules/jest/bin/jest.js --config apps/trip-link/test/jest-e2e.json --runInBand --no-cache --silent --runTestsByPath apps/trip-link/test/ranking.e2e-spec.ts apps/trip-link/test/agent-profile.e2e-spec.ts apps/trip-link/test/tour.e2e-spec.ts apps/trip-link/test/auth.e2e-spec.ts
git diff --check
```

## Implementation validation — 2026-10-10

- Non-writing TypeScript check passed.
- Whole-repository non-fixing ESLint passed with zero errors/warnings.
- All configured unit suites passed: 97 tests in 12 suites.
- Focused API integration passed: 43 tests in 4 suites (ranking, tours, authentication, public agent profiles).
- Focused batch integration passed: 15 tests in 2 suites (ranking and existing booking expiry).
- Total for this task: 155 tests across 18 suites. This is a focused acceptance run, not a new complete API/batch acceptance pass.
- Initial sandboxed integration attempts were stopped after MongoDB DNS was blocked; the reruns with network access passed. Expected negative-request GraphQL logs accompanied passing assertions.
- Every new fixture suite verified its exact uniquely named database before dropping it, closed its applications/cursors, and restored environment values. Existing selected suites also completed cleanup. No persistent development counters or records were changed; no existing server was stopped.
- Diff checks passed. No actual Postman request or live example was created.

Exact implementation files changed:

- `apps/trip-link/src/schemas/Tour.model.ts`
- `apps/trip-link/src/schemas/Member.model.ts`
- `apps/trip-link/src/libs/dto/tour/tour.ts`
- `apps/trip-link/src/libs/dto/member/member.ts`
- `apps/trip-link/src/libs/config.ts`
- `apps/trip-link/src/components/member/member.service.ts`
- `apps/trip-link/src/components/tour/tour.service.ts`
- `apps/batch/src/batch.module.ts`
- `apps/batch/src/ranking.service.ts` (new)
- `apps/batch/src/ranking.service.spec.ts` (new)
- `apps/batch/test/ranking.e2e-spec.ts` (new)
- `apps/trip-link/test/ranking.e2e-spec.ts` (new)
- `docs/ranking.md` (new)

The pre-existing working-tree change in `docs/COMPLETED_TASKS.md` was left untouched. No frontend repository was changed.


## Actual Postman verification — 2026-10-10

Completed in the installed Postman desktop app, workspace **TripLInk**. Every example below was saved from the response returned by an actual Send action against the temporary API; no response body was replaced with expected data and no mock server was used.

- Collection: **Ranking Verification - 2026-10-10 (disposable live)**
- Collection ID: `55386880-1d5926fb-8924-4b48-b34d-096cebcb3c0d`
- Parent HTTP request: **Ranking verification requests**
- Request ID: `55386880-9017b531-190c-4e24-bbee-1109dc90a046`
- Temporary endpoint: `http://127.0.0.1:55267/graphql` (stopped after verification).
- Disposable database: `tl_rpm_6ac956f50e91582620d182e8` (deleted after exact-name verification).
- Copied example ID for **Rejected invalid bearer token (live)**: `55386880-8f845e0d-b81b-4184-9e03-eaf4b949fbfc`. Other examples are identified by their exact saved names below; their individual IDs were not extracted.

Fixture preparation inserted deterministic, labeled documents directly into the isolated database. It did not exercise signup, tour creation, upload or publication. Fixtures comprised three ACTIVE agents, a BLOCK agent, a USER, four public tours (including SOLD_OUT and legacy counters absent), and one DRAFT tour. The real RankingService was invoked from an isolated batch application context; this manual run did not wait for the daily cron schedule. Before recalculation, the public scores were zero. Afterward, public tour scores were 13, 8, 8 and 0, agent scores were 26, 5 and 5, and the DRAFT/BLOCK/USER scores were reset to zero.

All saved responses had HTTP 200; rejection results are identified by their GraphQL error codes, not HTTP status.

| Exact saved example name | Observed live result |
| --- | --- |
| Initial and legacy scores zero (live) | Four public tours at zero; DRAFT excluded |
| Tour ranking DESC with stable ties (live) | Scores 13, 8, 8, 0; equal-score IDs descending |
| Tour ranking ASC with stable ties (live) | Scores 0, 8, 8, 13; equal-score IDs ascending |
| Tour ranking page 1 (live) | IDs ending 100 and 500; total 4 |
| Tour ranking page 2 without duplicates (live) | IDs ending 200 and 400; total 4; no page overlap |
| Agent ranking DESC exact formulas and ties (live) | Agent A 26, C 5, B 5; total 3; BLOCK/USER absent |
| Agent ranking ASC with stable ties (live) | Agent B 5, C 5, A 26 |
| Tour agent profile and nested scores (live) | Tour 13, joined/profile agent 26, recent tour scores 13 and 8 |
| Legacy tour zero and public-tour agent contribution (live) | Legacy tour 0, agent 5, recent tour 0 |
| Rejected hidden DRAFT tour (live) | NOT_FOUND |
| Rejected propertyRank sort (live) | BAD_REQUEST with tour sort allowlist |
| Rejected memberRank sort (live) | BAD_REQUEST with agent sort allowlist |
| Rejected tourRank mutation input (live) | BAD_USER_INPUT: tourRank absent from TourUpdate |
| Rejected agentRank mutation input (live) | BAD_USER_INPUT: agentRank absent from MemberUpdate |
| Rejected invalid bearer token (live) | UNAUTHENTICATED |

Requests used No Auth except the deliberately invalid bearer string `invalid`. No valid access token or database credential was entered/saved in Postman. Score-write examples were rejected during GraphQL variable coercion before authentication/resolver execution; they verify the input contract, not a protected mutation executed by an authenticated owner. Blocked-token, admin/owner-list and production/load behavior were not part of this live pass. Existing automated coverage remains separately recorded above.

Each example retains its actual operation, Variables and response. The parent request was restored to No Auth with valid public tour-list Variables; no new environment or fixture ID/token variables were created. Example IDs and fixture IDs are now historical, and the temporary URL is no longer a running endpoint.

Cleanup compared all member/tour fields excluding the two ranking fields against the original fixture snapshot and confirmed they were unchanged, including counters and timestamps. It then verified the exact disposable database name, dropped it, and closed both temporary Nest applications. An earlier short-lived startup database `tl_rpm_6ac956d25adc41e14bbcb337` was also dropped with the same safety check when its input stream closed. Atlas rejected the original longer proposed prefix before fixtures could be inserted; use the shortened `tl_rpm_` prefix for future runs.

Task files: `docs/ranking.md` updated with this live record and corrected disposable-name prefix; `/private/tmp/triplink-ranking-live.ts` created for fixture setup, manual recalculation and guarded cleanup, then removed. No application code, environment files, existing Postman collections or development records/counters were changed by this live-testing task. No uploads were created. The pre-existing `docs/COMPLETED_TASKS.md` change was left untouched.
