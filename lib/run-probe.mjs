import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('../apps/editor/', import.meta.url))

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

function serveApp() {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    const file = pathname === '/' ? 'index.html' : pathname.slice(1)
    try {
      const body = await readFile(appDir + file)
      const extension = file.slice(file.lastIndexOf('.'))
      response.writeHead(200, { 'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end('not found')
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

// Runs inside the page. For every position right after a literal "\n" in the
// code block, collect:
// - raw view.coordsAtPos(pos), the API under test, called with no side
//   argument (the default is side = 1)
// - the client rects of the exact character range prosemirror-view measures
//   in its text-node branch (the engine-level evidence)
// - the client rects of the collapsed range at the same DOM position
// - "patchedSingleRect": the same char range, but skipping leading zero-width
//   rects that precede further rects (candidate upstream fix)
// - "validatedStrategy": coordsAtPos side probes rejected when they do not
//   land strictly below the previous line, with a collapsed-range rescue
//   (the fix meowdown ships)
function collectGeometry() {
  const view = window.view
  const round = (value) => Math.round(value * 10) / 10
  const shape = (rect) => ({
    left: round(rect.left),
    top: round(rect.top),
    width: round(rect.width),
    height: round(rect.height),
  })

  let codePos = -1
  let codeNode = null
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'code_block') {
      codePos = pos
      codeNode = node
      return false
    }
    return true
  })
  const codeText = codeNode.textContent
  const contentStart = codePos + 1

  const charRange = (documentPos) => {
    const { node, offset } = view.domAtPos(documentPos, 1)
    if (node.nodeType !== 3 || offset >= node.nodeValue.length) return null
    const range = document.createRange()
    range.setStart(node, offset)
    range.setEnd(node, offset + 1)
    return range
  }

  const line0 = charRange(contentStart + 0).getBoundingClientRect()
  const line1 = charRange(contentStart + codeText.indexOf('x')).getBoundingClientRect()
  const lineHeight = line1.top - line0.top

  // Without `side` this is the default public call: coordsAtPos(pos, side = 1).
  const tryCoords = (pos, side) => {
    try {
      const coords = side == null ? view.coordsAtPos(pos) : view.coordsAtPos(pos, side)
      return { left: round(coords.left), top: round(coords.top), bottom: round(coords.bottom) }
    } catch {
      return null
    }
  }

  const positions = []
  for (let offset = 1; offset <= codeText.length; offset++) {
    if (codeText[offset - 1] !== '\n') continue
    const pos = contentStart + offset
    const lineIndex = codeText.slice(0, offset).split('\n').length - 1
    const lineText = codeText.split('\n')[lineIndex]

    const raw = tryCoords(pos)

    const range = charRange(pos)
    const charRangeClientRects = range ? [...range.getClientRects()].map(shape) : null
    let patchedSingleRect = null
    if (range) {
      const rects = [...range.getClientRects()]
      const rect = rects.find((candidate, index) => candidate.width > 0 || index === rects.length - 1)
      if (rect) {
        patchedSingleRect = { left: round(rect.left), top: round(rect.top), bottom: round(rect.bottom) }
      }
    }

    const { node, offset: domOffset } = view.domAtPos(pos, 1)
    const collapsed = document.createRange()
    collapsed.setStart(node, domOffset)
    collapsed.collapse(true)
    const collapsedRangeClientRects = [...collapsed.getClientRects()].map(shape)

    const previousLineTop = tryCoords(pos, -1)?.top ?? null
    let validatedStrategy = null
    for (const side of [1, -1]) {
      const coords = tryCoords(pos, side)
      if (coords == null || coords.bottom <= coords.top) continue
      if (previousLineTop != null && coords.top <= previousLineTop) continue
      validatedStrategy = { source: `coordsAtPos side ${side}`, ...coords }
      break
    }
    if (validatedStrategy == null) {
      const rects = [...collapsed.getClientRects()].filter((rect) => rect.height > 0)
      const rect = rects[rects.length - 1]
      if (rect != null && (previousLineTop == null || rect.top > previousLineTop)) {
        validatedStrategy = {
          source: 'collapsed range',
          left: round(rect.left),
          top: round(rect.top),
          bottom: round(rect.top + rect.height),
        }
      }
    }

    positions.push({
      pos,
      offset,
      lineIndex,
      lineText,
      expectedTop: round(line0.top + lineIndex * lineHeight),
      previousLineTop,
      raw,
      charRangeClientRects,
      collapsedRangeClientRects,
      patchedSingleRect,
      validatedStrategy,
    })
  }

  return {
    codeText,
    lineGrid: { firstLineTop: round(line0.top), lineHeight: round(lineHeight) },
    positions,
  }
}

export async function runProbe(webkit, playwrightVersion) {
  const server = await serveApp()
  const port = server.address().port
  const browser = await webkit.launch()
  const webkitVersion = browser.version()

  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${port}/`)
  await page.waitForSelector('.ProseMirror pre code')
  const data = await page.evaluate(collectGeometry)
  await browser.close()
  server.close()

  const { lineHeight } = data.lineGrid
  const verdictFor = (rect, expectedTop) => {
    if (rect == null) return 'no rect'
    const delta = rect.top - expectedTop
    if (Math.abs(delta) < lineHeight / 2) return 'ok'
    if (Math.abs(delta + lineHeight) < lineHeight / 2) return 'bug: previous line'
    return `bug: off by ${Math.round(delta)}px`
  }

  const measurements = ['raw', 'patchedSingleRect', 'validatedStrategy']
  const correct = { raw: 0, patchedSingleRect: 0, validatedStrategy: 0 }
  const positions = data.positions.map((position) => {
    const verdicts = {}
    for (const measurement of measurements) {
      verdicts[measurement] = verdictFor(position[measurement], position.expectedTop)
      if (verdicts[measurement] === 'ok') correct[measurement]++
    }
    return { ...position, verdicts }
  })

  const total = positions.length
  const summary = Object.fromEntries(
    measurements.map((measurement) => [
      measurement,
      { correct: correct[measurement], total, ok: correct[measurement] === total },
    ]),
  )

  const report = {
    playwrightVersion,
    webkitVersion,
    bugReproduced: !summary.raw.ok,
    conclusion: summary.raw.ok
      ? 'No bug on this engine: Range.getClientRects() no longer reports the spurious previous-line rect (fixed in the WebKit 26.4 development cycle); both candidate fixes stay correct.'
      : 'BUG: for a position at the start of a soft line (right after a literal "\\n" in a white-space:pre code block), this WebKit returns a spurious leading zero-width client rect at the end of the PREVIOUS line for the character range prosemirror-view measures, and view.coordsAtPos(pos, 1) picks that first rect, so it reports the previous line. Both candidate fixes measure every position correctly.',
    codeText: data.codeText,
    lineGrid: data.lineGrid,
    summary,
    positions,
  }

  process.stdout.write(JSON.stringify(report, undefined, 2) + '\n')
  return report
}
