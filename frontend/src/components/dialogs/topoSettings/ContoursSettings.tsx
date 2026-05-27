import type { RasterContoursSettings, ContourZoomBand } from "@logjam/shared";
import SettingsRow from "./SettingsRow";
import styles from "./topoSettings.module.css";

interface Props {
  value: RasterContoursSettings;
  onChange: (next: RasterContoursSettings) => void;
}

export default function ContoursSettings({ value, onChange }: Props) {
  const setBand = (idx: number, delta: Partial<ContourZoomBand>) => {
    const zoomBands = value.zoomBands.map((b, i) => (i === idx ? { ...b, ...delta } : b));
    onChange({ ...value, zoomBands });
  };

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Three fixed zoom bands. For each, set the contour interval (metres
        between lines) and how often a major line is drawn. Contour colours and
        widths live in <strong>Vector styles</strong> on the LiDAR Topos panel
        and apply live to the map; this dialog covers only what the composite
        raster bake needs.
      </p>

      <h4 className={styles.sectionTitle}>Zoom bands</h4>
      {value.zoomBands.map((band, idx) => (
        <div key={idx} className={styles.section}>
          <div className={styles.zoomBandHeading}>
            Zoom {band.zoomMin}–{band.zoomMax}
          </div>
          <SettingsRow
            label="Interval (m)"
            tooltip="Vertical spacing between contour lines at this zoom range."
          >
            <input
              type="number"
              className={styles.numberInput}
              min={0.1}
              step={1}
              value={band.intervalM}
              onChange={(e) => setBand(idx, { intervalM: Number(e.target.value) })}
            />
          </SettingsRow>
          <SettingsRow
            label="Major every N"
            tooltip="Every Nth contour line is rendered with the major colour and width."
          >
            <input
              type="number"
              className={styles.numberInput}
              min={1}
              max={100}
              step={1}
              value={band.majorEveryN}
              onChange={(e) => setBand(idx, { majorEveryN: Number(e.target.value) })}
            />
          </SettingsRow>
        </div>
      ))}
    </div>
  );
}
