# Help Center

TripLink adapts Nestar's categorized FAQ accordion and dated notices presentation. Nestar's entries are hardcoded and its administration controls are placeholders; this database-backed API and management workflow are TripLink additions.

## Contract and rollout

The existing `notices` collection stores FAQs and notices. Existing FAQ/TERMS/INQUIRY enum values are preserved; this feature accepts FAQ and NOTICE only. HOLD is draft; ACTIVE is published. Creation defaults to HOLD and assigns the current admin as author. Any current ACTIVE admin can edit/publish/unpublish/delete an entry; its kind and author cannot be changed. Removal physically deletes the record. Legacy DELETE records and TERMS/INQUIRY are excluded from both Help Center lists.

FAQ topics are TOURS, BOOKINGS, PAYMENTS, ACCOUNTS, AGENTS, COMMUNITY and OTHER. A FAQ requires a topic; a notice rejects one. Title and content are trimmed plain text (3–150 and 3–10,000 characters). Text search is literal, case-insensitive, across title/content. FAQ-only/topic-filtered lists order by createdAt then _id ascending; notices and mixed-kind lists order descending. Page starts at 1; limit is 1–100. Empty metaCounter can be []; use metaCounter[0]?.total ?? 0.

Public `/help-center` defaults to FAQs, with Notices as the second tab; `/cs?tab=faq|notice` redirects preserving the valid selection. Admin routes are `/_admin/cs/faq` and `/_admin/cs/notice`. UI labels are translated into English/Korean/Russian; authored content stays in its entered language. Content renders as text with preserved line breaks. Inquiries, rich HTML, uploads, notifications and category management are excluded.

There is no startup seeding or automatic development-database write. Enter and publish reviewed starter content explicitly as an admin. Until then visitors see an empty state. No notices are seeded.

## Starter FAQs for manual admin entry

| Topic | Question | Answer |
| --- | --- | --- |
| Tours | How do I find a tour? | Browse Tours and filter by destination, category, price, dates, or difficulty. |
| Bookings | When are my seats reserved? | Creating a booking does not reserve seats. Seats are reserved when the agent confirms it. |
| Payments | Are payments real? | TripLink uses simulated payments for this portfolio application. |
| Accounts | How do I change my password? | Use the profile password-change form and provide your current and new passwords. |
| Agents | How do agents publish tours? | Agents create drafts, complete the required details, and submit them for admin approval. |
| Community | Does TripLink offer private messaging? | TripLink has a shared authenticated chat room. Private messaging is not available. |

## Postman setup

Actual Postman execution and saving live examples remain a separate task. The responses described here are expectations, not saved live examples.

