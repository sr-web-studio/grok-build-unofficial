# Publishing guide

How SR Web Studio ships **Grok Build (unofficial)** to the public.

## Prerequisites (one-time)

### 1. GitHub

- Org: [sr-web-studio](https://github.com/sr-web-studio)
- Repo: `grok-build-unofficial` (public)
- Secrets for CI (optional but recommended):
  - `VSCE_PAT` — Azure DevOps PAT with **Marketplace → Manage**
  - `OVSX_PAT` — Open VSX personal access token

### 2. Visual Studio Marketplace

1. Open [Publisher Management](https://marketplace.visualstudio.com/manage).
2. Create or open publisher **`srwebstudio`** (must match `package.json` → `publisher`).
3. Create an Azure DevOps org if needed → User settings → Personal access tokens →
   **Marketplace (Manage)**.
4. First publish can take hours for review. Keep the listing disclaimer (“unofficial / not
   affiliated with xAI”) visible.

### 3. Open VSX

1. Sign in at [open-vsx.org](https://open-vsx.org/).
2. Claim the **`srwebstudio`** namespace (may require Eclipse Foundation verification).
3. Create an access token for `ovsx publish`.

## Versioning

- Bump `package.json` `version` and add a `CHANGELOG.md` section.
- Tag `vX.Y.Z` matching that version (e.g. `v0.1.0`).
- Prefer [semver](https://semver.org/): protocol-breaking workarounds → minor; security fixes → patch.

## Local package

```bash
npm ci
npm run package
# → grok-build-unofficial-0.1.0.vsix
```

Install locally:

```bash
code --install-extension grok-build-unofficial-0.1.0.vsix
```

## Manual publish

```bash
# Marketplace
npx @vscode/vsce login srwebstudio
npm run publish:marketplace
# or: npx @vscode/vsce publish -p "$VSCE_PAT" --no-dependencies --no-rewrite-relative-links

# Open VSX (after Marketplace or from the same .vsix)
npx ovsx publish grok-build-unofficial-0.1.0.vsix -p "$OVSX_PAT"
```

## Tag-driven release (CI)

Pushing a tag `v*` runs `.github/workflows/release.yml`:

1. `npm ci` → typecheck → package `.vsix`
2. Create a GitHub Release and attach the VSIX
3. Publish to Marketplace and Open VSX when the secrets are set

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Listing checklist

- [ ] `icon` 128×128 PNG, `repository` / `bugs` / `homepage` set
- [ ] README opens with unofficial disclaimer + CLI requirement
- [ ] CHANGELOG entry for the version
- [ ] Smoke on a clean profile: missing `grok` shows a clear error; happy path with auth works
- [ ] Marketplace + Open VSX + GitHub Release all point at the same version
