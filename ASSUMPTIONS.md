Work started from main (0ebbf8c). The existing username-account commit 581e08a was fast-forwarded after the main baseline passed. Its descendants contain unrelated range changes and were excluded.

HTTP checks use synthetic local accounts and SQLite. Expiry uses the application signer with a fixture clock eight days in the past. The seven-day lifetime is absolute. Production databases, secrets and deployment logs were unavailable. Generated development keys are private to this worktree in the ignored .env.local file. Configure a stable random SESSION_SECRET of at least 32 characters across deployment instances.

For legacy rows without a usable handle, operators can look up their generated pseudonym. Legacy email-bound invites require reissue. Personal information voluntarily entered in a handle or free-text access note cannot be excluded by a schema audit. The original checkout's live SQLite file was inspected for column metadata only.
