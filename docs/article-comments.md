# Article comments

## Behavior and architecture

Nestar's comment module/resolver/service, DTOs and schema are the architectural reference. TripLink exposes only article comments: `commentGroup` is assigned ARTICLE by the server, and ownership comes from the authenticated token. MEMBER/TOUR values remain in the existing storage enum but have no comment operations. Tour reviews remain booking-linked and separate.

Any ACTIVE USER, AGENT or ADMIN can create comments. Public lists expose ACTIVE comments only on ACTIVE articles. A supplied token must be valid for a current ACTIVE account and matching role. Owners may edit their ACTIVE comments on ACTIVE articles, or soft-delete them even on a hidden article. Deletion is terminal. Admins may list comments on active or hidden articles, optionally filter status, soft-delete active comments, and hard-remove already deleted comments. Admin moderation cannot rewrite another member's content.

Content is trimmed and limited to 1–100 characters. IDs must be 24-character MongoDB IDs. Pagination requires page >= 1 and limit 1–100; sorts are createdAt/updatedAt with ASC/DESC and an ID tie-breaker. Author data uses a public-field allowlist; credentials/contact fields are never returned, and missing authors yield null.

Create, edit, soft-delete and hard-remove operations update the parent's ACTIVE ARTICLE comment count within the same transaction. Parent writes serialize comment changes against article deletion; transaction retries recheck ownership and visibility. Comment activity updates the parent article's updatedAt. Article hard-removal deletes ARTICLE comments of both statuses along with ARTICLE likes/views in the same transaction. Other groups are untouched. Article soft-deletion hides comments without erasing them.

The existing comments collection is reused; content trim/length validators apply to future validated writes, without rewriting existing records. No migration or frontend changes are included. Multiple comments per member/article are allowed. Replies, comment likes and notifications are outside this feature.

## Postman setup and disposable fixtures

Use POST `http://localhost:3007/graphql` for a server running on that port. Prefer your own test server on a free port (for example `http://localhost:3017/graphql`), connected to a uniquely named disposable database on a transaction-capable replica set. Never point write tests at development records, and do not stop an existing server. Set `Content-Type: application/json`. In Postman's GraphQL body, paste the operation and its matching Variables JSON below. Set Authorization to Bearer Token for authenticated operations; keep tokens local and out of saved examples.

Create disposable ACTIVE USER, second USER, AGENT and ADMIN fixtures. Use signup/login for ordinary roles; provision ADMIN only in the exact disposable database (signup cannot create admins). Mark fixture names `[DISPOSABLE]` or use a unique `tltest-` prefix. Use returned IDs and fresh access tokens; placeholder IDs below must be replaced with actual 24-character IDs. Never reuse deleted fixture IDs.

Create the parent with the AGENT token:

```graphql
mutation CreateCommentFixture($input: BoardArticleInput!) {
  createBoardArticle(input: $input) { _id articleStatus articleComments }
}
```

```json
{"input":{"articleCategory":"FREE","articleTitle":"[DISPOSABLE] Comment test","articleContent":"[DISPOSABLE] Article comment verification fixture."}}
```

Expected: ACTIVE, articleComments 0. Save `_id` as ARTICLE_ID.

## Create: any ACTIVE role

```graphql
mutation CreateComment($input: CommentInput!) {
  createComment(input: $input) {
    _id commentRefId commentGroup commentStatus commentContent memberId
    memberData { memberNick memberImage }
  }
}
```

```json
{"input":{"commentRefId":"ARTICLE_ID","commentContent":"  Helpful travel story!  "}}
```

Expected: no errors; ACTIVE ARTICLE comment, trimmed content, token member's memberId. Save `_id` as COMMENT_ID. Repeat with USER, AGENT and ADMIN tokens to verify all roles. Every successful creation increases articleComments by one.

Rejections: no/invalid token -> UNAUTHENTICATED; blocked/suspended/pending fixture account -> FORBIDDEN; deleted account or stale-role token -> UNAUTHENTICATED. Missing/deleted article -> NOT_FOUND. Invalid ID or whitespace/101-character content -> BAD_REQUEST. Injecting memberId, commentGroup or counters into Variables -> BAD_USER_INPUT. All rejections must leave records/counts unchanged. Account-status rejection fixtures must belong only to the disposable database; restore their status or remove the whole disposable database afterward.

## Public list: anonymous or valid ACTIVE token

