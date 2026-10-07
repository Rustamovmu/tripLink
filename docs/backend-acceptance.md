# TripLink backend acceptance

## Scope and reference

Backend acceptance covers authentication, roles, tours, bookings and simulated payment, follows, public profiles, reviews, favorites and visits, community articles, uploads, shared WebSocket chat, and scheduled unpaid-booking expiry. Frontend work and notifications are excluded.

Nestar is the module/resolver/service and shared-chat reference. Its API and batch test directories contain starter welcome tests, not an equivalent feature acceptance suite. Nestar has no booking-settlement implementation or TripLink's current-account and transactional-counter guarantees.

## Recorded validation — 2026-10-08

| Check | Recorded result |
| --- | --- |
| Non-writing TypeScript check | Passed, exit 0 |
| Whole-repository non-fixing ESLint | Passed, 0 errors and 0 warnings |
| All unit tests | 10 suites, 91 tests passed (2.772 s) |
| All API integration tests | 11 suites, 137 tests passed (111.454 s), including the API smoke/profile tests |
| All batch integration tests | 2 suites, 14 tests passed (17.633 s) |
| Diff whitespace check | Passed |

Total: **242 passing tests across 23 suites**. No test was excluded from these configured suites. Both integration commands exited 0 after fixture database cleanup and application closure. No development records or counters were changed. No persistent server was started; the user's process on port 3007 was left untouched.

There are no existing lint failures in this pass. Prettier still reports an existing ignored `extends: "eslint:recommended"` option when formatting approved files; this is a formatting-config warning, not an ESLint failure. Expected negative-request logs include GraphQL rejection errors, the deliberately injected article cleanup failure, and WebSocket oversized-payload rejection. They accompanied passing assertions.

This verifies the current automated suites, not production deployment, a load test, or real Postman runs. The batch cron callback is registered and triggered directly in integration tests; the 1,000-candidate cap and retained progress are tested with unit mocks, with 101 real MongoDB candidates verifying actual pagination.

## Reproduce the checks

Run from the repository root with installed dependencies. Integration tests require `MONGO_DEV` pointing to a reachable MongoDB replica set that supports transactions. They substitute a uniquely named disposable database; they must not run with `NODE_ENV=production`. Never copy credentials into reports or Postman examples.

```sh
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/eslint "{src,apps,libs,test}/**/*.ts"
./node_modules/.bin/jest --runInBand --no-cache --silent
node -r dotenv/config ./node_modules/jest/bin/jest.js --config apps/trip-link/test/jest-e2e.json --runInBand --no-cache --silent
node -r dotenv/config ./node_modules/jest/bin/jest.js --config apps/batch/test/jest-e2e.json --runInBand --no-cache --silent
git diff --check
```

Do not use `npm run lint` for verification: it includes `--fix`. Type checking above does not emit build files or an incremental cache. Jest commands do not generate coverage artifacts.

Each integration suite closes its application and removes its disposable database after checking the exact name. Upload tests use a temporary storage root and delete it; chat tests use an ephemeral local port and terminate their clients. No existing development member, booking, counter, or upload is a fixture. Rejection tests intentionally log GraphQL errors; judge results by Jest's assertions and exit status.

The API smoke test validates the current TripLink welcome response. The profile suite guards against production execution and checks the disposable database before fixture writes and cleanup. These are test changes, with no application API, DTO, schema, role, or UI change.

## Coverage and practical limits

| Area | Acceptance behavior |
| --- | --- |
| Authentication | Current member status and role checked against MongoDB; expired/invalid tokens and stale roles rejected; anonymous public requests allowed |
| Tours | Agent ownership; admin publication/status changes; seat/date restrictions; input validation; stable sorting; supplied-token validation |
| Bookings | Confirmation, rejection, cancellation, payment, completion, expiry and refund; ownership/role checks; duplicate and concurrent requests; seat restoration and settlement constraints |
| Follows/profiles | USER and AGENT follow relationships, counters, pagination, privacy, and public-tour review/rating aggregates |
| Reviews | Completed-booking eligibility, uniqueness, owner edits/removal, moderation and transactional ratings |
| Favorites/visits | USER and AGENT access, unique visits, exact counters, concurrent toggles and cancellation races |
| Articles | Immediate publication by AGENT/ADMIN, optional authentication, privacy, filtering, ownership, unique views, like toggles, deletion races and transactional hard-removal cleanup |
| Uploads | Real multipart PNG requests and static bytes/headers; roles, file validation, traversal rejection and cleanup |
| Chat | Real WebSocket clients, all three active roles, broadcast, last-five history, validation, account changes, expiry and cleanup |
| Batch | Default-disabled scheduling, cutoff eligibility, bounded progress, transaction rollback, independent workers, admin/payment races and shutdown waiting |

