import { useEffect, useMemo } from "react";
import {
  EXPORT_FORMAT_RULES,
  isLayerEligibleForFormat,
  reconcileExportSelection,
  validateExportRequest,
  type ExportFormat,
  type ExportBundling,
  type ExportSelection,
  type TopoLayerKey,
} from "@logjam/shared";
import { Checkbox, ChipRail, SectionHeader, type ChipOption } from "../../ui";
import { FieldError } from "../feedback/FieldError";
import { TOPO_LAYERS } from "../../topoLayerTypes";
import classes from "./topoSettings/topoSettings.module.css";

const FORMAT_ORDER: ExportFormat[] = ["mbtiles", "geotiff", "gpkg", "geojson", "gpx"];

const FORMAT_OPTIONS: ChipOption<ExportFormat>[] = FORMAT_ORDER.map((format) => ({
  value: format,
  label: EXPORT_FORMAT_RULES[format].label,
}));

interface Props {
  value: ExportSelection;
  onChange: (next: ExportSelection) => void;
  /** Layers the source can offer: the job's produced layers (export dialog) or
   *  the layers the chosen settings will produce (auto-export tab). */
  availableLayers: Set<TopoLayerKey>;
}

/**
 * What comes out of a topo: the file format, whether the layers arrive as one
 * file or several, and which of them. Shared by the export dialog (a finished
 * job) and the auto-export tab (a job not yet started), so the two cannot
 * disagree about what is legal — all of that lives in the shared
 * `reconcileExportSelection` / `validateExportRequest`.
 *
 * Each rail says what the chosen option MEANS underneath it (a `hint`, visible
 * and read with the control), where the old radio lists hid a format's
 * description in a tooltip nobody hovered and left the disabled bundling
 * choices unexplained.
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

  const bundlingOptions: ChipOption<ExportBundling>[] = [
    { value: "per-layer", label: "A file per layer", disabled: !rule.allowPerLayer },
    { value: "composite", label: "One file", disabled: !rule.allowComposite },
  ];
  const bundlingNote = !rule.allowPerLayer
    ? `${rule.label} is always one file.`
    : !rule.allowComposite
      ? `${rule.label} can't hold more than one layer in a file.`
      : null;

  const toggleLayer = (name: TopoLayerKey) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange({ ...value, layers: [...next] });
  };

  const layers = TOPO_LAYERS.filter((l) => availableLayers.has(l.name));

  return (
    <div className={classes.tabPanel}>
      <SectionHeader title="Format" />
      <ChipRail
        label="Format"
        options={FORMAT_OPTIONS}
        value={value.format}
        onChange={(format) => onChange({ ...value, format })}
      />
      <p className={classes.exportNote}>{rule.description}</p>

      <SectionHeader title="Bundling" />
      <ChipRail
        label="Bundling"
        options={bundlingOptions}
        value={value.bundling}
        onChange={(bundling) => onChange({ ...value, bundling })}
      />
      {bundlingNote && <p className={classes.exportNote}>{bundlingNote}</p>}

      <SectionHeader title="Layers" count={layers.length} />
      <div className={classes.checkList}>
        {layers.length === 0 && (
          <p className={classes.exportNote}>This topo didn't produce any layers to export.</p>
        )}
        {layers.map((l) => {
          // Single legality source (TOPOEXP-1) — never re-derive
          // format/layer rules inline.
          const eligible = isLayerEligibleForFormat(value.format, l.name);
          return (
            <Checkbox
              key={l.name}
              label={l.label}
              description={eligible ? undefined : `Can't be exported as a ${rule.label}`}
              checked={selected.has(l.name)}
              disabled={!eligible}
              onChange={() => toggleLayer(l.name)}
            />
          );
        })}
      </div>

      <FieldError message={validation.ok ? null : validation.error} />
    </div>
  );
}
