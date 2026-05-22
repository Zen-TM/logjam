import { Switch, Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import {
  OSM_FEATURE_KEYS,
  OSM_FEATURE_LABELS,
  OSM_FEATURE_TAG_HINTS,
  type OsmFeaturesSettings as OsmFeaturesSettingsValue,
  type OsmFeatureKey,
  type OsmFeatureStyle,
} from "@logjam/shared";
import ColourPicker from "../../common/ColourPicker";
import styles from "./topoSettings.module.css";

interface Props {
  value: OsmFeaturesSettingsValue;
  onChange: (next: OsmFeaturesSettingsValue) => void;
}

export default function OsmSettings({ value, onChange }: Props) {
  const setFeature = (key: OsmFeatureKey, delta: Partial<OsmFeatureStyle>) => {
    onChange({
      ...value,
      features: {
        ...value.features,
        [key]: { ...value.features[key], ...delta },
      },
    });
  };

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Toggle individual OSM feature categories on or off, and tweak their
        colour and stroke width. Tag hints describe which OSM tags each category
        fetches.
      </p>

      <div>
        <div className={styles.featureRow}>
          <span />
          <span />
          <span className={styles.bandHeader}>Colour</span>
          <span className={styles.labelWithTooltip}>
            <span className={styles.bandHeader}>Width</span>
            <Tooltip title="Line width in pixels at zoom 18 (maximum detail level). Scales automatically at other zoom levels. Typical: 3–5 for thin paths, 10–15 for prominent roads." placement="top" arrow>
              <InfoOutlinedIcon className={styles.infoIcon} />
            </Tooltip>
          </span>
        </div>
        {OSM_FEATURE_KEYS.map((key) => {
          const style = value.features[key];
          const rowClass = `${styles.featureRow} ${style.enabled ? "" : styles.featureRowDisabled}`;
          return (
            <div key={key} className={rowClass}>
              <Switch
                size="small"
                checked={style.enabled}
                onChange={(_, checked) => setFeature(key, { enabled: checked })}
              />
              <span className={styles.labelWithTooltip}>
                {OSM_FEATURE_LABELS[key]}
                <Tooltip title={OSM_FEATURE_TAG_HINTS[key]} placement="top" arrow>
                  <InfoOutlinedIcon className={styles.infoIcon} />
                </Tooltip>
              </span>
              <span className={styles.colourCell}>
                <ColourPicker
                  value={style.colour}
                  onChange={(c) => setFeature(key, { colour: c })}
                  ariaLabel={`${OSM_FEATURE_LABELS[key]} colour`}
                />
              </span>
              <span className={styles.widthCell}>
                <input
                  type="number"
                  className={styles.numberInput}
                  min={0}
                  step={1}
                  value={style.widthZ18}
                  onChange={(e) => setFeature(key, { widthZ18: Number(e.target.value) })}
                  aria-label={`${OSM_FEATURE_LABELS[key]} width at zoom 18`}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
