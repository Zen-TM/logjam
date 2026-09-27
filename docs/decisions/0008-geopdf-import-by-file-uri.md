# 0008. GeoPDF import takes a file URI, never bytes

- **Date:** 2026-08-10
- **Status:** Accepted
- **Supersedes:** —

## Context

Every phase of `src/geopdf/importPipeline.ts` before rasterising used to run the
whole file through the JS heap — a sync read, a `Uint8Array` handed to
expo-crypto (a second full copy across the bridge), a sync write back out, and
on the share-sheet path a base64 read plus a hand-rolled `atob` over millions of
elements — all on the UI thread before the first tile.

**Hermes has no JIT, so a per-byte JS loop is ~70× slower than it profiles on a
laptop, and that is where the import's freeze actually was.** pdf-lib scans
forward for `endstream` one byte at a time whenever a stream's `/Length` is an
indirect reference, which is 540 of the 541 streams in an NSW topo sheet: 480 ms
of parse in Node became 35 SECONDS on device, one 3.9 MB stream of it a single
unbroken 16.8-second block of the UI thread.

## Decision

**The pipeline takes a file URI, never bytes**, and that is a hard rule. Hashing
is native and streamed (`LogjamPdfRenderer.sha256File`), copying is a filesystem
copy, and the bytes enter JS exactly once, for the pdf-lib parse, inside a
function scoped so they become unreachable the moment it returns.

`shared/src/geoPdfImport/fastStreamScan.ts` replaces pdf-lib's stream scan with
the same algorithm driven by native `Uint8Array.indexOf` — parse 1.5 s, worst
stall 228 ms — and `fastStreamScan.test.ts` runs pdf-lib's original and the
replacement side by side over real files asserting every offset matches.
**Never profile this pipeline in Node and believe the number**; the import logs
its own phase timings and the worst JS-thread stall it caused, once per run, and
that log is the measurement that counts.

**Guards come before the expensive step, not after.** Every incoming file is
staged through `imports/stagedFile.ts`, which stats it and refuses it BEFORE the
copy (the 300 MB GeoPDF cap used to be checked after a full copy into
app-private storage, and the vector cap existed only in the picker path while
the share sheet read the whole file into one JS string). The GeoPDF ceiling is
**64 MB**, not 300: `parseSourcePdf` is the surviving whole-file read and an
Android app heap is 256-512 MB, so a higher cap only bought an OOM kill.
`buildTilePlan` caps the plan at `MAX_GEOPDF_TILES` by stepping zMax down, and
`estimateGeoPdfImport` prices the run before the first tile.

**A resume must describe the same plan.** `resumableFrom` (shared, beside the
planner) compares `GEOPDF_PARSER_VERSION`, `zMax` and `plan.tiles.length` before
honouring a checkpoint's cursor — zMax alone let a planner change replay half of
a *different* tile list and register the holed map as ready. **Bump
`GEOPDF_PARSER_VERSION` whenever anything in `tilePlan.ts` moves the tile list.**

**The registry row is written before the file.** `imports/geopdf/<sha>/` is
created after `insertGeoPdfImport`, so a kill mid-copy leaves a row with no file
(which the resume path reports and the user can discard) rather than a full-size
orphan PDF nothing sweeps.

Every entry point (picker, account GeoPDF, share sheet, Wi-Fi auto-download)
goes through `runGeoPdfImport` in `src/geopdf/importRunner.ts`, which is also the
"one import at a time" guard — two at once would fight over the single native
executor and, for the same file, over the same directory. See DESIGN.md §6 for
why it's a background card rather than a screen.

## Consequences

- **Positive:** parse went from 35 s on device to 1.5 s, worst stall 228 ms.
- **Negative:** GeoPDFs above 64 MB are refused.
- **Neutral:** **The rasteriser reports where its milliseconds went**
  (`renderMs`/`encodeMs` per batch, logged once per import as counts and
  durations only). Measured on the emulator for a 336-tile 1:25 000 sheet:
  render 60 s, PNG encode 24 s, everything else 15 s. pdfium re-walks the whole
  page's content on every `render()` call regardless of how small the region is,
  which is why render dominates.

## Alternatives considered

- A 300 MB cap: rejected; a higher cap only bought an OOM kill.
- Sharing one render across a block of tiles is the available big win — it is
  not built, because it would have to move the mesh warp's lattice off each
  tile's own `srcRect`, and getting that wrong produces a confidently misplaced
  map.
