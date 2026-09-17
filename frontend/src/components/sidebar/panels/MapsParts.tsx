// The rows the Maps page's two views share for what is still being made. Two
// views of one page must not draw the same row two ways.
import { X } from "lucide-react";
import { IconButton, IconTile, ProgressBar, Row, SectionHeader, StatusPill } from "../../../ui";
import { MAP_IDENTITY, type MakingItem } from "./mapsModel";
import classes from "./MapsPanel.module.css";

/**
 * "Being made": every job the user is still waiting on. A running job moves a
 * bar; a failed one says so in a pill and in the worker's own words, and its one
 * verb — Dismiss, which deletes the dead row — is a button on the row rather
 * than a menu of one.
 */
export function MakingSection({
  items,
  onDismiss,
}: {
  items: readonly MakingItem[];
  onDismiss: (item: MakingItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className={classes.section} aria-labelledby="maps-being-made">
      <SectionHeader id="maps-being-made" title="Being made" count={items.length} />
      {items.map((item) => {
        const identity = MAP_IDENTITY[item.kind === "geoPdf" ? "geoPdf" : item.kind];
        return (
          <Row
            key={item.key}
            data-making-key={item.key}
            className={classes.row}
            title={item.title}
            subtitle={item.detail}
            description={identity.label}
            leading={<IconTile icon={identity.icon} hue={identity.hue} label={identity.label} />}
            trailing={
              item.failed ? (
                <>
                  <StatusPill label="Failed" tone="warning" />
                  <IconButton icon={X} label={`Dismiss ${item.title}`} onClick={() => onDismiss(item)} />
                </>
              ) : undefined
            }
            footer={item.failed ? undefined : <ProgressBar label={`${item.title}: ${item.detail}`} />}
          />
        );
      })}
    </section>
  );
}
