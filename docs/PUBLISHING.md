# Publishing

How **SR Web Studio** ships **Grok Build (unofficial)** (`sr-web-studio.grok-build-unofficial`).

## One-time setup

### GitHub

- Repo: [sr-web-studio/grok-build-unofficial](https://github.com/sr-web-studio/grok-build-unofficial)
- Optional CI secrets:
  - `VSCE_PAT` — Azure DevOps PAT, **Marketplace → Manage**, **All accessible organizations**
  - `OVSX_PAT` — [Open VSX](https://open-vsx.org/) token

The Microsoft identity behind `VSCE_PAT` must be an **Owner** of the Marketplace publisher (MSA vs Azure AD dual IDs are common — add the DevOps subject as Owner if publish returns Access Denied).

### VS Code Marketplace

1. [Publisher management](https://marketplace.visualstudio.com/manage) → publisher **`sr-web-studio`**
2. PAT: [https://dev.azure.com/sr-web-studio/\_usersSettings/tokens](https://dev.azure.com/sr-web-studio/_usersSettings/tokens)  
   Scope: **Marketplace → Manage**, Organization: **All accessible organizations**
3. Local: copy [`.env.example`](../.env.example) → `.env` and set `VSCE_PAT` (never commit `.env`)

### Open VSX

1. [open-vsx.org](https://open-vsx.org/) → claim namespace **`sr-web-studio`** if needed
2. Create a token → `OVSX_PAT` or local env

## Versioning

1. Bump `package.json` `version`
2. Update `CHANGELOG.md`
3. Commit, then tag `vX.Y.Z` matching the version

## Local package

```bash
npm ci
npm run package
# → grok-build-unofficial-<version>.vsix
code --install-extension grok-build-unofficial-<version>.vsix
```

## Manual publish

```bash
# Marketplace (reads VSCE_PAT from .env, never prints it)
npm run publish:marketplace
# → https://marketplace.visualstudio.com/items?itemName=sr-web-studio.grok-build-unofficial

# Open VSX
npx ovsx publish grok-build-unofficial-*.vsix -p "$OVSX_PAT"
```

## Tag-driven release (CI)

Pushing tag `v*` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml):

1. Typecheck + package `.vsix`
2. GitHub Release + attach VSIX
3. Marketplace / Open VSX when secrets are set

```bash
git tag v0.1.1
git push origin v0.1.1
```

## Listing checklist

- [ ] Version + CHANGELOG match
- [ ] Icon 128×128, repository / bugs / homepage set
- [ ] README disclaimer + CLI requirement visible
- [ ] Smoke: missing CLI shows setup card; authenticated happy path works
- [ ] Marketplace (and Open VSX if used) show the same version
