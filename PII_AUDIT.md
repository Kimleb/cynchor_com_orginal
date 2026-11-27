# Account data audit

The existing account commit left personal columns on fresh and migrated SQLite databases. The original checkout's local database also had users.email and users.name (read-only schema inspection). This branch removes users.email, users.name, access_requests.email, access_requests.name and invites.email. There is no Prisma schema. getDb initializes the active SQLite database selected by CYNCHOR_DB_PATH.

The verified users column list on a migrated copy is id, username, password_hash, role, experience_level, is_profile_completed, is_operator, created_at and session_version. Foreign-key check returned zero violations and invite creation succeeded. A transaction copies retained columns including IDs, credentials, privileges, session versions and token state, redacts historical email-bearing audit fields and lockout details, and restores the append-only trigger. Old email-bound invites are retired so their original restriction cannot be lost. Operators can issue replacements.

Existing valid handles survive. Records missing a usable handle receive the known seed callsign where applicable or a unique pseudonym. Operators can retrieve the assigned handle from the account list. Migration runs on application database initialization. The working checkout and production databases were not migrated in place.

## Player identity and logs

Login (success/failure), claim/reset, logout, admin approvals/invites/provisioning and the match-created audit event use callsigns for actor identity. Invite consumption and operator bootstrap use handles in detail text. Access-request audit events contain opaque request ID and source. Match-end uses a session ID. Lockout audit details previously included the rate-limit key, which could contain a raw network address. New details omit the key. Audit timestamps, opaque event IDs and keyed IP hashes are retained. No account password, signing key or request body is explicitly logged by these paths.

Admin roster, assigned invites, approvals, provisioning and reset displays use handles. Internal IDs identify rows and reset targets. The claim form, login form, session endpoint, dashboard, team roster and profile routes use username or an opaque internal identifier. Contact email fields are absent from these account queries.

This proves absence of dedicated contact and real-name fields on the tested schemas. An optional access-request note can contain personal information supplied by its author and is shown to operators. Users may choose identifying handles. The separate disclaimer table stores a truncated user agent and a keyed IP hash. Audit IP hashes are pseudonymous and linkable. Runtime exceptions and infrastructure logs are not a guarantee about arbitrary deployed log contents. A blanket zero-personal-data claim would exceed this evidence.

## Console inventory

- `scripts/create-operator.ts:10` — fixed validation diagnostic or validated callsign.
- `scripts/create-operator.ts:14` — fixed validation diagnostic or validated callsign.
- `scripts/create-operator.ts:22` — fixed validation diagnostic or validated callsign.
- `scripts/create-operator.ts:32` — fixed validation diagnostic or validated callsign.
- `src/app/api/access-request/route.ts:59` — exception handler.
- `src/app/api/admin/route.ts:221` — exception handler.
- `src/app/api/admin/route.ts:48` — exception handler.
- `src/app/api/auth/claim/route.ts:120` — exception handler.
- `src/app/api/auth/login/route.ts:95` — exception handler.
- `src/app/api/auth/profile/route.ts:53` — exception handler.
- `src/app/api/disclaimer/route.ts:33` — exception handler.
- `src/app/api/lab/route.ts:58` — exception handler.
- `src/app/api/match/end/route.ts:28` — exception handler.
- `src/app/api/matchmaking/route.ts:114` — exception handler.
- `src/app/api/teams/route.ts:181` — exception handler.
- `src/app/api/teams/route.ts:56` — exception handler.
- `src/app/error.tsx:16` — error digest.
- `src/lib/db.ts:87` — exception handler.
- `src/lib/lab/adapter.ts:44` — synthetic session metadata.

## Remaining search hits

Case-insensitive source and operator-script scan for email, firstname, lastname, phone, address, dob and date_of_birth. Each line below gives the matched context and its account-data relevance.