```graphql
query GetComments($input: CommentsInquiry!) {
  getComments(input: $input) {
    list { _id commentContent commentStatus memberId memberData { memberNick } }
    metaCounter { total }
  }
}
```

```json
{"input":{"page":1,"limit":10,"sort":"createdAt","direction":"DESC","search":{"commentRefId":"ARTICLE_ID"}}}
```

Expected: only ACTIVE ARTICLE comments and a matching total. Empty results return list [] and metaCounter []. Try limit 1/page 1 then page 2: IDs differ with stable ordering. Listing does not increase article views.

Rejections: supplied invalid token -> UNAUTHENTICATED; hidden/missing article -> NOT_FOUND; page 0, limit 101, unsupported sort or malformed ID -> BAD_REQUEST. A status filter is not accepted by the public input -> BAD_USER_INPUT.

## Owner edit and soft-delete: owning ACTIVE member token

```graphql
mutation UpdateComment($input: CommentUpdate!) {
  updateComment(input: $input) { _id commentContent commentStatus }
}
```

Edit Variables:

```json
{"input":{"_id":"COMMENT_ID","commentContent":"Updated travel feedback."}}
```

Expected: content updated, status ACTIVE, articleComments unchanged.

Soft-delete Variables for the same operation:

```json
{"input":{"_id":"COMMENT_ID","commentStatus":"DELETE"}}
```

Expected: DELETE; articleComments decreases once and public list excludes the comment. Owner deletion remains available on a hidden parent article; editing its content fails NOT_FOUND.

Rejections: another member token -> NOT_FOUND; repeat deletion/edit after deletion -> NOT_FOUND; empty patch, null/invalid content or requesting ACTIVE status -> BAD_REQUEST. Missing token -> UNAUTHENTICATED. To test ownership, use the second disposable USER token, not a development account.

## Admin list: ACTIVE ADMIN token

```graphql
query GetAllCommentsByAdmin($input: AllCommentsInquiry!) {
  getAllCommentsByAdmin(input: $input) {
    list { _id commentContent commentStatus memberId memberData { memberNick } }
    metaCounter { total }
  }
}
```

```json
{"input":{"page":1,"limit":10,"sort":"createdAt","direction":"DESC","search":{"commentRefId":"ARTICLE_ID","commentStatus":"DELETE"}}}
```

Expected: deleted comments included, even when the article is hidden. Omit commentStatus to list both statuses. USER/AGENT tokens -> FORBIDDEN; missing token -> UNAUTHENTICATED; missing parent -> NOT_FOUND.

## Admin soft-delete: ACTIVE ADMIN token

Create a fresh ACTIVE comment first; use its ID here.

```graphql
mutation UpdateCommentByAdmin($input: CommentUpdate!) {
  updateCommentByAdmin(input: $input) { _id commentStatus commentContent }
}
```

```json
{"input":{"_id":"ACTIVE_COMMENT_ID","commentStatus":"DELETE"}}
```

Expected: DELETE with original content retained and count decreased once. USER/AGENT tokens -> FORBIDDEN. Text edits or ACTIVE status -> BAD_REQUEST; already deleted/missing comment -> NOT_FOUND.

## Admin hard-remove: ACTIVE ADMIN token

Prerequisite: comment already has DELETE status.

```graphql
mutation RemoveCommentByAdmin($commentId: String!) {
  removeCommentByAdmin(commentId: $commentId) { _id commentStatus }
}
```

```json
{"commentId":"DELETED_COMMENT_ID"}
```

Expected: returns the removed DELETE comment; it disappears from admin lists, while articleComments remains unchanged. Active comment -> CONFLICT; missing comment -> NOT_FOUND; malformed ID -> BAD_REQUEST; USER/AGENT token -> FORBIDDEN.

## Verify counters, parent removal and cleanup

Use an anonymous read so this check adds no view records:

```graphql
query VerifyCommentCount($articleId: String!) {
  getBoardArticle(articleId: $articleId) { _id articleComments }
}
```

```json
{"articleId":"ARTICLE_ID"}
```

After each create/delete, compare articleComments against the public list's total. After an edit/hard-remove of a deleted comment, the count stays unchanged. For an empty list, metaCounter is [], representing zero.

Soft-delete the disposable article with its owning AGENT token:

```graphql
mutation HideCommentFixture($input: BoardArticleUpdate!) {
  updateBoardArticle(input: $input) { _id articleStatus }
}
```

```json
{"input":{"_id":"ARTICLE_ID","articleStatus":"DELETE"}}
```

