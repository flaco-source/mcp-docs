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
| `read` | `readDoc(sampleReadUrl)` — heavy; requires **`RUN_E2E_NETWORK = true`** in `run.ts`. |
| `query` | `queryContent` — requires prior index + **`RUN_E2E_NETWORK = true`**. |
| `page` | `getDocumentPageText` — requires **`RUN_E2E_NETWORK = true`**. |
| `flow` | lookup → optional read/query if **`RUN_E2E_NETWORK`**. |
| `all` | `resource`, then `search` + `lookup` for both vendors; E2E steps only with **`RUN_E2E_NETWORK`**. |

Fixtures live in [`fixtures.ts`](fixtures.ts) (`defaultPart`, `defaultQuestion`, `sampleReadUrl` per vendor).

## npm scripts

```bash
npm test                              # build + `all` via run-default-smoke.cjs
npm run test:agent -- lookup ST
npm run test:agent -- all
```

After `--`, pass **`tool`** and optional **`vendor`** positionally (same as `tsx ... lookup ST`) so npm does not treat `--tool` as its own flag on some versions.

Heavy PDF steps: set **`RUN_E2E_NETWORK = true`** at the top of [`run.ts`](run.ts), then:

```bash
npm run test:agent -- --tool read --vendor TI
```
