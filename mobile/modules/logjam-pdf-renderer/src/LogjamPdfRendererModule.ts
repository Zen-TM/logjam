import { NativeModule, requireNativeModule } from "expo";

export interface RenderPageResult {
  pageCount: number;
  pageWidthPts: number;
  pageHeightPts: number;
  renderedWidthPx: number;
  renderedHeightPx: number;
}

declare class LogjamPdfRendererModule extends NativeModule {
  /**
   * Rasterise one PDF page to a PNG at `scale` × the page's point size.
   * Stage 0 spike surface — the Stage 6 rasteriser (tile pyramid → MBTiles)
   * will replace this API.
   */
  renderPage(
    pdfPath: string,
    pageIndex: number,
    scale: number,
    outputPngPath: string
  ): Promise<RenderPageResult>;
}

export default requireNativeModule<LogjamPdfRendererModule>("LogjamPdfRenderer");
