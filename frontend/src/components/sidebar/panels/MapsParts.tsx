// The rows the Maps page's two views share for what is still being made. Two
// views of one page must not draw the same row two ways.
import { useState } from "react";
import { X } from "lucide-react";
import { Button, IconButton, IconTile, ProgressBar, Row, StatusPill } from "../../../ui";
import { MAP_IDENTITY, type MakingItem } from "./mapsModel";
import classes from "./MapsPanel.module.css";

/**
 * "Being made": every job the user is still waiting on, PINNED under the list
 * rather than heading it.
 *
 * It was the first section of the list, which put the page's most conditional
 * content in its most valuable space — empty almost always, one or two rows the
 * rest of the time — and it went out of sight the moment the list was scrolled,
 * which is where the waiting is happening (operator, 2026-09-18). Pinned, it
 * costs nothing while there is nothing, and it is visible from every tab: the
 * job whose progress you came back to check is not on a tab of its own.
 *
 * Two cards at most. A third and beyond fold behind one line that counts them
 * and opens them in place, because more than two at once is rare and a footer
 * that grows without limit is the list with extra steps.
 *
 * A FAILED job stays here, with Dismiss on the card. A failure is the end of
 * the wait this footer is showing, so it belongs where the person waiting is
 * already looking; the Inbox has its own notification, so dismissing it here
 * loses nothing.
 */
export function MakingFooter({
  items,
  onDismiss,
}: {
  items: readonly MakingItem[];
  onDismiss: (item: MakingItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const folded = items.length > 2 && !expanded;
  const shown = folded ? items.slice(0, 1) : items;

  return (
    <section
      className={classes.footer}
      data-expanded={expanded || undefined}
      aria-label={`Being made, ${items.length}`}
    >
      <div className={classes.footerList}>
        {shown.map((item) => (
          <MakingRow key={item.key} item={item} onDismiss={onDismiss} />
        ))}
      </div>
      {items.length > 2 && (
        <Button
          compact
          variant="plain"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className={classes.footerMore}
        >
          {expanded ? "Show fewer" : `${items.length - 1} more being made`}
        </Button>
      )}
    </section>
  );
}

/** A running job moves a bar; a failed one says so in a pill and in the
 *  worker's own words, and its one verb — Dismiss, which deletes the dead row —
 *  is a button on the row rather than a menu of one. */
function MakingRow({ item, onDismiss }: { item: MakingItem; onDismiss: (item: MakingItem) => void }) {
  const identity = MAP_IDENTITY[item.kind];
  return (
    <Row
      data-making-key={item.key}
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
}
