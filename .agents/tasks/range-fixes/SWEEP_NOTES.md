# Bug sweep notes (FEAT-002 item 6)

Reviewed with evidence and left unchanged (out of scope or not a bug):

- `npm run lint` (`next lint`): no ESLint config or eslint dependency exists, so the command opens an interactive setup prompt and never exits non-interactively. `package.json:9`. Adding eslint is a new dependency/feature, so it was not done. Type checking (`npx tsc --noEmit`) is clean.
- `src/app/api/range/leaderboard/route.ts`: authenticated but not rate limited (other range GET routes are not either). Read-only, parameterized SQL, validated filters. Low risk.
- `src/app/range/leaderboard/page.tsx:20-21`: when a filter request fails, the whole page is replaced by the error text, hiding the filters, so the user must reload. Also no guard against an out-of-order response. UI behaviour change, left for the owner.
- `src/app/api/auth/profile/route.ts:12`, `src/app/api/admin/route.ts:55`, `src/app/api/teams/route.ts:74`: `await req.json()` without catch, so a malformed body returns 500 instead of 400 (handled by the outer catch, no crash). Pre-existing non-range routes.
- `src/app/api/disclaimer/route.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/access-request/route.ts` do not call getCurrentUser. They are the pre-existing public routes (login, access request, disclaimer); no new unauthenticated route was added.
- `src/lib/range-runtime/lobby.ts joinRangeQueue`: pairing runs in BEGIN IMMEDIATE and node:sqlite is synchronous in one process, so concurrent joins cannot double-match. The pre-checks outside the transaction cannot interleave. Not a bug.
- `events/route.ts`: interval is cleared on abort, on `cancel()` and on end. Not a bug. `useRangeEvents` closes the EventSource on unmount (browser run showed no console errors).
- Tests use ephemeral ports (`listen(0)`) and one `.test.sqlite*` file per test file; remaining sleeps are bounded polling loops. No flaky pattern found.
- `src/lib/session.ts`, `src/lib/guards.ts`, `src/middleware.ts`: not touched, nothing reported.