Unit tests use mocks where indicated. Integration tests use real MongoDB, HTTP and WebSocket clients; selected fault/race tests inject failures or pause a real transaction. These are automated integration results, **not saved Postman response examples**.

Payment and refunds are simulated. Chat is one shared room with only the latest five messages in process memory; history disappears on restart and is not shared across server instances. Private conversations, article comments and notifications are not provided by this acceptance scope. JWT logout/password-change revocation and refresh tokens are not implemented; restoring status or reverting a role can re-enable an older unexpired matching-role token. Account validation does not revoke an already executing request.

Scheduled expiry runs every minute in the batch app only when `BATCH_BOOKING_EXPIRY_ENABLED=true`. It handles departed UNPAID PENDING/CONFIRMED bookings, at most 1,000 scanned per pass in pages of 100. Progress is in memory, inconsistent records are skipped/logged, and PAID/REFUNDED bookings require their existing manual settlement operations. It uses transactions across workers but does not add a distributed scheduler lock. Do not enable it against a database whose eligible records you intend to preserve during testing.

## Reusable Postman Variables

The usual endpoint is `http://localhost:3007/graphql`. These are Variables templates, not a collection export or complete GraphQL operations. Object-input examples assume the operation declares `$input`; scalar examples explicitly name the declared variable. If a saved operation declares a different variable, use that exact name. Resolver argument names alone do not determine Variables keys.

All IDs below are placeholders: replace them with IDs returned by fresh disposable fixtures. Historical example IDs may have been deleted and cannot be reused. Use an access token belonging to a real ACTIVE member of the stated role; supplying an invalid or disabled-account token to an optional-auth query is rejected. Keep tokens in local Postman authorization/environment settings, never in checked-in guides or saved response bodies.

For manual writes, first use a dedicated test server connected to a uniquely named disposable database, with real USER, AGENT and ADMIN fixture records. Signup cannot create ADMIN accounts. Start only your own server on a free port; adjust the endpoint if 3007 belongs to an existing server. Provision the ADMIN fixture in that disposable database, not by promoting a development member. Close your own server afterward. Use the automated suites for past-departure and race fixtures; do not change development dates to simulate them.

### Signup, login and authentication

`Signup`: no token. Use a unique nickname/email for each disposable run; change `memberType` to `AGENT` for the agent fixture.

```json
{"input":{"memberNick":"tltest-user-001","memberPassword":"TestPass123!","memberEmail":"tltest-user-001@example.com","memberAuthType":"EMAIL","memberType":"USER"}}
```

`Login`: no token; returns an access token for the current account.

```json
{"input":{"memberNick":"tltest-user-001","memberPassword":"TestPass123!"}}
```

`CheckAuth`: any ACTIVE role/access token; `CheckAuthRoles`: USER/AGENT token.

```json
{}
```

### Public lists, member profiles and follows

`GetTours`, `GetAgents`, `GetBoardArticles`: anonymous or a valid token; `$input`.

```json
{"input":{"page":1,"limit":10,"search":{}}}
```

`GetMember`: anonymous or valid token; declares `$memberId`.

```json
{"memberId":"DISPOSABLE_MEMBER_ID"}
```

`ToggleFollowMember`: USER/AGENT token; declares `$memberId`. Target another ACTIVE USER/AGENT; do not follow yourself.

```json
{"memberId":"DISPOSABLE_OTHER_MEMBER_ID"}
```

`GetMemberFollowers`, `GetMemberFollowings`: anonymous or valid token; `$input`.

