import type { ReactNode } from "react";
import { Tooltip } from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import styles from "./topoSettings.module.css";

interface SettingsRowProps {
  label: string;
  tooltip?: string;
  children: ReactNode;
  trailing?: ReactNode;
}

export default function SettingsRow({ label, tooltip, children, trailing }: SettingsRowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.labelWithTooltip}>
        {label}
        {tooltip && (
          <Tooltip title={tooltip} placement="top" arrow>
            <InfoOutlinedIcon className={styles.infoIcon} />
          </Tooltip>
        )}
      </span>
      {children}
      <span>{trailing}</span>
    </div>
  );
}