Send HTTP POST `{{apiOrigin}}/graphql` using the configured PORT_API (commonly http://localhost:3007; do not assume it). Choose GraphQL body, paste the operation and its matching Variables JSON below. Headers: Content-Type application/json and Apollo-Require-Preflight true. Admin operations also need Authorization Bearer {{adminToken}} from a current ACTIVE ADMIN account. Public operations can omit authorization; a supplied invalid/expired/stale-account token is rejected. GraphQL failures may use HTTP 200; inspect errors[0].extensions.code.

Use a named disposable test environment/database, never development records. Prerequisites: running API connected to that verified disposable database, ACTIVE ADMIN/USER/AGENT fixtures and their tokens. Keep token values private. Save created entry IDs as helpEntryId and noticeEntryId. Never reuse deleted fixture IDs.

### Create draft FAQ

```graphql
mutation CreateHelpEntry($input: HelpEntryInput!) {
  createHelpEntry(input: $input) {
    _id noticeCategory faqTopic noticeStatus noticeTitle noticeContent memberId createdAt updatedAt
  }
}
```

```json
{"input":{"noticeCategory":"FAQ","faqTopic":"BOOKINGS","noticeTitle":"Disposable Help Center FAQ","noticeContent":"Seats are reserved when the agent confirms the booking."}}
```

ACTIVE ADMIN required. Expect HOLD, trimmed content, author matching the admin. Save _id as helpEntryId. A notice uses the same operation and this exact alternative Variables JSON:

```json
{"input":{"noticeCategory":"NOTICE","noticeTitle":"Disposable Help Center notice","noticeContent":"Disposable service notice.\nSecond line.","noticeStatus":"HOLD"}}
```

Save _id as noticeEntryId. USER/AGENT -> FORBIDDEN; missing token -> UNAUTHENTICATED. Disabled accounts -> FORBIDDEN; stale role/deleted account -> UNAUTHENTICATED. Invalid lengths/enums/unknown fields -> BAD_REQUEST or BAD_USER_INPUT. FAQ without topic and notice with topic -> BAD_REQUEST. No record should be created for rejected inputs.

### Public list

```graphql
query HelpEntries($input: HelpEntriesInquiry!) {
  getHelpEntries(input: $input) {
    list { _id noticeCategory faqTopic noticeStatus noticeTitle noticeContent createdAt updatedAt }
    metaCounter { total }
  }
}
```

```json
{"input":{"page":1,"limit":12,"search":{"noticeCategory":"FAQ","faqTopic":"BOOKINGS","text":"seats"}}}
```

No token required. Drafts are absent. Replace search with {"noticeCategory":"NOTICE"} for notices, or {} for all published Help Center entries. Test page 2 with limit 1 after creating two disposable published entries; assert no duplicates and a stable total. FAQ ascending and notice descending order have _id tie-breakers. page 0, limit 101, missing search, or NOTICE with faqTopic -> rejection; empty matches yield list [] and metaCounter [].

### Public detail

```graphql
query HelpEntry($entryId: String!) {
  getHelpEntry(entryId: $entryId) {
    _id noticeCategory faqTopic noticeStatus noticeTitle noticeContent createdAt updatedAt
  }
}
```

```json
{"entryId":"{{helpEntryId}}"}
```

No token required. HOLD/missing/deleted/legacy category -> NOT_FOUND. Malformed ID -> BAD_REQUEST. After publishing expect ACTIVE and complete plain text.

### Admin list

```graphql
query AllHelpEntries($input: AdminHelpEntriesInquiry!) {
  getAllHelpEntriesByAdmin(input: $input) {
    list { _id noticeCategory faqTopic noticeStatus noticeTitle noticeContent memberId createdAt updatedAt }
    metaCounter { total }
  }
}
```

```json
{"input":{"page":1,"limit":12,"search":{"noticeCategory":"FAQ","noticeStatus":"HOLD","faqTopic":"BOOKINGS","text":"Disposable"}}}
```

ACTIVE ADMIN required. Expect the draft fixture. Omit noticeStatus to see both HOLD/ACTIVE. TERMS/INQUIRY and legacy DELETE remain excluded. Role/token rejections match creation.

### Publish, edit, unpublish

```graphql
mutation UpdateHelpEntry($input: HelpEntryUpdate!) {
  updateHelpEntry(input: $input) {
    _id noticeCategory faqTopic noticeStatus noticeTitle noticeContent memberId createdAt updatedAt
  }
}
```

Publish Variables:

```json
{"input":{"entryId":"{{helpEntryId}}","noticeStatus":"ACTIVE"}}
```

Edit Variables:

```json
{"input":{"entryId":"{{helpEntryId}}","noticeTitle":"Edited disposable FAQ","noticeContent":"Edited plain text answer.\nSeats are reserved on confirmation.","faqTopic":"BOOKINGS"}}
```

Unpublish Variables:

```json
{"input":{"entryId":"{{helpEntryId}}","noticeStatus":"HOLD"}}
```

ACTIVE ADMIN required. After each successful change refetch public list/detail and admin list. Published entries appear publicly; edits are visible; unpublished entries disappear and public detail returns NOT_FOUND. Author and kind remain unchanged. Empty update/null fields -> BAD_REQUEST; spoofed author or kind -> BAD_USER_INPUT; missing/concurrently removed record -> NOT_FOUND. Repeat using noticeEntryId, omitting faqTopic entirely.

### Permanent removal and cleanup

```graphql
mutation RemoveHelpEntry($entryId: String!) {
  removeHelpEntry(entryId: $entryId)
}
```

```json
{"entryId":"{{helpEntryId}}"}
```

ACTIVE ADMIN required. Expect true. Repeat -> NOT_FOUND; public detail -> NOT_FOUND and both lists exclude it. UI confirmation names the entry and explains permanence. Remove noticeEntryId and every additional disposable fixture using the same operation. Do not delete development entries to demonstrate this feature. Verify the exact disposable database name before dropping it; close all temporary test apps and stop only servers started for the task.

## Validation record

Validation results and exact changed-file manifest are appended below after implementation acceptance. Automated/API/browser fixture results are distinct from actual Postman examples.

### Acceptance results — 2026-10-10

Passed backend `./node_modules/.bin/tsc --noEmit --incremental false`, whole-app non-fixing ESLint (`eslint apps --ext .ts`), three focused service unit tests and eight Help Center GraphQL integration tests. Integration tests use unique `tl_help_<ObjectId>` databases, assert the exact name before removal, close the application and restore the Mongo URI. The initial sandbox DNS attempt was stopped and rerun with network permission; the permitted run passed. An initial broad lint command used nonexistent libs/test globs; corrected whole-app lint passed.

Passed frontend `yarn typecheck`, all 14 existing `yarn test` tests, scoped non-fixing ESLint, `yarn validate:contracts` (62 documents, 15 Variables fixtures, zero errors), and `yarn test:integration`. Runtime smoke verified public/admin Help Center lists, hidden drafts, publishing, detail reads, editing, unpublishing, USER rejection and permanent deletion using actual HTTP GraphQL requests in a separate verified `tl_fe_e2e_<ObjectId>` database; cleanup passed. These HTTP results are not Postman executions or saved Postman examples. Both repository diff whitespace checks passed.

Live Chrome checks used a task-owned API on 3017 and frontend on 3018, an isolated temporary Next build directory and temporary same-origin proxy. The user's servers on 3000/3007 and development records were not changed. Verified desktop FAQ expansion, dated notice list and accessible full-text dialog, admin draft creation, publishing, editing, unpublishing and named permanent deletion. A separate public tab verified visibility after each lifecycle stage and displayed the edited plain-text answer with line breaks. Verified 390px mobile FAQ/search/topic controls, Help Center drawer link, notice list/dialog, and responsive admin notice list/create dialog without a FAQ-topic field. A full second admin lifecycle on mobile was interrupted by repeated native browser window/capture failures and is not claimed. Browser-emulated mobile is not a physical-device test; exhaustive viewport/locale/screen-reader acceptance and production build/load testing remain unverified.

Chrome surfaced MUI aria-hidden/focus warnings while opening/closing dialogs and the existing navigation drawer, plus an existing shared-chat WebSocket closure warning during viewport/layout changes. No Help Center GraphQL error or UI crash occurred in the verified lifecycle. These focus warnings need a separate focused accessibility review before claiming comprehensive assistive-technology acceptance; dependencies were not changed. Existing layout display-name and admin Link passHref lint issues were corrected in approved target files. Initial temporary preview cwd failure was corrected before browser acceptance.

Temporary disposable databases/uploads and isolated build directories were cleaned. Temporary API/preview listeners were stopped; the preview's remaining hung shutdown process was terminated by its exact task-owned PID. Starter FAQs remain documentation only. No dependency changes, startup seeding, development data edits, Git commits or Postman example saving occurred.

### Exact changed-file manifest

Backend paths relative to `/Users/a1234/Developer/trip-link`:

- `apps/trip-link/src/schemas/Notice.model.ts`: draft default, topic field, text constraints and lookup index.
- `apps/trip-link/src/libs/enums/notice.enum.ts`: NOTICE kind and seven FAQ topics.
- `apps/trip-link/src/components/components.module.ts`: feature registration.
- `apps/trip-link/src/libs/dto/help-center/help-center.ts`: entry/list GraphQL outputs.
- `apps/trip-link/src/libs/dto/help-center/help-center.input.ts`: create/search/pagination inputs.
- `apps/trip-link/src/libs/dto/help-center/help-center.update.ts`: immutable-kind update input.
- `apps/trip-link/src/components/help-center/help-center.module.ts`: auth/model registration.
- `apps/trip-link/src/components/help-center/help-center.resolver.ts`: six guarded operations.
- `apps/trip-link/src/components/help-center/help-center.service.ts`: visibility, CRUD, filtering, stable sorting and concurrent-deletion rules.
- `apps/trip-link/src/components/help-center/help-center.service.spec.ts`: focused business-rule regression coverage.
- `apps/trip-link/test/help-center.e2e-spec.ts`: disposable API lifecycle/validation/security coverage.
- `docs/help-center.md`: rollout, starter FAQs, exact Postman recipes and validation/file manifest.
- `docs/COMPLETED_TASKS.md`: appended this feature's completed result, preserving prior entries.

Frontend paths relative to `/Users/a1234/Developer/tripLInk-next`:

- `pages/help-center/index.tsx`: FAQ-default public route, tab navigation and translations.
- `pages/cs/index.tsx`: localized legacy redirect preserving faq/notice.
- `pages/_admin/cs/faq.tsx`, `pages/_admin/cs/notice.tsx`: protected management routes.
- `libs/components/cs/Faq.tsx`: categorized/filterable accordion with pagination and query states.
- `libs/components/cs/Notice.tsx`: dated list and fresh detail dialog.
- `libs/components/admin/cs/HelpCenterManager.tsx`: filters, CRUD editor, publication actions, submission lock and named deletion confirmation; pagination resets after mutations.
- `libs/types/triplink/index.ts`: Help Center wire contracts.
- `apollo/user/triplink.ts`, `apollo/admin/triplink.ts`: six typed operation documents.
- `libs/components/Top.tsx`, `libs/components/Footer.tsx`: Help Center links.
- `libs/components/layout/LayoutBasic.tsx`: heading/metadata and named layout function.
- `libs/components/admin/AdminMenuList.tsx`: labeled FAQ/notice links and passHref.
- `scss/pc/cs/cs.scss`: responsive scoped Help Center/plain-text styles.
- `public/locales/en/common.json`, `public/locales/kr/common.json`, `public/locales/ru/common.json`: interface translations.
- `scripts/contract-fixtures.cjs`, `scripts/validate-contracts.cjs`, `scripts/runtime-smoke.cjs`: new Variables/schema/runtime acceptance coverage.

Pre-existing/concurrent clear-navigation edits in Top.tsx, scss/triplink.scss and the earlier completion-log entry were preserved; the clear-header behavior and scss/triplink.scss change are not part of this Help Center patch.
