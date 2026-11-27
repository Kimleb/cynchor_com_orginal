# Login diagnosis

The exact string “Authentication failed” has no matches under src. In POST /api/auth/login, an unknown handle and failed scrypt comparison return the same 401. Invalid input returns 400, and IP and handle limits separately return 429. The outer catch returns “Authentication failure.” for exceptions. LoginForm.handleSubmit displays the API error, falls back to “Invalid username or password.” for an unsuccessful response, and displays “Authentication error. Try again.” for fetch or JSON errors. GET /api/auth/me separately returns 401 with a null user for an absent, expired, invalid or revoked session.

## Development HTTP observations before fixes

| Scenario | Actual server terminal output | Finding |
| --- | --- | --- |
| Correct credentials, no signing key | POST /api/auth/login 500 in 803ms | Password passed. Cookie issuance failed. |
| Correct credentials, configured key | POST /api/auth/login 200 in 631ms | Login succeeds. |
| Wrong password, missing username in database | POST /api/auth/login 401 in 35ms and 401 in 34ms | Both returned “Invalid username or password.” |
| Claim followed immediately by login | POST /api/auth/claim 200 in 125ms, POST /api/auth/login 200 in 38ms, GET /api/auth/me 200 in 58ms | Claim and cookie persistence work on a fresh schema. |
| Expired signed session, then valid login | GET /api/auth/me 401 in 11ms, POST /api/auth/login 200 in 46ms | Expiry correctly requires another login. |
| Rapid valid logins | POST /api/auth/login 200 in 40ms, 200 in 39ms, 200 in 40ms, 200 in 40ms, 429 in 10ms | Two rapid logins work. The handle counter includes successes and never resets on success. |

Only the 500 produced an exception. The application stack was:

    login error: Error: SESSION_SECRET (min 32 chars) must be set
        at getSessionSecret (src/lib/session.ts)
        at createSignedSessionToken (src/lib/session.ts)
        at setSessionCookie (src/lib/session.ts)
        at POST (src/app/api/auth/login/route.ts)

Both signing and verification use the same key. HTTP development cookies worked with HttpOnly, SameSite=Lax and a root path. Secure is enabled in production. No stale-hash or email lookup was found in the username login route. These local results do not identify the configuration of a deployed instance.

On a copy of the main baseline database, createSecureInvite failed at stmt.run with “NOT NULL constraint failed: invites.email” (SQLITE 1299). CREATE TABLE IF NOT EXISTS retained main's required personal fields. PRAGMA also confirmed required email and name on users. The operator bootstrap script independently still wrote email and name and omitted username.

## Resolution

Successful cookie issuance now clears both login counters. The operator bootstrap accepts OPERATOR_USERNAME with the same callsign validation as login and writes the same scrypt format. Operator provisioning also enforces the login validator's 128-character password ceiling. Legacy schema repair is covered in the PII audit.

For local setup, generate a key with `openssl rand -hex 32` and save it as SESSION_SECRET in the ignored .env.local. The diagnostic worktree has a private generated key. For deployments, provision one stable secret through the deployment environment. Missing or short signing keys continue to fail closed.

## Final acceptance run

Final development HTTP results on the migrated fixture:

| Check | Terminal observation |
| --- | --- |
| Correct credentials | POST /api/auth/login 200 in 713ms |
| Wrong password and nonexistent handle | POST /api/auth/login 401 in 43ms and 401 in 37ms, with identical JSON error messages |
| Claim, sign in, reuse cookie | POST /api/auth/claim 200 in 126ms, POST /api/auth/login 200 in 56ms, GET /api/auth/me 200 in 107ms |
| Expired cookie, sign in again | GET /api/auth/me 401 in 8ms, POST /api/auth/login 200 in 48ms |
| Five more immediate valid logins | POST /api/auth/login 200 in 53ms, 43ms, 42ms, 48ms and 41ms |

The operator bootstrap also created a working handle on the migrated main database fixture. Core tests exercise both lockouts, successful reset and expiry, claim data storage and migration. The main suite passed 46 tests and the production build compiled and generated all 28 pages. Account queries use username. The only remaining schema references to legacy contact fields implement their removal. The privacy audit records the limits of the requested zero-personal-data assertion.
