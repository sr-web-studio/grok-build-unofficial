/**
 * Path display helpers shared by the transcript's tool rows and approval cards.
 *
 * Both surfaces show the same thing — a file the agent is about to touch — in the same narrow
 * sidebar, so they must shorten it the same way. These used to be private to ToolCard.svelte;
 * two copies of the ellipsis rule would drift and the two rows would stop looking related.
 */

/** Drop the workspace prefix so the path reads the way the editor's own tabs do. */
export function shortenPath(p: string, root?: string): string {
  if (!root) return p;
  const normalized = p.replace(/\\/g, '/');
  const base = root.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.toLowerCase().startsWith(base.toLowerCase() + '/')
    ? normalized.slice(base.length + 1)
    : normalized;
}

/** Middle ellipsis so path stems stay recognisable in a narrow sidebar. */
export function middleEllipsis(s: string, max = 48): string {
  if (s.length <= max) return s;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.4);
  const tailLen = keep - head;
  return `${s.slice(0, head)}…${s.slice(-tailLen)}`;
}
