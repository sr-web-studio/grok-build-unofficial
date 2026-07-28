/**
 * A small, deliberately limited Markdown renderer.
 *
 * Written by hand rather than pulled in as a dependency: the agent's output only ever needs
 * paragraphs, code, lists, tables, headings and quotes, and everything is HTML-escaped before any
 * markup is added, so `{@html}` in the webview stays safe under the strict CSP.
 *
 * Not supported (renders as plain text): footnotes, raw HTML, reference links.
 *
 * Streaming: Copilot/Claude-style — incomplete delimiters (`**`, `` ` ``, half links, open
 * fences mid-token) are softened so the user never watches raw syntax flicker into formatting.
 */

type Align = 'left' | 'center' | 'right' | ''

/**
 * A GFM delimiter row — `|---|:--:|`. It has to carry a pipe: without one, `---` under a line of
 * prose is a horizontal rule, not a one-column table.
 */
const DELIMITER_ROW = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*\|?\s*$/

export function renderMarkdown(
  source: string,
  opts?: { streaming?: boolean },
): string {
  const prepared = opts?.streaming ? softenStreamingMarkdown(source) : source
  return renderMarkdownCore(prepared)
}

/**
 * Hide incomplete markdown constructs while tokens are still arriving. Closed spans keep
 * normal formatting; only the open tail is demoted so `**bold` never flashes as `**bold`.
 */
