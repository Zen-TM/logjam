import type { SlopeSettings as SlopeSettingsValue, SlopeBand } from "@logjam/shared";
import ColourPicker from "../../common/ColourPicker";
import { Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import styles from "./topoSettings.module.css";

interface Props {
  value: SlopeSettingsValue;
  onChange: (next: SlopeSettingsValue) => void;
}

const MAX_BANDS = 8;

export default function SlopeSettings({ value, onChange }: Props) {
  const setBand = (idx: number, delta: Partial<SlopeBand>) => {
    const bands = value.bands.map((b, i) => (i === idx ? { ...b, ...delta } : b));
    onChange({ ...value, bands });
  };
  const removeBand = (idx: number) => {
    onChange({ ...value, bands: value.bands.filter((_, i) => i !== idx) });
  };
  const addBand = () => {
    if (value.bands.length >= MAX_BANDS) return;
    const last = value.bands[value.bands.length - 1];
    const from = last ? Math.min(89, last.toDeg) : 30;
    const to = Math.min(90, from + 10);
    onChange({
      ...value,
      bands: [...value.bands, { fromDeg: from, toDeg: to, colour: "#ff000080" }],
    });
  };

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Slope bands colour terrain by steepness. Pixels below the lowest band's
        <em> from</em> angle are transparent. Bands must not overlap and{" "}
        <em>from</em> must be less than <em>to</em>.{" "}
        <Tooltip title="Slope is computed in degrees from the DTM. Below the lowest band's from-angle, the layer is transparent." placement="top" arrow>
          <InfoOutlinedIcon className={styles.infoIcon} />
        </Tooltip>
      </p>

      <div className={styles.bandTable}>
        <Tooltip title="Slope angle in degrees from horizontal. Flat ground ≈ 0–5°; steep trail ≈ 20–30°; cliff / technical terrain ≈ 45°+." placement="top" arrow>
          <span className={styles.bandHeader}>From °</span>
        </Tooltip>
        <Tooltip title="Upper bound of this slope band in degrees. Must be greater than From °." placement="top" arrow>
          <span className={styles.bandHeader}>To °</span>
        </Tooltip>
        <span className={styles.bandHeader}>Colour</span>
        <span />
        {value.bands.map((band, idx) => (
          <Row
            key={idx}
            band={band}
            onChange={(d) => setBand(idx, d)}
            onRemove={() => removeBand(idx)}
            canRemove={value.bands.length > 1}
          />
        ))}
      </div>

      <Tooltip title="Maximum 8 bands — each is a separate colour pass in the tile pipeline." placement="top" arrow>
        <span>
          <button
            type="button"
            className={styles.addButton}
            onClick={addBand}
            disabled={value.bands.length >= MAX_BANDS}
          >
            + Add band ({value.bands.length}/{MAX_BANDS})
          </button>
        </span>
      </Tooltip>
    </div>
  );
}

interface RowProps {
  band: SlopeBand;
  onChange: (delta: Partial<SlopeBand>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function Row({ band, onChange, onRemove, canRemove }: RowProps) {
  return (
    <>
      <input
        type="number"
        className={styles.numberInput}
        min={0}
        max={90}
        step={1}
        value={band.fromDeg}
        onChange={(e) => onChange({ fromDeg: Number(e.target.value) })}
      />
      <input
        type="number"
        className={styles.numberInput}
        min={0}
        max={90}
        step={1}
        value={band.toDeg}
        onChange={(e) => onChange({ toDeg: Number(e.target.value) })}
      />
      <ColourPicker value={band.colour} onChange={(c) => onChange({ colour: c })} />
      {canRemove ? (
        <button type="button" className={styles.removeButton} onClick={onRemove}>
          Remove
        </button>
      ) : (
        <span />
      )}
    </>
  );
}
