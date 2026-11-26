# fintechcorp.local range target

Intentionally vulnerable Express + `node:sqlite` bank used by the Cynchor Fintech Range. All data is synthetic. Run it only inside an isolated range container.

```
npm install && PORT=8080 node server.js     # Node >= 22 (node:sqlite)
```

Env: `PORT` (default 8080), `HOST` (default 0.0.0.0), `RANGE_DB_PATH` (default in-memory), `NODE_ENV=production` disables seeding.
Seed logins: `guest`/`guest` (player foothold, account 3). The vault starts at $500,000.00 (50,000,000 cents).

## Vulnerabilities and MITRE ATT&CK mapping

IDs and names were checked against attack.mitre.org.

| # | Bug | Where | ATT&CK |
|---|-----|-------|--------|
| 1 | SQL injection in login (string-concatenated query) | `POST /login` | T1190 Exploit Public-Facing Application |
| 2 | IDOR: no ownership check on read/modify | `GET/POST /account/:id` | T1213 Data from Information Repositories (read); T1565.001 Data Manipulation: Stored Data Manipulation (modify) |
| 3 | Transfer flaw: no check on `fromId` owner, balance check skipped for negative amounts | `POST /transfer` | T1565.001 Data Manipulation: Stored Data Manipulation |
| 4 | Hidden back-office endpoints with no authentication (broken access control) | `/internal/admin/accounts`, `/internal/admin/vault` | T1190 Exploit Public-Facing Application; discovery by path guessing is T1595.003 Active Scanning: Wordlist Scanning |
| 5 | Boss chain: drain the Central Vault | see below | T1657 Financial Theft |

## Boss chain

1. Log in as `guest`. `GET /account/4` (IDOR) returns the Treasury account memo, which names `/internal/admin/vault`.
2. `POST /internal/admin/vault {"toId": 3}` (no auth) moves the whole vault balance into account 3. `GET /internal/admin/vault` then shows `balance_cents: 0`.

Proof tests: `tests/range-target/exploits.test.ts` (`npm run test:range-target` from the repo root).
