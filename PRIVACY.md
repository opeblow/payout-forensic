# Privacy

Payout Forensics stores account, investigation and imported evidence data in a local SQLite database. Queries for investigations, evidence and agent runs are scoped to the authenticated account.

CSV uploads are limited to 25 MB, parsed from a temporary file and removed after processing. Accepted evidence currently retains the record ID, amount, import status and source filename; it does not retain every original CSV column.

Mozaik model review is optional. When a signed-in user explicitly starts a run and confirms external processing, up to 1,000 imported record summaries may be sent to the configured model provider. A summary includes the evidence ID, record ID, status, amount and source filename. The application does not control the provider's retention or processing terms; operators should review those terms before enabling this feature.

Selected sensitive fields, evidence values, agent definitions and loop state are encrypted at rest with AES-256-GCM. Passwords are hashed with Argon2id. Production operators must separately protect secrets, database files and backups, and define retention and deletion policies.

The application does not currently provide account deletion, data-retention automation or backup management. Operators must handle those lifecycle requirements for their deployment.
