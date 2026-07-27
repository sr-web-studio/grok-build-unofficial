# Security Policy

## What this extension does

**Grok Build (unofficial)** spawns the local Grok Build CLI (`grok agent stdio`) and implements
ACP client callbacks for:

- reading and writing workspace files
- creating and reading VS Code terminals (shell commands)

Those operations can change your machine. The extension’s **permission gate** is the main
safety boundary:

| Mode          | Risk                                                   |
| ------------- | ------------------------------------------------------ |
| Ask (default) | Lowest — every write and command needs approval        |
| Accept edits  | Medium — auto-applies file writes; commands still ask  |
| Plan          | Low for mutation — writes/commands blocked client-side |
| Bypass        | Highest — no prompts; only use in trusted workspaces   |

This extension does **not** store xAI API keys. Authentication is owned by the Grok CLI
(`~/.grok/` on your machine). Protocol logging redacts common secret-shaped strings, but treat
logs as sensitive.

## Supported versions

Only the latest published release is supported for security fixes.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Prefer a **private security advisory** on
[sr-web-studio/grok-build-unofficial](https://github.com/sr-web-studio/grok-build-unofficial)
(Security → Report a vulnerability), including:

- a description of the issue
- steps to reproduce
- affected version / commit if known

We will acknowledge receipt as soon as practical and coordinate a fix and disclosure timeline.

## Supply chain

- Releases are built from this repository; prefer Marketplace / Open VSX / signed GitHub Release assets
- Review `package.json` scripts before running `npm` scripts from untrusted forks
