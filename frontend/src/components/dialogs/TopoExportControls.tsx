import { useEffect, useMemo } from "react";
import {
  Box,
  Typography,
  FormGroup,
  FormControlLabel,
  Checkbox,
  RadioGroup,
  Radio,
  Tooltip,
} from "@mui/material";
import {
  EXPORT_FORMAT_RULES,
  reconcileExportSelection,
  validateExportRequest,
  type ExportFormat,
  type ExportBundling,
  type ExportSelection,
  type TopoLayerKey,
} from "@logjam/shared";
import { TOPO_LAYERS } from "../../topoLayerTypes";

const FORMAT_ORDER: ExportFormat[] = ["mbtiles", "geotiff", "gpkg", "geojson", "gpx"];

interface Props {
  value: ExportSelection;
  onChange: (next: ExportSelection) => void;
  /** Layers the source can offer: the job's produced layers (export dialog) or
   *  the layers the chosen settings will produce (auto-export tab). */
  availableLayers: Set<TopoLayerKey>;
}

/**
 * Format / bundling / layer picker shared by TopoExportDialog (manual export of
 * a completed job) and the Auto-export settings tab (pre-configured export). All
 * legality logic lives in the shared `reconcileExportSelection` /
 * `validateExportRequest` so the two surfaces can't drift.
 */
export default function TopoExportControls({ value, onChange, availableLayers }: Props) {
  const rule = EXPORT_FORMAT_RULES[value.format];
  const selected = useMemo(() => new Set(value.layers), [value.layers]);

  // Keep the selection legal for the current format + available layers. Pruning
  // is idempotent (reconcile(reconcile(x)) === reconcile(x)), so emitting the
  // reconciled value here settles in one pass without looping.
  useEffect(() => {
    const next = reconcileExportSelection(value, availableLayers);
    if (
      next.bundling !== value.bundling ||
      next.layers.length !== value.layers.length ||
      next.layers.some((l) => !selected.has(l))
    ) {
      onChange(next);
    }
  }, [value, availableLayers, selected, onChange]);

  const validation = useMemo(
    () => validateExportRequest({ format: value.format, bundling: value.bundling, layers: value.layers }),
    [value.format, value.bundling, value.layers],
  );

  const toggleLayer = (name: TopoLayerKey) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange({ ...value, layers: [...next] });
  };

  return (
    <Box>
      <Box sx={{ display: "flex", gap: 3, flexDirection: { xs: "column", sm: "row" }, mb: 2 }}>
        {/* Left column: Format + Bundling (bundling legality depends on format). */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>Format</Typography>
          <RadioGroup
            value={value.format}
            onChange={(e) => onChange({ ...value, format: e.target.value as ExportFormat })}
          >
            {FORMAT_ORDER.map((f) => (
              <Tooltip key={f} title={EXPORT_FORMAT_RULES[f].description} placement="right" arrow>
                <FormControlLabel
                  value={f}
                  control={<Radio size="small" />}
                  label={EXPORT_FORMAT_RULES[f].label}
                />
              </Tooltip>
            ))}
          </RadioGroup>

          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", display: "block", mt: 1 }}>Bundling</Typography>
          <RadioGroup
            value={value.bundling}
            onChange={(e) => onChange({ ...value, bundling: e.target.value as ExportBundling })}
          >
            <Tooltip
              title={rule.allowPerLayer ? "" : `${rule.label} is inherently bundled.`}
              placement="right"
              arrow
            >
              <span>
                <FormControlLabel
                  value="per-layer"
                  control={<Radio size="small" />}
                  label="One file per layer (ZIP)"
                  disabled={!rule.allowPerLayer}
                />
              </span>
            </Tooltip>
            <Tooltip
              title={rule.allowComposite ? "" : `${rule.label} cannot be composited.`}
              placement="right"
              arrow
            >
              <span>
                <FormControlLabel
                  value="composite"
                  control={<Radio size="small" />}
                  label="Single composite file"
                  disabled={!rule.allowComposite}
                />
              </span>
            </Tooltip>
          </RadioGroup>
        </Box>

        {/* Right column: Layers. */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>Layers</Typography>
          <FormGroup>
            {TOPO_LAYERS.filter((l) => availableLayers.has(l.name)).map((l) => {
              const eligible =
                (l.format === "raster" && rule.allowRaster) ||
                (l.format === "vector" && rule.allowVector);
              return (
                <FormControlLabel
                  key={l.name}
                  control={
                    <Checkbox
                      size="small"
                      checked={selected.has(l.name)}
                      disabled={!eligible}
                      onChange={() => toggleLayer(l.name)}
                    />
                  }
                  label={`${l.label}${!eligible ? ` (n/a for ${rule.label})` : ""}`}
                />
              );
            })}
          </FormGroup>
        </Box>
      </Box>

      {!validation.ok && (
        <Typography variant="caption" sx={{ color: "var(--theme-warning)", display: "block" }}>
          {validation.error}
        </Typography>
      )}
    </Box>
  );
}