```json
{"input":{"page":1,"limit":10,"search":{"memberId":"DISPOSABLE_MEMBER_ID"}}}
```

### Tours, favorites and visits

`CreateTour`: AGENT token; `$input`. Replace both dates with future dates before each run. Returned departures have IDs needed by bookings. Creation produces DRAFT; the owning agent submits PENDING, then ADMIN approves ACTIVE.

```json
{"input":{"tourTitle":"Disposable Seoul tour","tourDescription":"[DISPOSABLE API TEST] A guided city tour for acceptance testing.","tourDestination":"Seoul","tourCountry":"South Korea","tourCity":"Seoul","tourImages":[],"tourPrice":100,"tourDurationDays":1,"tourAvailableDates":[{"startDate":"2099-10-10T09:00:00.000Z","endDate":"2099-10-10T18:00:00.000Z","availableSeats":4}],"tourAvailableSeats":4,"tourMaxGroupSize":4,"tourCategory":"CITY","tourDifficulty":"EASY","tourLanguages":["English"],"tourTransportation":[],"tourMeals":[],"tourItinerary":[],"tourIncludedServices":[],"tourExcludedServices":[]}}
```

`UpdateTour`: owning AGENT token; `$input`, submit for approval.

```json
{"input":{"tourId":"DISPOSABLE_TOUR_ID","tourStatus":"PENDING"}}
```

`UpdateTourByAdmin`: ADMIN token; `$input`, approve a pending tour.

```json
{"input":{"tourId":"DISPOSABLE_TOUR_ID","tourStatus":"ACTIVE"}}
```

`GetTour`: anonymous or valid token; authenticated USER/AGENT reads count visits. `ToggleFavoriteTour`: USER/AGENT token. Both templates assume `$tourId`.

```json
{"tourId":"DISPOSABLE_ACTIVE_TOUR_ID"}
```

`GetFavoriteTours`, `GetVisitedTours`: USER/AGENT token; `$input`.

```json
{"input":{"page":1,"limit":10}}
```

### Bookings and simulated settlement

`CreateBooking`: USER token; public eligible tour with a future departure, using its returned departure ID; `$input`.

```json
{"input":{"tourId":"DISPOSABLE_ACTIVE_TOUR_ID","tourDateId":"DISPOSABLE_DEPARTURE_ID","numberOfPeople":1}}
```

`ConfirmBooking`: owning AGENT token. `PayBooking`: booking owner's USER token. `ExpireBookingByAdmin`: ADMIN token. `CompleteBooking`: owning AGENT token. For operations declaring `$input: String!` and passing it to `bookingId`, use:

```json
{"input":"DISPOSABLE_BOOKING_ID"}
```

The existing saved PayBooking operation uses this `input` key. Payment requires an unpaid CONFIRMED booking before departure on an eligible tour. Expiry requires an unpaid PENDING/CONFIRMED booking after departure. Completion requires a paid CONFIRMED booking after its end and the existing tour eligibility rules. Use separate disposable bookings for incompatible terminal paths.

`CancelBooking`: booking owner's USER token, unpaid and before departure; `$input`.

```json
{"input":{"bookingId":"DISPOSABLE_BOOKING_ID","cancellationReason":"[DISPOSABLE API TEST] Cancel unpaid booking."}}
```

`RejectBooking`: owning AGENT token for a PENDING booking; `$input`.

```json
{"input":{"bookingId":"DISPOSABLE_PENDING_BOOKING_ID","rejectionReason":"[DISPOSABLE API TEST] Reject pending booking."}}
```

`RefundBookingByAdmin`: ADMIN token; paid booking meeting refund eligibility, including cancelled-tour requirements after departure; `$input`.

```json
{"input":{"bookingId":"DISPOSABLE_PAID_BOOKING_ID","refundReason":"[DISPOSABLE API TEST] Simulated refund."}}
```

`GetMyBookings`: USER token; `GetAgentBookings`: AGENT token; `GetAllBookingsByAdmin`: ADMIN token; `$input`.

```json
{"input":{"page":1,"limit":10,"search":{}}}
```

### Reviews

