import {
  AUTO_EXPORT_DEFAULTS,
  type AutoExportSettings,
  type RasterTemplateSettings,
} from "@logjam/shared";

/**
 * What a new job asks for once jobs sharpen (`SHARPEN_NEW_JOBS`). It carries
 * no style choice (its one styled layer, vegetation, draws in the default
 * style) and no auto-export: a sharpened job has none of the files an export
 * reads. Vegetation only when it was ticked and the ZIP has point clouds
 * (the API's `sharpenMark` reads `vegetation.enabled`).
 */
export function sharpenJobRequest(
  settings: RasterTemplateSettings,
  vegetation: boolean,
  lazCount: number,
): { settings: RasterTemplateSettings; autoExport: AutoExportSettings } {
  return {
    settings: {
      ...settings,
      vegetation: {
        ...settings.vegetation,
        enabled: vegetation && lazCount > 0,
      },
    },
    autoExport: { ...AUTO_EXPORT_DEFAULTS, enabled: false },
  };
}