function softenStreamingMarkdown(source: string): string {
  let s = source

  // Incomplete link forms — show the label text only.
  s = s.replace(/\[([^\]]*)]\([^)\n]*$/, '$1')
  s = s.replace(/\[([^\]]*)$/, '$1')

  // Paired markers: drop the last opener when the count is odd.
  s = dropOddMarker(s, '**')
  s = dropOddMarker(s, '__')
  s = dropOddMarker(s, '~~')

  // Inline code: odd number of bare ` (not part of a ``` fence line) → drop the last one.
  s = softenUnclosedInlineCode(s)

  // Single-asterisk italic is ambiguous with list markers; only soften trailing " *word".
  if (
    /(^|[\s(])\*[^*\n]+$/.test(s) &&
    !/\*[^*\n]+\*/.test(s.slice(s.lastIndexOf('*')))
  ) {
    const i = s.lastIndexOf('*')
    if (i >= 0 && (i === 0 || /\s|\(/.test(s[i - 1] ?? ''))) {
      s = s.slice(0, i) + s.slice(i + 1)
    }
  }

  return s
}

function dropOddMarker(source: string, marker: string): string {
  let count = 0
  let from = 0
  while (from < source.length) {
    const i = source.indexOf(marker, from)
    if (i < 0) break
    count += 1
    from = i + marker.length
  }
  if (count % 2 === 0) return source
  const i = source.lastIndexOf(marker)
  return i < 0 ? source : source.slice(0, i) + source.slice(i + marker.length)
}

function softenUnclosedInlineCode(source: string): string {
  // Strip fence lines from the count so ``` blocks do not look like inline ticks.
  const withoutFences = source.replace(/^\s*```+.*$/gm, '')
  const ticks = withoutFences.match(/(?<!`)`(?!`)/g)
  if (!ticks || ticks.length % 2 === 0) return source
  const i = source.lastIndexOf('`')
  if (i < 0) return source
  // Do not strip a fence opener on its own line.
  const lineStart = source.lastIndexOf('\n', i - 1) + 1
  const line = source.slice(lineStart, i + 1)
  if (/^\s*```/.test(line)) return source
  return source.slice(0, i) + source.slice(i + 1)
}

function renderMarkdownCore(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let paragraph: string[] = []
  let list: { tag: 'ul' | 'ol'; items: string[] } | undefined
  let quote: string[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    out.push(
      `<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`,
    )
    list = undefined
  }
  const flushQuote = () => {
    if (quote.length === 0) return
    out.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`)
    quote = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const fence = /^\s*```+\s*([\w+-]*)\s*$/.exec(line)
    if (fence) {
      flushAll()
      const lang = fence[1] ?? ''
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i] ?? '')) {
        body.push(lines[i] ?? '')
        i++
      }
      // Unclosed fence (still streaming): keep body as a code block without showing the
      // trailing fence marker — looks like a growing code region, not raw ```.
      // Wrapper + copy control: Markdown.svelte handles clicks via [data-md-copy] delegation.
      out.push(renderCodeBlock(body.join('\n'), lang))
      continue
    }

    if (line.trim() === '') {
      flushAll()
      continue
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushAll()
      out.push('<hr>')
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushAll()
      const level = (heading[1] ?? '#').length
      out.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`)
      continue
    }

    const blockQuote = /^\s*>\s?(.*)$/.exec(line)
    if (blockQuote) {
      flushParagraph()
      flushList()
      quote.push(blockQuote[1] ?? '')
      continue
    }

    // Tables are recognised two lines at a time: a header row on its own is just a paragraph that
    // happens to contain pipes, so it only becomes a table once a delimiter row follows it.
    if (line.includes('|') && DELIMITER_ROW.test(lines[i + 1] ?? '')) {
      flushAll()
      const header = splitRow(line)
      const align = splitRow(lines[i + 1] ?? '').map(alignOf)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        rows.push(splitRow(lines[i] ?? ''))
        i++
      }
      i-- // the loop's own i++ has to land on the first line after the table
      out.push(renderTable(header, align, rows))
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (bullet || ordered) {
      flushParagraph()
      flushQuote()
      const tag: 'ul' | 'ol' = bullet ? 'ul' : 'ol'
      if (!list || list.tag !== tag) {
        flushList()
        list = { tag, items: [] }
      }
      list.items.push((bullet ?? ordered)?.[1] ?? '')
      continue
    }

    flushList()
    flushQuote()
    paragraph.push(line)
  }

  flushAll()
  return out.join('')
}

/** Splits one table row into cells, honouring `\|` as a literal pipe inside a cell. */
function splitRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '\\' && trimmed[i + 1] === '|') {
      cell += '|'
      i++
    } else if (ch === '|') {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell.trim())
  return cells
}

function alignOf(spec: string): Align {
  const left = spec.startsWith(':')
  const right = spec.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return ''
}

/**
 * The header decides the column count, so a ragged row is padded or truncated rather than
 * knocking the rest of the table out of line — the same thing GFM does.
 */
function renderTable(
  header: string[],
  align: Align[],
  rows: string[][],
): string {
  const cell = (tag: 'th' | 'td', text: string, index: number) => {
    const a = align[index] ?? ''
    return `<${tag}${a ? ` class="md-${a}"` : ''}>${inline(text)}</${tag}>`
  }
  const head = `<tr>${header.map((c, i) => cell('th', c, i)).join('')}</tr>`
  const body = rows
    .map(
      (r) =>
        `<tr>${header.map((_c, i) => cell('td', r[i] ?? '', i)).join('')}</tr>`,
    )
    .join('')
  return `<table><thead>${head}</thead>${body ? `<tbody>${body}</tbody>` : ''}</table>`
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Lucide-style copy / check paths (inline so {@html} blocks do not need Svelte Icon). */
const COPY_SVG =
  '<svg class="md-copy-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
const CHECK_SVG =
  '<svg class="md-copy-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

/**
 * Fenced code block with a language kicker and a copy control. The button is inert markup;
 * Markdown.svelte wires clipboard + the brief "Copied" state.
 */
function renderCodeBlock(code: string, lang: string): string {
  const label = lang.trim() || 'code'
  return (
    `<div class="md-code-wrap">` +
    `<div class="md-code-head">` +
    `<span class="md-code-lang">${escapeHtml(label)}</span>` +
    // Visibility of idle/done is pure CSS via `.md-copy.copied` — do not rely on [hidden]
    // (webview styles with display:inline-flex were showing both labels at once).
    `<button type="button" class="md-copy" data-md-copy title="Copy code" aria-label="Copy code">` +
    `<span class="md-copy-idle">${COPY_SVG}<span class="md-copy-label">Copy</span></span>` +
    `<span class="md-copy-done">${CHECK_SVG}<span class="md-copy-label">Copied</span></span>` +
    `</button>` +
    `</div>` +
    `<pre class="md-code"><code>${escapeHtml(code)}</code></pre>` +
    `</div>`
  )
}

/**
 * Inline markup. Code spans are extracted first so their contents stay literal.
 *
 * The placeholder is delimited by NUL — stripped from the input up front and impossible for
 * escaping to produce, so nothing in the agent's prose can collide with it.
 */
function inline(text: string): string {
  const codeSpans: string[] = []
  let work = escapeHtml(text.replace(/\0/g, '')).replace(
    /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g,
    (_m, _ticks, body: string) => {
      codeSpans.push(`<code>${body.trim()}</code>`)
      return `\0${codeSpans.length - 1}\0`
    },
  )

  work = work
    // Only http(s) links; anything else is left as literal text.
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" rel="noreferrer">$1</a>',
    )
    .replace(
      /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      '$1<a href="$2" rel="noreferrer">$2</a>',
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')

  return work.replace(
    /\0(\d+)\0/g,
    (_m, index: string) => codeSpans[Number(index)] ?? '',
  )
}
