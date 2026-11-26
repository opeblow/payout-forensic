# Contributing

## Development setup

```bash
npm ci
npm test
npm run build
npm run lint
```

Use Node.js 22.x to match CI and the locked native dependencies. `npm test` starts the API with an isolated temporary database and synthetic records. It does not call a model provider.

For local development, start `npm run dev:api` and `npm run dev` in separate terminals.

## Pull request expectations

- Keep account boundaries explicit.
- Never seed or infer financial findings.
- Preserve source-row provenance.
- Use deterministic financial arithmetic.
- Encrypt sensitive values and never log passwords or session tokens.
- Add focused tests for authentication, upload validation and account isolation.
- Update documentation alongside behavior changes.
