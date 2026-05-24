import type { ContoursSettings as ContoursSettingsValue, ContourZoomBand } from "@logjam/shared";
import ColourPicker from "../../common/ColourPicker";
import SettingsRow from "./SettingsRow";
import styles from "./topoSettings.module.css";

interface Props {
  value: ContoursSettingsValue;
  onChange: (next: ContoursSettingsValue) => void;
}

export default function ContoursSettings({ value, onChange }: Props) {
  const patch = (delta: Partial<ContoursSettingsValue>) => onChange({ ...value, ...delta });

  const setBand = (idx: number, delta: Partial<ContourZoomBand>) => {
    const zoomBands = value.zoomBands.map((b, i) => (i === idx ? { ...b, ...delta } : b));
    onChange({ ...value, zoomBands });
  };

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Three fixed zoom bands. For each, set the contour interval (metres
        between lines) and how often a major line is drawn. The major colour
        and width apply to every Nth line; the minor style applies to the rest.
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

      <h4 className={styles.sectionTitle}>Major lines</h4>
      <SettingsRow label="Major colour" tooltip="Colour applied to every Nth contour line.">
        <ColourPicker value={value.majorColour} onChange={(c) => patch({ majorColour: c })} />
      </SettingsRow>
      <SettingsRow label="Major width (m)" tooltip="Line thickness in ground metres for major contours.">
        <input
          type="number"
          className={styles.numberInput}
          min={0}
          step={1}
          value={value.majorWidthM}
          onChange={(e) => patch({ majorWidthM: Number(e.target.value) })}
        />
      </SettingsRow>

      <h4 className={styles.sectionTitle}>Minor lines</h4>
      <SettingsRow label="Minor colour" tooltip="Colour applied to all non-major contour lines.">
        <ColourPicker value={value.minorColour} onChange={(c) => patch({ minorColour: c })} />
      </SettingsRow>
      <SettingsRow label="Minor width (m)" tooltip="Line thickness in ground metres for minor contours.">
        <input
          type="number"
          className={styles.numberInput}
          min={0}
          step={1}
          value={value.minorWidthM}
          onChange={(e) => patch({ minorWidthM: Number(e.target.value) })}
        />
      </SettingsRow>
    </div>
  );
}
