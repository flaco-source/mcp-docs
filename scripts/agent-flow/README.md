# Agent-flow smoke tests

Runs lightweight checks against the same provider code the MCP uses.

## Usage

```bash
tsx scripts/agent-flow/run.ts --tool <mode> [--vendor TI|ST]
# If npm eats --flags on your shell, use positional form:
tsx scripts/agent-flow/run.ts lookup ST
```

| `--tool` | Behavior |
|----------|----------|
| `resource` | Reads `src/resources/tool-usage-guide.md`; validates header. |
| `search` | `searchDocs(defaultPart)` — network. |
| `lookup` | `lookupDoc` + asserts **`readDoc` is never called** — network for discovery. |
| `read` | `readDoc(sampleReadUrl)` — heavy; requires `AGENT_E2E_READ=1`. |
| `query` | `queryContent` — requires prior index + `AGENT_E2E_READ=1`. |
| `page` | `getDocumentPageText` — requires `AGENT_E2E_READ=1`. |
| `flow` | lookup → optional read/query if `AGENT_E2E_READ=1`. |
| `all` | `resource`, then `search` + `lookup` for both vendors; E2E steps only with `AGENT_E2E_READ=1`. |

Fixtures live in [`fixtures.ts`](fixtures.ts) (`defaultPart`, `defaultQuestion`, `sampleReadUrl` per vendor).

## npm scripts

```bash
npm test                              # build + `all` via run-default-smoke.cjs (clears AGENT_E2E_READ)
npm run test:agent -- lookup ST
npm run test:agent -- all
```

After `--`, pass **`tool`** and optional **`vendor`** positionally (same as `tsx ... lookup ST`) so npm does not treat `--tool` as its own flag on some versions.

Heavy PDF steps:

```bash
set AGENT_E2E_READ=1
npm run test:agent -- --tool read --vendor TI
```

On Unix: `AGENT_E2E_READ=1 npm run test:agent -- --tool all`.