`CreateReview`: booking owner's USER token; a paid COMPLETED booking without an existing review; `$input`.

```json
{"input":{"bookingId":"DISPOSABLE_COMPLETED_BOOKING_ID","reviewRating":5,"reviewComment":"[DISPOSABLE API TEST] Review a completed trip."}}
```

`GetTourReviews`: anonymous or valid token; `$input`.

```json
{"input":{"page":1,"limit":10,"search":{"tourId":"DISPOSABLE_PUBLIC_TOUR_ID"}}}
```

`GetPublicAgentReviews`: anonymous or valid token; declares `$agentId` and `$input`.

```json
{"agentId":"DISPOSABLE_AGENT_ID","input":{"page":1,"limit":10,"search":{}}}
```

`ModerateReviewByAdmin`: ADMIN token; `$input`.

```json
{"input":{"reviewId":"DISPOSABLE_REVIEW_ID","reviewStatus":"HIDDEN","moderationReason":"[DISPOSABLE API TEST] Verify moderation."}}
```

### Community articles

`CreateBoardArticle`: AGENT/ADMIN token; immediately ACTIVE; `$input`.

```json
{"input":{"articleCategory":"FREE","articleTitle":"Disposable travel article","articleContent":"[DISPOSABLE API TEST] Plain text article for acceptance testing."}}
```

`GetBoardArticle`: anonymous or valid token. `LikeTargetBoardArticle`: any ACTIVE USER/AGENT/ADMIN token. `RemoveBoardArticleByAdmin`: ADMIN token, already DELETE article. These templates assume `$articleId`.

```json
{"articleId":"DISPOSABLE_ARTICLE_ID"}
```

`UpdateBoardArticle`: AGENT/ADMIN owner token; `UpdateBoardArticleByAdmin`: ADMIN token; `$input`, soft deletion is terminal.

```json
{"input":{"_id":"DISPOSABLE_ARTICLE_ID","articleStatus":"DELETE"}}
```

`GetAllBoardArticlesByAdmin`: ADMIN token; `$input`.

```json
{"input":{"page":1,"limit":10,"search":{"articleStatus":"DELETE"}}}
```

### Upload Variables

`ImageUploader`: valid token; USER/AGENT/ADMIN for member/article images, AGENT/ADMIN for tour images. Declares `$file` and `$target`; the file must be mapped through GraphQL multipart upload, not submitted as a JSON string.

```json
{"file":null,"target":"member"}
```

`ImagesUploader`: declares `$files` and `$target`; each null requires its own multipart mapping and file.

```json
{"files":[null],"target":"tour"}
```

### Expected results and cleanup

Successful requests populate their operation's `data` field without GraphQL errors. A successful HTTP 200 alone does not establish GraphQL success. Inspect `errors[].extensions.code`: invalid/stale tokens yield `UNAUTHENTICATED`; disabled accounts and denied roles yield `FORBIDDEN`; input errors yield `BAD_REQUEST` (GraphQL coercion may use a GraphQL validation code); absent/ineligible targets and invalid state transitions use the service's `NOT_FOUND`, `CONFLICT` or `BAD_REQUEST` conventions. Database failures remain server errors.

Check that duplicate/denied mutations do not change records or counters. Repeated likes, favorites and follows are toggles, not duplicate-create rejection cases. Authenticated article detail views count once per member; anonymous reads do not increment views. Soft-deleted articles disappear from public lists; permanent article removal deletes only its ARTICLE relationships.

This pass does not create or update a Postman collection and saves no Postman live examples. When actual Postman testing is requested, send real requests, save clearly named success/rejection examples labelled `(live)`, distinguish fault-injected results from ordinary live responses, and remove access tokens from saved data. WebSocket messages use the existing chat event contract, not GraphQL Variables; full connection/setup instructions are a separate request.

Remove fixtures only from the exact dedicated disposable database after recording results, then drop that database after verifying its full expected name. Remove only the test server's temporary upload directory, close chat clients, and stop the server you started. Do not change development records or counters. Since all fixtures and counters belong to the disposable database, dropping it removes their increments together. Clear fixture IDs from active Postman Variables; saved example IDs are historical afterward.
