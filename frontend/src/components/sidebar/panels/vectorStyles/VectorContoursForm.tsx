import type { VectorContoursStyle } from "@logjam/shared";
import ColourPicker from "../../../common/ColourPicker";
import SettingsRow from "../../../dialogs/topoSettings/SettingsRow";
import styles from "../../../dialogs/topoSettings/topoSettings.module.css";

interface Props {
  value: VectorContoursStyle;
  onChange: (next: VectorContoursStyle) => void;
}

export default function VectorContoursForm({ value, onChange }: Props) {
  const patch = (delta: Partial<VectorContoursStyle>) => onChange({ ...value, ...delta });

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Colours and line widths for vector contours on the map. Changes apply
        live to all completed LiDAR jobs. New jobs snapshot these values into
        the composite raster at submit time.
      </p>

      <h4 className={styles.sectionTitle}>Major lines</h4>
      <SettingsRow label="Major colour" tooltip="Colour applied to every Nth contour line.">
        <ColourPicker value={value.majorColour} onChange={(c) => patch({ majorColour: c })} />
      </SettingsRow>
      <SettingsRow label="Major width (m)" tooltip="Line thickness in ground metres for major contours.">
        <input
          type="number"
          aria-label="Major contour width in metres"
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
          aria-label="Minor contour width in metres"
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