Expected: article DELETE; public comment reads/creates and content edits reject NOT_FOUND. Admin list and comment removal still work.

Then hard-remove the article with ADMIN:

```graphql
mutation RemoveCommentFixture($articleId: String!) {
  removeBoardArticleByAdmin(articleId: $articleId) { _id articleStatus }
}
```

```json
{"articleId":"ARTICLE_ID"}
```

Expected: removed article returned; its ARTICLE comments, likes and views are removed transactionally. Hard-removing an ACTIVE article rejects CONFLICT. Verify fixture records with read-only checks against the exact disposable database.

Finish by verifying the exact uniquely named database before dropping it, removing all remaining disposable members/articles, and stopping only your own test server. Do not manually decrement development counters. This workflow creates no changes to development fixtures; dropping the isolated fixture database removes its counters as well. Saved response examples, if requested later, must clearly say `LIVE — disposable article comments` and contain no tokens; their deleted IDs are historical.

## Automated validation

```sh
./node_modules/.bin/tsc --noEmit --incremental false
./node_modules/.bin/eslint "{src,apps,libs,test}/**/*.ts"
./node_modules/.bin/jest --runInBand --no-cache --silent
node -r dotenv/config ./node_modules/jest/bin/jest.js --config apps/trip-link/test/jest-e2e.json --runInBand --no-cache --silent comment.e2e-spec board-article.e2e-spec
git diff --check
```

Integration suites reject production execution, select uniquely named disposable databases, verify the exact names before dropping them, close their applications, and restore the MongoDB environment. Fault/race tests inject controlled pauses or failures around real MongoDB transactions. These are automated HTTP/MongoDB responses, not Postman live examples. No Postman collection or saved live response was created by implementation.

## Recorded results — 2026-10-08

- Non-writing TypeScript check: passed.
- Whole-repository non-fixing ESLint: passed, zero errors/warnings.
- All unit suites: 94 tests passed across 11 suites.
- Focused article/comment integration suites: 22 tests passed across 2 suites (12 article, 10 comment).
- Diff whitespace check: passed.
- Disposable fixture databases were dropped and applications closed. No development records/counters were modified, and no persistent server was started.

The first sandbox integration attempt failed on MongoDB DNS. With network access, the article tests passed but the new comment suite's database name exceeded the host's 38-byte limit during setup. The name was shortened before the successful run. Initial TypeScript/lint issues in the new implementation/test helpers were corrected. The existing Prettier configuration emits an ignored-option warning; final ESLint passes. The complete API/batch integration suites were not rerun for this focused change; the earlier acceptance guide records the previous full pass.

## Exact changed files

| File | Change |
| --- | --- |
| apps/trip-link/src/components/comment/comment.module.ts | New comment model registration and auth/resolver/service module |
| apps/trip-link/src/components/comment/comment.resolver.ts | New public, owner and admin GraphQL operations |
| apps/trip-link/src/components/comment/comment.service.ts | New validation, visibility/privacy checks and transactional counters |
| apps/trip-link/src/components/comment/comment.service.spec.ts | New validation/session unit coverage |
| apps/trip-link/src/libs/dto/comment/comment.ts | New GraphQL comment/list output types |
| apps/trip-link/src/libs/dto/comment/comment.input.ts | New creation, public/admin search and pagination inputs |
| apps/trip-link/src/libs/dto/comment/comment.update.ts | New owner/admin update input |
| apps/trip-link/src/schemas/Comment.model.ts | Content trimming and 1–100 length validation |
| apps/trip-link/src/components/components.module.ts | Register CommentModule |
| apps/trip-link/src/components/board-article/board-article.module.ts | Register comment model for cleanup |
| apps/trip-link/src/components/board-article/board-article.service.ts | Transactional ARTICLE comment cleanup on hard-removal |
| apps/trip-link/src/components/board-article/board-article.service.spec.ts | Adapt constructor fixture to comment-model injection |
| apps/trip-link/test/board-article.e2e-spec.ts | Comment cleanup, group isolation and failure rollback coverage |
| apps/trip-link/test/comment.e2e-spec.ts | New permissions, visibility, privacy, count, rollback and race integration coverage |
| docs/article-comments.md | Architecture, Postman workflow, validation results and change inventory |

Suggested commit: `feat: add article comments with ownership and admin moderation`.
Next proposed backend task: actual Postman verification with clearly named live disposable-fixture examples, under separate approval.
