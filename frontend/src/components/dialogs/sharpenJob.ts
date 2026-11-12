import {
  RASTER_TEMPLATE_DEFAULTS,
  type RasterTemplateSettings,
} from "@logjam/shared";

/**
 * What a new job asks for. It carries no style choice (its one styled layer,
 * vegetation, draws in the default style). Vegetation only when it was ticked
 * and the ZIP has point clouds (the API's `sharpenMark` reads
 * `vegetation.enabled`).
 */
export function sharpenJobRequest(
  vegetation: boolean,
  lazCount: number,
): { settings: RasterTemplateSettings } {
  return {
    settings: {
      ...RASTER_TEMPLATE_DEFAULTS,
      vegetation: {
        ...RASTER_TEMPLATE_DEFAULTS.vegetation,
        enabled: vegetation && lazCount > 0,
      },
    },
  };
}
