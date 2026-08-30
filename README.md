# `coordsAtPos` returns the previous line at soft line starts on shipping Safari

On the WebKit shipped in current stable Safari, `view.coordsAtPos(pos)` (the default `side = 1`) returns the end of the previous line for positions right after a literal `\n` in a `white-space: pre` code block (when the line's first character shares a text node with the `\n`; see Notes). WebKit trunk is already fixed, so current Playwright cannot show the bug; this repro pins older Playwright versions to get the shipping-Safari engine. The same misplacement was observed by hand in stable Safari 26.x (2026-08) in a production ProseMirror editor, and not in Safari Technology Preview; WKWebView uses the system WebKit and is affected the same way.

## Why

For a character range that starts right after a `\n`, the affected builds' `Range.getClientRects()` returns an extra leading zero-width rect at the end of the previous line, before the real rect on the caret's line. At the empty-line position of the sample document, WebKit 26.0 reports:

```
[{left:57, top:98,  width:0, height:16},   <- spurious, previous line
 {left:32, top:114, width:0, height:16}]   <- correct, the caret's line
```

prosemirror-view measures exactly this range in the text-node branch of [`coordsAtPos`](https://code.haverbeke.berlin/prosemirror/prosemirror-view/src/tag/1.42.3/src/domcoords.ts#L373-L378), and [`singleRect`](https://code.haverbeke.berlin/prosemirror/prosemirror-view/src/tag/1.42.3/src/domcoords.ts#L338-L345) picks `rects[0]`, which the [`nonZero`](https://code.haverbeke.berlin/prosemirror/prosemirror-view/src/tag/1.42.3/src/domcoords.ts#L334-L336) check accepts (zero-width but full-height). So `coordsAtPos` reports the previous line.

## Layout

- `apps/editor/`: a minimal ProseMirror page (prosemirror-model/state/view 1.42.3 only), one paragraph plus one code block `{` / `  x` / `  y` / empty line / `}`. The page draws an orange virtual caret positioned with `coordsAtPos(head)`, the way editor UIs place custom carets, tooltips, and drop indicators, so the bug is directly visible.
- `probes/pw-<version>/`: one package per pinned Playwright version; each Playwright version bundles a different WebKit build.
- `lib/run-probe.mjs`: serves the page and, for every position after a `\n`, records raw `coordsAtPos(pos)`, the underlying char-range and collapsed-range client rects, and the output of the candidate fix, each judged against the measured line grid. Output is a single JSON report.
- `run-all.mjs`: runs every probe, writes the full reports to `results/<probe>.json`, and prints a JSON summary matrix.

## Run

```bash
pnpm install
pnpm run probe:all
```

`pnpm install` also downloads each probe's WebKit build (a `prepare` script per probe; `PLAYWRIGHT_SKIP_BROWSER_GC=1` stops the older `playwright install` versions from garbage-collecting each other's builds).

## Reproduce manually

1. `pnpm install`, `pnpm run serve`, then open http://127.0.0.1:8940/ in the browser you want to test.
2. Click into the code block and walk the caret with the arrow keys; the empty line between `y` and `}` is the clearest spot.
3. Compare the two carets: the native caret marks the correct position, and the orange bar is drawn at `view.coordsAtPos(head)`.

On an affected build (every shipping Safari as of 2026-08), the orange bar sits at the end of the previous line at every soft line start; on a fixed build (Safari Technology Preview), it tracks the native caret everywhere.

### Recordings

<!-- Replace each _pending_ with the browser version and the uploaded recording; add one bullet per browser/version tested. -->

- Safari (stable) _pending_:

  _pending_

- Safari Technology Preview _pending_:

  _pending_

- Safari on iOS _pending_:

  _pending_

## Results

| probe | Playwright | WebKit build | raw `coordsAtPos(pos)` | patched `singleRect` |
| --- | --- | --- | --- | --- |
| pw-1.40 | 1.40.0 | 17.4 | **0/4 (bug)** | 4/4 |
| pw-1.45 | 1.45.0 | 17.4 | **0/4 (bug)** | 4/4 |
| pw-1.50 | 1.50.0 | 18.2 | **0/4 (bug)** | 4/4 |
| pw-1.55 | 1.55.0 | 26.0 | **0/4 (bug)** | 4/4 |
| pw-1.58 | 1.58.0 | 26.0 | **0/4 (bug)** | 4/4 |
| pw-1.59 | 1.59.0 | 26.4 (early snapshot) | **0/4 (bug)** | 4/4 |
| pw-1.60 | 1.60.0 | 26.4 (late snapshot) | 4/4 | 4/4 |
| pw-1.62 | 1.62.1 | 26.5 (trunk) | 4/4 | 4/4 |

Each cell counts the four soft line starts of the sample code block.

The bug is present at least as far back as WebKit 17.4 (late 2023) and in every build up to the early 26.4 snapshot.

## Candidate fix (verified by the probe)

In `singleRect`, skip leading zero-width rects that precede further rects (`patchedSingleRect` in the reports). It measures every position correctly on the broken engines and changes nothing on the fixed ones.

## Notes

- With the code text in a single text node (no highlight spans), every soft line start reproduces, including the `}` line; when a highlighter splits the text into spans, a line whose first character opens a new text node escapes.
- The engine fix landed between the WebKit builds Playwright 1.59 and 1.60 ship (both self-report 26.4); every Safari release cut before that point, i.e. all current ones, has the bug. The exact WebKit change has not been identified; the bisect above brackets it.
