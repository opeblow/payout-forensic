# Payout Forensics

**Every transaction has a story. Every discrepancy leaves a trace.**

Payout Forensics is an account-scoped financial investigation workspace for uploaded transaction, payout, refund, fee and settlement records. It imports CSV evidence, runs coordinated specialist agents through the Mozaik runtime, and preserves source-linked candidate observations for review.

The product serves finance operations teams and engineers who need to inspect financial records without losing the connection to the original source. It addresses fragmented exports and manual reconciliation by keeping record provenance, agent reasoning boundaries and uncertainty visible.

![Payout Forensics landing page](docs/screenshots/landing-page.png)

## Contents

- [Problem](#problem)
- [How the system works](#how-the-system-works)
- [Architecture](#architecture)
- [Multi-agent investigation](#multi-agent-investigation)
- [Financial integrity and evidence](#financial-integrity-and-evidence)
- [Technology](#technology)
- [Product routes](#product-routes)
- [Screenshots](#screenshots)
- [Demonstration](#demonstration)
- [Installation and quick start](#installation-and-quick-start)
- [Testing and quality](#testing-and-quality)
- [Security and data handling](#security-and-data-handling)
- [Engineering decisions](#engineering-decisions)
- [Limitations and roadmap](#limitations-and-roadmap)
- [Repository guide](#repository-guide)
- [Contributing and license](#contributing-and-license)

## Problem

Financial operations records are commonly distributed across processor exports, bank settlements, refunds and internal ledgers. A team can identify a numeric difference but still lack a reliable explanation:

- Which source row belongs to the discrepancy?
- Are two rows the same transaction?
- Is a fee repeated or missing a supporting schedule?
- Was a refund issued against the correct reference?
- Does a settlement record correspond to a transaction set?
- Is an FX comparison based on a supplied rate?
- Did a source file omit, truncate or mislabel a record?

A variance value alone is not a conclusion. The answer must be traceable to original records and any unsupported interpretation must remain separate from verified accounting facts.

Payout Forensics is designed around that distinction. CSV uploads become encrypted evidence rows. Model output is treated as `unverified` candidate observation data until it is connected to valid source identifiers.

## How the system works

The implemented workflow is:

1. **Account access.** A user registers or signs in. Session and account data are scoped by the authenticated user.
2. **Investigation creation.** The user creates an account-owned investigation.
3. **Evidence ingestion.** A CSV up to 25 MB is parsed. Each accepted row requires a usable transaction ID and a finite base-10 decimal amount; blank and non-decimal values are rejected.
4. **Evidence persistence.** A record ID, evidence ID, amount, status and source filename are stored.
5. **Agent execution.** With explicit consent and a configured provider key, five specialists and one adversarial auditor run through Mozaik.
6. **Provenance validation.** Candidate observations are checked against actual record IDs and evidence IDs.
7. **Execution persistence.** Agent and batch state are stored in SQLite for review.
8. **Review.** The UI displays imported evidence and persisted agent run status.

The current implementation does **not** perform a complete payout-ledger reconciliation engine. It validates row shape, stores evidence, and asks model agents to inspect the records. It does not yet calculate settlement totals, net-of-fee variance, duplicate totals or confirmed financial loss.

### Deterministic and model-assisted boundaries

| Layer | Authority | Current behaviour |
| --- | --- | --- |
| CSV import | Deterministic | Accepts `transaction_id` or `id`; accepts `amount` or `gross_amount`; requires a finite base-10 decimal string |
| Evidence IDs | Deterministic | Generates IDs and preserves record IDs and source filenames |
| Provenance validation | Deterministic | Discards observations whose record or evidence IDs do not exist in the current evidence set |
| Agent observation | Model-assisted | Returns structured candidate observations marked `unverified` |
| Adversarial review | Model-assisted | Challenges specialists against the supplied evidence |
| Financial conclusion | **Not implemented** | No verified/disputed/dismissed reconciliation state is produced by an arithmetic engine |

## Architecture

```mermaid
flowchart TB
  subgraph Browser["Browser"]
    USER["Finance operator"]
    UI["React 19 workspace<br/>src/App.tsx"]
  end

  subgraph App["Application process · server.mjs"]
    direction TB
    HTTP["Express REST API"]
    SESSION["Authentication<br/>Argon2id · signed JWT cookie"]
    INGEST["CSV intake<br/>Multer · csv-parse"]
    CONSENT{"Authenticated owner<br/>and explicit consent?"}
    SCOPE["Evidence access tool<br/>owner-scoped · read-only"]
    VALIDATE["Structured output and provenance checks<br/>known record IDs · known evidence IDs"]
    COORD["Batch coordinator<br/>five parallel specialists"]
    AUDITOR["Adversarial Auditor<br/>runs if any specialist completes"]
  end

  subgraph Runtime["Mozaik runtime · @mozaik-ai/core"]
    direction TB
    CREATE["createAgent / createLoop"]
    BREAKPOINT["setBreakpoint / advanceLoop"]
    SPECIALISTS["Transaction · Fee · Refund<br/>Settlement · FX"]
    CHALLENGE["Prior candidate observations"]
  end

  subgraph Storage["Local persistence · better-sqlite3"]
    direction TB
    DB[("data/payout.db · WAL")]
    DOMAIN["users · investigations<br/>evidence · notifications"]
    STATE["mozaik_agents · mozaik_loop_owners<br/>mozaik_loops"]
    RUNS["agent_runs · mozaik_batches"]
    UPLOADS["data/uploads/<br/>temporary CSV files"]
  end

  PROVIDER["Configured model provider<br/>OpenAI by default"]
  PRESENT["Workspace views<br/>evidence rows · run status"]
  NOT_BUILT["Not implemented<br/>deterministic reconciliation engine<br/>report export · separate graph database"]

  USER --> UI
  UI -->|"Cookie-authenticated /api requests"| HTTP
  HTTP --> SESSION
  HTTP --> INGEST
  INGEST -->|"write accepted rows"| DOMAIN
  INGEST -. "temporary file; removed after parsing" .-> UPLOADS
  SESSION --> DOMAIN

  HTTP --> CONSENT
  CONSENT -->|"yes · 1–1,000 evidence rows"| COORD
  CONSENT -->|"no: reject request"| HTTP
  COORD --> CREATE
  CREATE --> SPECIALISTS
  SPECIALISTS --> BREAKPOINT
  BREAKPOINT <-->|"inference"| PROVIDER
  SPECIALISTS --> SCOPE
  SCOPE -->|"paged source rows"| DOMAIN
  SPECIALISTS --> CHALLENGE
  CHALLENGE --> AUDITOR
  AUDITOR --> BREAKPOINT
  AUDITOR --> VALIDATE
  VALIDATE -->|"valid observations · unverified"| RUNS
  VALIDATE -->|"Mozaik agent and loop state"| STATE
  COORD -->|"batch status"| RUNS

  DOMAIN --> DB
  STATE --> DB
  RUNS --> DB
  DB --> PRESENT
  PRESENT --> UI
  NOT_BUILT -. "future work, not a live component" .- HTTP

  classDef actor fill:#16202b,stroke:#7d8b99,color:#fff
  classDef service fill:#102c37,stroke:#3e9ba8,color:#f4fbfc
  classDef runtime fill:#25203a,stroke:#9b85d6,color:#faf8ff
  classDef storage fill:#182b21,stroke:#72a982,color:#f5fff7
  classDef external fill:#352719,stroke:#d69b50,color:#fffaf2
  classDef absent fill:#292929,stroke:#8b8b8b,color:#ddd,stroke-dasharray:5 5
  class USER,UI,PRESENT actor
  class HTTP,SESSION,INGEST,CONSENT,SCOPE,VALIDATE,COORD,AUDITOR service
  class CREATE,BREAKPOINT,SPECIALISTS,CHALLENGE runtime
  class DB,DOMAIN,STATE,RUNS,UPLOADS storage
  class PROVIDER external
  class NOT_BUILT absent
```

**How to read it:** solid arrows are implemented runtime or persistence paths; dashed arrows mark temporary upload handling or explicitly unimplemented areas. The storage “evidence graph” is the relationship between evidence IDs, record IDs, investigations and observations in SQLite—not a graph database or a separate graph visualization. Vite proxies `/api` to port `8787` in development; it is not part of the production API process.

The API creates an agent and loop for each run, uses Mozaik breakpoints to advance inference and tool calls, and stores loop state through custom SQLite repositories. Five specialists execute concurrently. Their outputs are passed to the Adversarial Auditor only if at least one specialist completes; validated observations remain `unverified`.

### Communication paths

| Source | Target | Purpose |
| --- | --- | --- |
| React | Express | Authentication, account profile, investigations, uploads and agent runs |
| Express | Multer and CSV parser | Temporary file intake and record parsing |
| Express | SQLite | Account, investigation, evidence and execution persistence |
| Express | Mozaik | Agent, loop and breakpoint lifecycle |
| Mozaik agent | `get_investigation_evidence` | Read-only evidence paging scoped to the current user and investigation |
| Mozaik | Provider API | External model inference |
| SQLite | React | Dashboard totals, evidence rows and agent execution status |

## Multi-agent investigation

The implementation registers six role definitions in `server.mjs`. Five specialists execute concurrently. The Adversarial Auditor receives the specialist observations and inspects their support against the evidence set.

| Agent | Responsibility | Inputs | Output and failure boundary |
| --- | --- | --- | --- |
| Transaction Investigator | Compare identifiers and amounts for duplicate or unmatched references | Evidence rows and the investigation ID | Candidate `duplicate_reference`, `unmatched_reference` or `amount_inconsistency` observations; no finding if IDs cannot be validated |
| Fee Auditor | Identify repeated or inconsistent fee-like amounts without assuming an unseen schedule | Evidence rows and prior observations | Candidate `fee_review` observations; does not infer a fee schedule |
| Refund Investigator | Identify explicit refund records and duplicate references | Evidence rows and prior observations | Candidate `refund_review` observations; does not infer refunds from names or context |
| Settlement Investigator | Review explicitly identified settlement records and potential unmatched references | Evidence rows and prior observations | Candidate `settlement_review` observations; does not confirm settlement completion |
| FX Investigator | Review supplied currency fields and explicitly supplied rates | Evidence rows and prior observations | Candidate `fx_review` observations; does not invent exchange rates |
| Adversarial Auditor | Challenge unsupported, duplicate or contradictory claims | Specialist observations and the same evidence set | Candidate `unsupported_claim` or supporting observations; specialists are not automatically accepted or promoted |

Each agent receives:

- A role-specific system instruction.
- A prompt containing a bounded evidence preview of up to 100 rows.
- A read-only `get_investigation_evidence` tool.
- A strict structured-output schema.
- A maximum of three inference/tool steps.

The evidence tool clamps offsets to the investigation and access token owner, supports a maximum page size of 500 and is limited to 1,000 evidence rows per run.

### Shared state and result handling

Mozaik agents and Loops are persisted through custom SQLite repositories:

- Agent definitions are encrypted and stored in `mozaik_agents`.
- Loop ownership is stored in `mozaik_loop_owners`.
- Loop state is encrypted and stored in `mozaik_loops`.
- Individual runs are stored in `agent_runs`.
- Batch status is stored in `mozaik_batches`.

The first five results are collected with `Promise.all`. Their candidate observations become `priorCandidateObservations` for the Adversarial Auditor. The auditor executes only when at least one specialist completed successfully.

### Mozaik lifecycle

```mermaid
sequenceDiagram
  participant User
  participant API
  participant DB
  participant Mozaik
  participant Provider
  participant Validator

  User->>API: POST /api/investigations/:id/run
  API->>API: Require ownership and explicit consent
  API->>DB: Verify 1-1000 evidence rows
  API->>DB: Create queued batch
  API-->>User: 202 Accepted
  API->>Mozaik: Create five agents and Loops
  par Specialist execution
    Mozaik->>Provider: Structured inference
    Provider-->>Mozaik: Candidate JSON
  end
  Mozaik->>DB: Persist agent and loop state
  API->>Mozaik: Send prior observations to auditor
  Mozaik->>Provider: Challenge structured findings
  Provider-->>Mozaik: Auditor JSON
  Mozaik->>Validator: Check recordIds and evidence IDs
  Validator->>DB: Persist only validated observations as unverified
```

The UI requires confirmation before calling the run endpoint. The API independently requires `confirmExternalProcessing: true`; an unconfirmed request is rejected.

## Financial integrity and evidence

### Current implementation status

The repository currently stores amounts as encrypted text and validates them by `Number.isFinite(Number(amount))`. It does not use an integer minor-unit type or decimal package for accounting arithmetic.

This means the implementation is suitable for evidence ingestion and model-assisted review, but it is not yet an authority for financial totals or rounding:

| Capability | Status |
| --- | --- |
| CSV parsing | Implemented |
| Numeric amount validation | Implemented using JavaScript number conversion |
| Decimal/integer minor-unit arithmetic | Not implemented |
| Currency normalization | Not implemented |
| Rounding policy | Not implemented |
| Transaction matching | Not implemented as deterministic reconciliation |
| Duplicate detection | Model-assisted candidate observation only |
| Settlement matching | Model-assisted candidate observation only |
| Refund verification | Model-assisted candidate observation only |
| Fee validation | Model-assisted candidate observation only |
| FX verification | Model-assisted candidate observation only |
| Verified/disputed/dismissed classification | Not implemented |
| Reconciliation report export | Not implemented |

### Synthetic reconciliation example

The following synthetic CSV demonstrates the ingestion contract; it does not represent a tested or verified reconciliation result.

```csv
transaction_id,amount,currency,type,status
TX-SYN-001,125.40,USD,payout,posted
TX-SYN-002,-125.40,USD,refund,posted
TX-SYN-003,12.50,USD,fee,posted
```

For these rows, the implementation stores:

- Record ID `TX-SYN-001`, `TX-SYN-002` or `TX-SYN-003`.
- Evidence ID for each generated row.
- Amount as text.
- Source filename.
- Initial status `Unresolved`.

The application does not calculate `125.40 + (-125.40) - 12.50 = -12.50` or infer that the third row is a fee. Those interpretations require future deterministic reconciliation logic and explicit source configuration.

### Finding status

The only agent-provenance status emitted by the current agent pipeline is `unverified`. The UI has no separate verified, disputed or dismissed workflow. Agent observations must not be presented as confirmed financial loss.

## Evidence provenance

Each uploaded evidence row has:

- A generated evidence UUID.
- A source record ID from `transaction_id`, `id`, or `ROW-<CSV line>`.
- An amount string.
- A status (`Unresolved` at upload).
- A source filename.
- An investigation ID.
- A creation timestamp.

Agent observations retain:

- Category.
- Supported record IDs.
- Supporting evidence IDs.
- Explanation.
- Confidence in the range `0` to `1`.
- Status `unverified`.

The evidence graph is implemented through these identifiers and foreign-key relationships rather than as a separate graph database. The read-only evidence tool can only return rows for an investigation owned by the run's access token.

An observation is not persisted when:

- `recordIds` is missing or empty.
- A record ID is not in the evidence set.
- An evidence ID is not in the evidence set.
- The explanation exceeds 500 characters.
- Confidence is outside `0..1`.
- The model does not return strict structured output.

## Technology

| Area | Technology | Architectural role |
| --- | --- | --- |
| Frontend | React 19, React Router 7 | Public pages and authenticated workspace |
| UI assets | TypeScript, CSS, Lucide React | Application components and icons |
| Backend | Node.js, Express 5 | REST API and process orchestration |
| Agent runtime | `@mozaik-ai/core` 5.0.1 | Agents, Loops, breakpoints, tools and persisted model execution |
| Database | Better SQLite3 | Local account, evidence and agent state |
| Authentication | Argon2id, JWT, HTTP-only cookies | Password hashing and session authorization |
| Uploads | Multer, `csv-parse/sync` | CSV multipart handling and parsing |
| Encryption | Node crypto AES-256-GCM | At-rest encryption for selected application fields |
| Configuration | dotenv | Environment-backed configuration |
| Build | Vite 8, TypeScript 7 | Frontend development and production build |
| Lint | oxlint | Static JavaScript/TypeScript checks |

The repository does not include a separate API framework, queue, graph database or cloud deployment configuration.

## Product routes

| Route | Purpose |
| --- | --- |
| `/` | Public landing page |
| `/how-it-works` | Methodology page |
| `/features` | Product capability page |
| `/docs` | Documentation page |
| `/security` | Security and data handling page |
| `/about` | Product identity page |
| `/login` | Registration and login |
| `/app` | Authenticated dashboard |
| `/app/investigations` | Investigation list |
| `/app/investigations/new` | Create an investigation and upload CSV evidence |
| `/app/investigations/:id` | Account-scoped investigation evidence and agent activity |
| `/app/evidence` | Imported evidence for all account investigations |
| `/app/transactions` | Imported transaction/evidence rows |
| `/app/settlements` | Empty settlement workspace |
| `/app/agents` | Persisted Mozaik run status |
| `/app/reports` | Empty reports workspace |
| `/app/settings` | Profile and password settings |

## Screenshots

All screenshots are existing browser captures. Empty workspaces represent real new-account state and do not contain seeded financial records.

### Public product

| Landing | How it works | Features |
| --- | --- | --- |
| ![Landing](docs/screenshots/landing-page.png) | ![How it works](docs/screenshots/how-it-works.png) | ![Features](docs/screenshots/features.png) |

| Documentation | Security | About |
| --- | --- | --- |
| ![Documentation](docs/screenshots/docs.png) | ![Security](docs/screenshots/security.png) | ![About](docs/screenshots/about.png) |

### Workspace

| Login | Dashboard | Investigations |
| --- | --- | --- |
| ![Login](docs/screenshots/login.png) | ![Dashboard](docs/screenshots/dashboard.png) | ![Investigations](docs/screenshots/investigations.png) |

| Create investigation | Investigation detail | Evidence |
| --- | --- | --- |
| ![Create](docs/screenshots/investigation-create.png) | ![Detail](docs/screenshots/investigation-detail.png) | ![Evidence](docs/screenshots/evidence.png) |

| Transactions | Settlements | Agent activity |
| --- | --- | --- |
| ![Transactions](docs/screenshots/transactions.png) | ![Settlements](docs/screenshots/settlements.png) | ![Agents](docs/screenshots/agents.png) |

| Reports | Settings |
| --- | --- |
| ![Reports](docs/screenshots/reports.png) | ![Settings](docs/screenshots/settings.png) |

## Demonstration

### Reproduce the application

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure secrets in `.env` from `.env.example`:

   ```dotenv
   NODE_ENV=development
   HOST=127.0.0.1
   PORT=8787
   DATA_DIR=./data
   JWT_SECRET=<32-or-more-random-characters>
   DATA_ENCRYPTION_KEY=<32-or-more-random-characters>
   MOZAIK_MODEL=gpt-5.4-mini
   OPENAI_API_KEY=
   ```

3. Start the API and frontend in separate terminals:

   ```bash
   npm run dev:api
   npm run dev
   ```

4. Open `http://localhost:5173`.
5. Register a local account and sign in.
6. Create an investigation.
7. Upload synthetic CSV evidence.
8. Inspect the evidence in `/app/evidence` or `/app/transactions`.
9. Configure a provider key and restart the API to enable Mozaik.
10. Start the agent run and confirm external processing.
11. Inspect `/app/agents` and `/api/mozaik/runs`.

### Synthetic CSV

Create a temporary file without real financial data:

```csv
transaction_id,amount,currency,type,status
TX-SYN-001,125.40,USD,payout,posted
TX-SYN-002,-125.40,USD,refund,posted
TX-SYN-003,12.50,USD,fee,posted
```

The upload accepts up to 25 MB and 1,000 evidence rows are the limit for an agent run. Blank amounts, non-decimal text and values outside the finite numeric range are rejected. Valid rows are committed together; database failures do not leave a partial import.

### Credential requirements

Mozaik is installed independently of a model credential. Execution requires one of the provider environment variables supported by `server.mjs`:

| Provider | Environment variable |
| --- | --- |
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google | `GEMINI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |

The default model is `gpt-5.4-mini`. `MOZAIK_MODEL` must name a model supported by the installed Mozaik package. Provider data leaves the application only after the API requires explicit consent and a key is configured.

## Installation and quick start

### Prerequisites

- Node.js 20 or later.
- npm.
- A local writable `data/` directory.
- Optional: a supported model provider API key.

### Setup

```bash
npm install
cp .env.example .env
npm run dev:api
```

In a second terminal:

```bash
npm run dev
```

The API binds to `127.0.0.1:8787` by default. Vite serves the frontend on port `5173` and proxies `/api` to the API. Set `HOST` explicitly to expose the API on another interface; do so only behind deployment-appropriate network controls.

SQLite creates `data/payout.db` and the `data/uploads/` temporary directory on startup.

### Environment reference

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | No | unset | Development mode; production enforces secret length |
| `HOST` | No | `127.0.0.1` | API bind address; loopback by default |
| `PORT` | No | `8787` | Express API port |
| `DATA_DIR` | No | `./data` | Directory for SQLite and temporary upload files |
| `JWT_SECRET` | Production | Ephemeral random development value | JWT signing secret; use at least 32 characters |
| `DATA_ENCRYPTION_KEY` | Production | Development-only fallback | AES-256-GCM key material; use at least 32 characters |
| `MOZAIK_MODEL` | No | `gpt-5.4-mini` | Selected Mozaik-supported model |
| `OPENAI_API_KEY` | For OpenAI | unset | OpenAI provider credential |
| `ANTHROPIC_API_KEY` | For Anthropic | unset | Anthropic provider credential |
| `GEMINI_API_KEY` | For Google | unset | Google provider credential |
| `DEEPSEEK_API_KEY` | For DeepSeek | unset | DeepSeek provider credential |

Never commit `.env` or real credentials.

### Production build

```bash
npm run build
npm run preview
```

`npm run preview` serves the built frontend; it does not start or proxy the Express API or initialize TLS, backups or persistent storage.

## Testing and quality

The project has an isolated HTTP integration suite using Node's built-in test runner. Each run starts the API with a temporary SQLite directory and synthetic data; it does not call any model provider.

```bash
npm test
npm run build
npm run lint
```

`npm test` covers agent evidence-to-record validation, registration/session behavior, investigation creation, CSV upload and row validation, evidence/dashboard reads, account isolation, notifications, consent enforcement, malformed JSON handling and unauthenticated access. `npm run build` runs `tsc -b` and a Vite production build. `npm run lint` runs oxlint.

The suite does not cover:

- Actual model-provider credentials or live Mozaik inference.
- Agent provenance edge cases.
- Financial invariant arithmetic (no reconciliation engine exists).
- Browser-driven frontend interactions or visual regression.
- Uploads at the 25 MB limit and concurrent requests.

These gaps should be treated as roadmap quality work, not implied test coverage.

### Latest local verification

Verified on 2026-11-22:

| Check | Result |
| --- | --- |
| `npm test` | Passed: 2 tests, isolated database, no provider calls |
| `npm run build` | Passed; Vite reports a 544 KB main JavaScript chunk (157 KB gzip), above its 500 KB warning threshold |
| `npm run lint` | Passed |
| Local HTTP smoke checks | Passed for account, profile/password, investigation, CSV, evidence, dashboard, search, notifications, consent rejection and account isolation paths |

These are local development checks, not a production certification or a live model-provider test.

## Security and data handling

- Passwords use Argon2id.
- Sessions use signed JWT values in HTTP-only cookies.
- Profile names and email addresses are AES-256-GCM encrypted at rest.
- Investigation names, evidence record IDs, evidence amounts and source filenames are AES-256-GCM encrypted at rest.
- Agent definitions and loop records are encrypted at rest.
- CSV uploads are restricted to 25 MB and `.csv` filenames.
- Uploaded files are temporary and removed after parsing.
- Cross-account investigation and evidence queries verify ownership.
- Agent evidence access uses short-lived in-memory access tokens and verifies investigation ownership.
- Candidate observations require non-empty evidence IDs tied to the cited records; invalid categories and unsupported provenance are rejected.
- Agent runs are limited to 1,000 evidence rows.
- API error responses do not include server stack traces or filesystem paths.
- The API binds to `127.0.0.1` by default; changing `HOST` can expose it to other interfaces.
- SQLite is local and intended for local-first use.
- Authentication endpoints do not currently implement rate limiting.

Production deployments remain responsible for TLS termination, secret management, persistent storage, backups, network controls and host security. Do not expose the API beyond loopback without deployment-appropriate protections, including rate limiting. The repository does not claim SOC 2, PCI DSS, ISO certification or other compliance status.

No seeded customer financial records or demo findings are included. Synthetic data should be used for testing.

## Engineering decisions

### Separate model interpretation from accounting authority

LLMs can infer unsupported relationships but cannot safely define financial truth. The repository therefore validates agent output only against supplied identifiers and marks observations `unverified`. A future reconciliation engine should own totals and status transitions.

### Use specialist roles and an adversarial pass

Role-specific instructions reduce prompt ambiguity and keep specialist output categories explicit. The adversarial pass is a challenge step; it does not independently verify arithmetic and does not have a separate evidence authority.

### Preserve provenance through identifiers

Record IDs and evidence UUIDs provide a direct source-to-finding connection. Strict validation prevents a model from citing an identifier that was not imported.

### Require explicit external-processing consent

CSV evidence may be sent to a third-party model provider. The UI confirms, and the API independently rejects runs that omit consent.

### Default to account boundaries

Investigations, evidence, dashboard data and agent runs are scoped to the authenticated user.

### Do not classify unknown or missing evidence

The implementation leaves unresolved evidence unresolved. It does not label unseen data as fraud, confirmed loss or completed settlement.

## Limitations and roadmap

### Implemented

- Account registration and login.
- Account-scoped investigation and evidence storage.
- CSV upload and validation.
- Local SQLite persistence and encryption.
- Six Mozaik agent definitions.
- Persisted Mozaik Loops and agent runs.
- Provenance validation and unverified candidate observations.
- Explicit provider consent.
- Public product and empty workspace UI.

### Partial

- Reconciliation: only basic numeric import validation exists; no authoritative calculation engine.
- Evidence graph: implemented as related database identifiers, not a dedicated graph view.
- Investigation detail: shows uploaded source rows and persisted agent run status; no reconciliation result model exists yet.
- Reports: no report generation or export.
- Settlements: no dedicated settlement ingestion or reconciliation.
- FX: model review only; no deterministic rates or currency arithmetic.
- Provider readiness: the status endpoint reports whether a provider key is present, not whether the provider accepts it. Live inference has not been verified by the automated suite.
- Data lifecycle: there is no in-app account deletion, retention scheduler or backup management.
- Frontend performance: the latest build exceeds Vite's 500 KB main-chunk warning threshold; code splitting has not been added.

### Planned

- Integer minor-unit decimal calculations and currency-specific rounding.
- Deterministic duplicate, refund, fee and settlement matching.
- Verified, disputed and unresolved finding states.
- Contradiction and provenance tracing in a dedicated evidence graph.
- PDF or structured report export.
- Automated financial invariant and API tests.
- A credential-free deterministic demo mode should be added only if it clearly labels synthetic model-free behavior.

## Repository guide

```text
.
|-- server.mjs             Express API and Mozaik orchestration
|-- src/
|   |-- App.tsx            Routes and application UI
|   |-- App.css            Application styles
|   |-- index.css          Global styles
|   `-- main.tsx           React entry point
|-- lib/
|   `-- observation-validation.mjs
|-- tests/
|   `-- api.test.mjs       Isolated HTTP and provenance tests
|-- public/                Icons and web manifest
|-- docs/screenshots/      Verified application screenshots
|-- data/                  SQLite database and uploads
|-- .env.example           Environment variable template
|-- package.json           Scripts and dependencies
`-- vite.config.ts         Development proxy and build config
```

## Contributing and license

Before a pull request:

- Keep account boundaries explicit.
- Never seed or infer financial findings.
- Preserve source-row provenance.
- Use integer minor units or a decimal library for future financial arithmetic.
- Encrypt sensitive values and never log passwords or session tokens.
- Add focused tests for authentication, upload validation and account isolation.
- Update documentation alongside behavior changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

Licensed under the [MIT License](LICENSE).
