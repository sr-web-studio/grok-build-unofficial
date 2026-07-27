/**
 * grok's initialize / session updates echo the user's MCP server configuration, which on a
 * real machine carries live API keys. Anything that leaves this process (log channel, crash
 * report, saved transcript) goes through here first.
 */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:rpa|xai|sk|ghp|gho|ghu|ghs|glpat|hf|pat)_[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /Bearer\s+[A-Za-z0-9._-]{20,}/g,
];

export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (m) => m.slice(0, 4) + 'REDACTED');
  return out;
}
