# Security policy

## Supported behavior

Payout Forensics binds to loopback by default and stores data in a local SQLite database. If Mozaik is enabled, an authenticated user must explicitly confirm before up to 1,000 record summaries are sent to the configured model provider. Review the provider's data terms before enabling agent runs.

Production deployments must provide their own persistent storage, TLS termination, secret management, network controls and backup policy. The application does not claim a compliance certification.

## Authentication

- Passwords use Argon2id.
- Session identifiers use signed, HTTP-only cookies.
- Passwords are never returned from API responses.
- Profile fields are encrypted at rest with AES-256-GCM.
- Evidence record IDs, amounts and source filenames are encrypted at rest with AES-256-GCM.
- Mozaik agent definitions and loop state are encrypted at rest.
- Logout clears the session cookie.
- Registration and login are limited to 10 attempts per 15 minutes per IP address; the counter is in memory and per process.
- Email login and duplicate-email checks decrypt stored addresses instead of comparing plaintext to ciphertext.

The API binds to loopback by default. Changing `HOST` to a non-loopback address requires deployment-level network controls, TLS and a shared rate limiter; the in-process limit is not a substitute for those protections. Keep `DATA_DIR` outside the checkout and do not expose the Vite development server to untrusted users, because its default data directory is inside the repository tree.

## Upload handling

CSV uploads are limited to 25 MB, accepted only with a `.csv` suffix and parsed from a temporary file. Imported rows are validated and written in a database transaction; temporary files are removed after processing. CSV content should be treated as untrusted input.

## Reporting a vulnerability

Do not publish sensitive financial or account data in a public issue. Report the affected route, reproduction steps and impact through a private maintainer channel.
