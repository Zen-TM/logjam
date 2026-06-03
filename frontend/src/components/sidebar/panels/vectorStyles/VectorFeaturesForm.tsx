import { Switch, Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import {
  OSM_FEATURE_LABELS,
  OSM_FEATURE_TAG_HINTS,
  OSM_LINE_FEATURE_KEYS,
  OSM_POINT_FEATURE_KEYS,
  type OsmFeatureKey,
  type OsmFeatureStyle,
  type OsmPointFeatureKey,
  type VectorStyleSettings,
} from "@logjam/shared";
import ColourPicker from "../../../common/ColourPicker";
import styles from "../../../dialogs/topoSettings/topoSettings.module.css";

const POINT_KEY_SET = new Set<OsmFeatureKey>(OSM_POINT_FEATURE_KEYS);

const ICON_FILENAMES: Record<OsmPointFeatureKey, string> = {
  campsite: "campsite.png",
  peak: "peak.png",
  spring: "spring.png",
  gate: "gate.png",
  cave: "cave.png",
  ford: "ford.png",
  waterfall: "waterfall.png",
  trailhead: "trailhead.png",
  viewpoint: "viewpoint.png",
  hut: "hut.png",
};

interface Props {
  value: VectorStyleSettings["features"];
  onChange: (next: VectorStyleSettings["features"]) => void;
}

export default function VectorFeaturesForm({ value, onChange }: Props) {
  const setFeature = (key: OsmFeatureKey, delta: Partial<OsmFeatureStyle>) => {
    onChange({ ...value, [key]: { ...value[key], ...delta } });
  };

  return (
    <div className={styles.tabPanel}>
      <p className={styles.helpText}>
        Toggle individual OSM feature categories on or off. Line features
        (waterways, tracks, roads) support colour and stroke width overrides.
        Point features use fixed topographic icons. Changes apply live to all
        completed LiDAR jobs.
      </p>

      <div>
        {[...OSM_LINE_FEATURE_KEYS, ...OSM_POINT_FEATURE_KEYS].map((key) => {
          const style = value[key];
          const rowClass = `${styles.featureRow} ${style.enabled ? "" : styles.featureRowDisabled}`;
          const isPoint = POINT_KEY_SET.has(key);
          return (
            <div key={key} className={rowClass}>
              <div className={styles.featureTopLine}>
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
                  {isPoint ? (
                    <Tooltip title="Fixed topographic icon" placement="top" arrow>
                      <img
                        src={`/topo-icons/${ICON_FILENAMES[key as OsmPointFeatureKey]}`}
                        alt={OSM_FEATURE_LABELS[key]}
                        className={styles.featureIcon}
                      />
                    </Tooltip>
                  ) : (
                    <ColourPicker
                      value={style.colour}
                      onChange={(c) => setFeature(key, { colour: c })}
                      ariaLabel={`${OSM_FEATURE_LABELS[key]} colour`}
                    />
                  )}
                </span>
              </div>
              {!isPoint && (
                <div className={styles.featureWidthLine}>
                  <span className={styles.featureWidthLabel}>Width</span>
                  <Tooltip title="Line width in pixels at zoom 18 (maximum detail level). Scales automatically at other zoom levels. Typical: 3–5 for thin paths, 10–15 for prominent roads." placement="top" arrow>
                    <InfoOutlinedIcon className={styles.infoIcon} />
                  </Tooltip>
                  <input
                    type="number"
                    className={styles.numberInput}
                    min={0}
                    step={1}
                    value={style.widthZ18}
                    onChange={(e) => setFeature(key, { widthZ18: Number(e.target.value) })}
                    aria-label={`${OSM_FEATURE_LABELS[key]} width at zoom 18`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
