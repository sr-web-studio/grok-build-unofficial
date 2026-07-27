# Contributing

Thanks for helping improve **Grok Build (unofficial)**.

## Prerequisites

- Node.js 20+
- VS Code 1.125+ (for F5 / smoke)
- Grok Build CLI 0.2.112+ if you exercise live ACP paths

## Setup

```bash
npm install
npm run build
npm run typecheck
```

Press **F5** to open an Extension Development Host, or use `npm run watch` with the watch launch
config.

## Project layout

| Path | Role |
| --- | --- |
| `src/extension.ts` | Activation, commands |
| `src/acp/` | JSON-RPC client, spawn, wire types |
| `src/host/` | Session state machine, panel, permissions, bridges |
| `src/shared/protocol.ts` | Host ↔ webview message contract |
| `webview/` | Svelte 5 UI |
| `tools/` | ACP probes, smoke test, webview harness |
| `docs/acp-findings.md` | Protocol notes from live probes |

## Guidelines

1. Keep the host authoritative for transcript state; the webview stays a renderer + input surface.
2. Prefer typed messages in `src/shared/protocol.ts` over ad-hoc IPC.
3. Re-run or extend `tools/probe-methods.mjs` when adding new `_x.ai/*` calls after a CLI upgrade.
4. **Never commit** `recordings/`, `*.vsix`, `.env`, or anything under `~/.grok/`.
5. Match existing style in the file you touch (this tree has evolved; don’t reformat whole files).

## Checks before a PR

```bash
npm run typecheck
npm run build
npm run smoke    # optional but appreciated; needs a local VS Code install
```

## License

By contributing you agree that your contributions are licensed under the MIT License.