- `src/app/admin/page.tsx:304` — Creates an expiring single-use link (/demo/claim/&#123;token&#125;) for out-of-band delivery. No email required. — Account privacy copy.
- `src/app/admin/page.tsx:560` — No email is stored, so password resets must be issued manually here. — Account privacy copy.
- `src/app/api/disclaimer/route.ts:20` — INSERT INTO disclaimers (id, accepted_at, user_identifier, ip_address, version) — Network metadata hashing or disclaimer storage.
- `src/app/api/disclaimer/route.ts:24` — stmt.run(id, acceptedAt, userIdentifier.slice(0, 200), hashIpAddress(ip), 'v1.1'); — Network metadata hashing or disclaimer storage.
- `src/app/api/disclaimer/route.ts:3` — import { getDb, hashIpAddress } from '@/lib/db'; — Network metadata hashing or disclaimer storage.
- `src/app/demo/claim/[token]/ClaimForm.tsx:78` — ? 'Set a new password for your existing callsign. No email required.' — Account privacy copy.
- `src/app/demo/claim/[token]/ClaimForm.tsx:79` — : 'Confirm your handle and choose a password. No name or email is ever stored.'} — Account privacy copy.
- `src/app/individuals/page.tsx:184` — ? { title: 'Foundational Email & Header Triage (Tier 1)', rule: 'Triggered because lowest skill rating is under 40.' } — Synthetic training or network content.
- `src/app/individuals/page.tsx:431` — {/* Synthetic Email Header Viewer */} — Synthetic training or network content.
- `src/app/individuals/page.tsx:434` — <span className="text-muted uppercase tracking-wider font-semibold">EMAIL HEADER INSPECTOR</span> — Synthetic training or network content.
- `src/app/individuals/page.tsx:436` — <span className={'px-1.5 py-0.5 rounded text-[9.5px] font-bold ${activeCase.email.spf === 'PASS' ? 'bg-teal/20 text-teal' : 'bg-coral/20 text-coral'}'}> — Synthetic training or network content.
- `src/app/individuals/page.tsx:437` — SPF: {activeCase.email.spf} — Synthetic training or network content.
- `src/app/individuals/page.tsx:439` — <span className={'px-1.5 py-0.5 rounded text-[9.5px] font-bold ${activeCase.email.dkim === 'PASS' ? 'bg-teal/20 text-teal' : 'bg-coral/20 text-coral'}'}> — Synthetic training or network content.
- `src/app/individuals/page.tsx:440` — DKIM: {activeCase.email.dkim} — Synthetic training or network content.
- `src/app/individuals/page.tsx:446` — <div><strong className="text-text">From:</strong> {activeCase.email.from}</div> — Synthetic training or network content.
- `src/app/individuals/page.tsx:447` — <div><strong className="text-text">To:</strong> {activeCase.email.to}</div> — Synthetic training or network content.
- `src/app/individuals/page.tsx:448` — <div><strong className="text-text">Return-Path:</strong> <code className="text-[#38BDF8]">{activeCase.email.returnPath}</code></div> — Synthetic training or network content.
- `src/app/individuals/page.tsx:449` — <div><strong className="text-text">Subject:</strong> {activeCase.email.subject}</div> — Synthetic training or network content.
- `src/app/individuals/page.tsx:450` — <div><strong className="text-text">Timestamp:</strong> {activeCase.email.date}</div> — Synthetic training or network content.
- `src/app/individuals/page.tsx:454` — {activeCase.email.body} — Synthetic training or network content.
- `src/app/individuals/page.tsx:457` — {activeCase.email.attachment && ( — Synthetic training or network content.
- `src/app/individuals/page.tsx:461` — <span>{activeCase.email.attachment}</span> — Synthetic training or network content.
- `src/app/security/page.tsx:676` — href={'mailto:${TRUST_CENTER_CONTENT.incidentResponse.contactEmail}'} — Public security contact, independent of player accounts.
- `src/app/security/page.tsx:679` — {TRUST_CENTER_CONTENT.incidentResponse.contactEmail} — Public security contact, independent of player accounts.
- `src/app/security/page.tsx:825` — href={'mailto:${TRUST_CENTER_CONTENT.documents.contactEmail}?subject=Security%20Questionnaire%20Request'} — Public security contact, independent of player accounts.
- `src/components/disclaimer/DisclaimerModal.tsx:257` — Request operator review. No name or email required. — Account privacy copy.
- `src/components/illustrations/LaptopEventMockup.tsx:102` — { id: 2, stepId: 2, timeStr: '23:50', title: 'Phishing email quarantined', appearTime: 13, containedTime: 16, xp: 240, detail: 'Sandbox detonation isolates lure within 90 seconds of receipt.' }, — Synthetic training or network content.
- `src/components/illustrations/LaptopEventMockup.tsx:50` — detail: 'Attacker deploys lookalike domain lure; gateway detects and quarantines malicious email.' — Synthetic training or network content.
- `src/components/illustrations/LaptopEventMockup.tsx:95` — { id: 2, stepId: 2, timeStr: '23:48', title: 'Phishing email quarantined', appearTime: 15, containedTime: 18, xp: 200, detail: 'Mail filter matches spoofed domain header and revokes inbox delivery.' }, — Synthetic training or network content.
- `src/components/illustrations/PhishingArchitectureDiagram.tsx:66` — {/* STEP 2: CRAFTED EMAIL LURE */} — Synthetic training or network content.
- `src/components/illustrations/PhishingArchitectureDiagram.tsx:67` — <g id="step-crafted-email"> — Synthetic training or network content.
- `src/components/illustrations/PhishingArchitectureDiagram.tsx:75` — Crafted Email — Synthetic training or network content.
- `src/components/illustrations/SegmentedNetworkDiagram.tsx:67` — Synthetic email dispatch — Synthetic training or network content.
- `src/components/visuals/PilotRequestForm.tsx:112` — Zero-PII: No name or email collected. Zero advertising trackers. — Account privacy copy.
- `src/components/visuals/TerminalPane.tsx:60` — <div className="text-muted/60 text-xs mb-2"># Strict compliance mode: RFC 1918 addresses only</div> — Synthetic training or network content.
- `src/content/individuals.ts:141` — email: { — Synthetic training or network content.
- `src/content/individuals.ts:15` — email: { — Synthetic training or network content.
- `src/content/individuals.ts:168` — label: 'Return-Path header mismatch with From address', — Synthetic training or network content.
- `src/content/individuals.ts:170` — explanation: 'Return-path matches sender address identically.', — Synthetic training or network content.
- `src/content/individuals.ts:188` — incorrect: 'Incorrect verdict. This email passed all SPF, DKIM, and DMARC verifications and contained no malicious links or credential forms.', — Synthetic training or network content.
- `src/content/individuals.ts:210` — unlocks: 'Triage queue, email header analysis, basic indicator tagging, single-host SDN isolation', — Synthetic training or network content.
- `src/content/individuals.ts:71` — email: { — Synthetic training or network content.
- `src/content/individuals.ts:99` — label: 'Return-Path header mismatch with From address', — Synthetic training or network content.
- `src/content/lab-tools.ts:19` — role: 'Simulated phishing campaigns and lookalike email delivery across synthetic test mailboxes.', — Synthetic training or network content.
- `src/content/lab-tools.ts:38` — id: 'email-auth', — Synthetic training or network content.
- `src/content/lab-tools.ts:40` — role: 'Cryptographic email authentication header verification and delivery policy enforcement.', — Synthetic training or network content.
- `src/content/product.ts:110` — 'All entities, credentials, and email records restricted to synthetic domain fintechcorp.local.', — Synthetic training or network content.
- `src/content/product.ts:135` — 'Synthetic directory & email simulation (fintechcorp.local)', — Synthetic training or network content.
- `src/content/product.ts:60` — 'Read real RFC 822 email headers and correlate living-off-the-land script telemetry.', — Synthetic training or network content.
- `src/content/scenarios/blue-lockdown.json:125` — "prompt": "Phishing email intercepted with suspicious attachment for analyst@fintechcorp.local. What action should Blue SOC prioritize?", — Synthetic training or network content.
- `src/content/scenarios/blue-lockdown.json:129` — "label": "Quarantine email across all mailboxes & block payload hash in EDR", — Synthetic training or network content.
- `src/content/scenarios/blue-lockdown.json:143` — "label": "Send an email warning to the recipient", — Synthetic training or network content.
- `src/content/scenarios/blue-lockdown.json:38` — "log": "SIEM: Threat feed match on external CIDR. Email quarantine threshold set to aggressive.", — Synthetic training or network content.
- `src/content/scenarios/blue-lockdown.json:42` — "attackerAdapt": "Compromise a reputable third-party vendor email domain." — Synthetic training or network content.
- `src/content/scenarios/red-breakthrough.json:164` — "feedback": "Sender blocked for new emails, but active in-memory payload on ws-402 continued unhindered.", — Synthetic training or network content.
- `src/content/scenarios/red-breakthrough.json:16` — "description": "Synthetic crawler probes publicly exposed endpoints for employee email formats.", — Synthetic training or network content.
- `src/content/scenarios/red-breakthrough.json:98` — "defenderDetect": "Event ID 7045 from non-management IP address subnet.", — Synthetic training or network content.
- `src/content/security-controls.ts:187` — description: 'Security actions (authentication, access approval, invite provisioning) are recorded with one-way SHA-256 hashed IP addresses and protected against modification by database triggers.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/security-controls.ts:214` — description: 'Accounts use username only and access requests store only an optional note — no email address or real name is collected or stored.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/security-controls.ts:232` — { file: 'src/content/security-controls.ts', contains: 'contactEmail: \'security@cynchor.com\'' }, — Security documentation, evidence marker, or public organizational contact.
- `src/content/security-controls.ts:349` — contactEmail: 'security@cynchor.com', — Security documentation, evidence marker, or public organizational contact.
- `src/content/security-controls.ts:76` — description: 'The platform collects username only — no email address or real name is requested or stored anywhere in the product.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:114` — contactEmail: string; — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:259` — detail: 'Simulated lab environments operate strictly under fintechcorp.local private addressing without access to production logic.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:271` — isHashed: 'Passwords stored as salted scrypt hashes. Usernames (not real names) and IDs are stored in plaintext; no email address is collected or stored.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:277` — isHashed: 'Stores only an optional free-text note (max 200 chars) and hashed claim token reference; no name or email is collected.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:281` — fields: 'id, accepted_at, user_identifier, ip_address, version', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:283` — isHashed: 'IP address is stored as a one-way SHA-256 hash. user_identifier is a truncated user-agent string.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:289` — isHashed: 'Client IP addresses are stored exclusively as one-way SHA-256 hashes with cryptographic salt.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:298` — plainSummary: 'The disclaimer record stores a hashed IP and a truncated user-agent; access requests store only an optional note (no name or email); user accounts store a username (not a real name) and a salted scrypt password hash. No email address is collected or stored anywhere in the product.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:311` — dataShared: 'Browser IP address and User-Agent upon client asset fetch.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:332` — noVendorsStatement: 'No analytics, advertising or email-delivery vendors are used.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:359` — contactEmail: 'security@cynchor.com', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:435` — answer: 'Google Fonts for typography assets. No analytics, advertising, or email-delivery vendors are used. Cloud hosting is planned for V2 and not yet integrated.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:447` — answer: 'Operator privileges require server-side RBAC verification on every request. Accounts are provisioned by one-time claim links only (public signup is disabled) using a username only — no email address or real name is collected or stored.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:461` — answer: 'Security actions are recorded in an append-only database table with one-way SHA-256 hashed IP addresses, protected by database triggers that abort update/delete attempts.', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:470` — contactEmail: 'security@cynchor.com', — Security documentation, evidence marker, or public organizational contact.
- `src/content/trust-center.ts:99` — contactEmail: string; — Security documentation, evidence marker, or public organizational contact.
- `src/content/zones.ts:62` — 'RFC 1918 private IP addressing only', — Synthetic training or network content.
- `src/content/zones.ts:79` — 'One-way SHA-256 IP address hashing', — Synthetic training or network content.
- `src/content/zones.ts:84` — 'Plaintext IP address exposure in persistent storage', — Synthetic training or network content.
- `src/lib/account-schema.ts:56` — if (!original.includes('email') && !original.includes('name')) continue; — One-time legacy schema detection or retirement of previously bound invites.
- `src/lib/account-schema.ts:63` — if (table === 'invites' && original.includes('email')) { — One-time legacy schema detection or retirement of previously bound invites.
- `src/lib/account-schema.ts:64` — // A formerly email-bound token must never become an unrestricted claim. — One-time legacy schema detection or retirement of previously bound invites.
- `src/lib/account-schema.ts:65` — db.exec('UPDATE new_invites SET is_used = 1 WHERE id IN (SELECT id FROM invites WHERE email IS NOT NULL)'); — One-time legacy schema detection or retirement of previously bound invites.
- `src/lib/db.ts:232` — ip_address TEXT, — Network metadata hashing or disclaimer storage.
- `src/lib/db.ts:54` — export function hashIpAddress(ip: string = '127.0.0.1'): string { — Network metadata hashing or disclaimer storage.
- `src/lib/db.ts:77` — const ipHash = hashIpAddress(ip); — Network metadata hashing or disclaimer storage.
- `src/middleware.ts:27` — response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); — Microphone permission policy.
