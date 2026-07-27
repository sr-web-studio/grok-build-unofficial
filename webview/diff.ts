/**
 * Line diff for edit tool cards and write approvals.
 *
 * Hand-rolled for the same reason as the Markdown renderer: a full diff library is far more than
 * a chat transcript needs. Common prefix/suffix are trimmed first, then an LCS over what is left,
 * with a size cap so a huge rewrite degrades to "replace everything" instead of hanging the view.
 */

export interface DiffRow {
  type: 'ctx' | 'add' | 'del' | 'gap';
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffResult {
  rows: DiffRow[];
  added: number;
  removed: number;
  /** True when the file was too large to diff precisely and we fell back to whole-file replace. */
  coarse: boolean;
}

const MAX_LCS_CELLS = 4_000_000; // ~2000x2000 lines

export function lineDiff(oldText: string | null, newText: string, context = 3): DiffResult {
  const a = oldText === null ? [] : splitLines(oldText);
  const b = splitLines(newText);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  const coarse = midA.length * midB.length > MAX_LCS_CELLS;

  const ops: DiffRow[] = [];
  for (let i = 0; i < prefix; i++) {
    ops.push({ type: 'ctx', text: a[i] ?? '', oldLine: i + 1, newLine: i + 1 });
  }

  if (coarse) {
    midA.forEach((text, i) => ops.push({ type: 'del', text, oldLine: prefix + i + 1 }));
    midB.forEach((text, i) => ops.push({ type: 'add', text, newLine: prefix + i + 1 }));
  } else {
    ops.push(...lcsDiff(midA, midB, prefix));
  }

  for (let i = 0; i < suffix; i++) {
    const oldLine = a.length - suffix + i + 1;
    const newLine = b.length - suffix + i + 1;
    ops.push({ type: 'ctx', text: a[oldLine - 1] ?? '', oldLine, newLine });
  }

  const added = ops.filter((o) => o.type === 'add').length;
  const removed = ops.filter((o) => o.type === 'del').length;
  return { rows: collapse(ops, context), added, removed, coarse };
}

function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // A trailing newline produces an empty final element that is noise in a diff view.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function lcsDiff(a: string[], b: string[], offset: number): DiffRow[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: 'ctx', text: a[i] ?? '', oldLine: offset + i + 1, newLine: offset + j + 1 });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ type: 'del', text: a[i] ?? '', oldLine: offset + i + 1 });
      i++;
    } else {
      rows.push({ type: 'add', text: b[j] ?? '', newLine: offset + j + 1 });
      j++;
    }
  }
  while (i < n) {
    rows.push({ type: 'del', text: a[i] ?? '', oldLine: offset + i + 1 });
    i++;
  }
  while (j < m) {
    rows.push({ type: 'add', text: b[j] ?? '', newLine: offset + j + 1 });
    j++;
  }
  return rows;
}

/** Keep `context` lines around each change and replace long unchanged runs with a gap marker. */
function collapse(rows: DiffRow[], context: number): DiffRow[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, index) => {
    if (row.type === 'ctx') return;
    for (let k = Math.max(0, index - context); k <= Math.min(rows.length - 1, index + context); k++) {
      keep[k] = true;
    }
  });
  if (!keep.includes(true)) return [];

  const out: DiffRow[] = [];
  let skipped = 0;
  rows.forEach((row, index) => {
    if (keep[index]) {
      if (skipped > 0) {
        out.push({ type: 'gap', text: `… ${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
        skipped = 0;
      }
      out.push(row);
    } else {
      skipped++;
    }
  });
  return out;
}
