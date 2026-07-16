import { Fragment, useEffect, useState } from "react";
import { Menu, MenuItem } from "@mui/material";
import { Ellipsis } from "lucide-react";
import type { PanelId } from "./panels";
import {
  partitionNavItems,
  aggregateBadgeCount,
  isPanelInMore,
  type NavItem,
  type NavBadgeCounts,
} from "./navItems";
import { useIsMobile } from "../../useIsMobile";
import classes from "./NavRail.module.css";

const MORE_MENU_ID = "nav-more-menu";
const MORE_BUTTON_ID = "nav-more-button";

/** Badge shared by rail items and More-sheet rows. Renders nothing at 0. */
function NavBadge({ count, className }: { count: number; className: string }) {
  if (count <= 0) return null;
  return (
    <span className={className} aria-hidden="true">
      {count}
    </span>
  );
}

/** Badge counts are announced as text on the item's label rather than left to
 *  the visual badge, which is aria-hidden — a screen reader user gets
 *  "Alerts, 3 unread" instead of an unexplained "3". */
function labelWithBadge(label: string, count: number): string {
  return count > 0 ? `${label}, ${count} unread` : label;
}

function NavRail({
  activePanel,
  onPanelChange,
  badgeCounts,
}: {
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  badgeCounts: NavBadgeCounts;
}) {
  const isMobile = useIsMobile();
  const { railItems, moreItems, spacerAfterIndex } = partitionNavItems(isMobile);
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);

  const moreBadgeCount = aggregateBadgeCount(moreItems, badgeCounts);
  const moreOpen = moreAnchor !== null;
  // More reads as selected while its sheet is open or while it holds the open
  // panel, so the rail never looks like nothing is selected.
  const moreSelected = moreOpen || isPanelInMore(moreItems, activePanel);

  // Resizing across the breakpoint with the sheet open would leave a menu
  // anchored to a button that no longer exists.
  useEffect(() => {
    if (!isMobile) setMoreAnchor(null);
  }, [isMobile]);

  function handleClick(id: PanelId) {
    onPanelChange(activePanel === id ? null : id);
  }

  function renderNavItem(item: NavItem) {
    const { id, label, Icon } = item;
    const count = badgeCounts[id] ?? 0;
    return (
      <button
        key={id}
        className={`${classes.navItem} ${activePanel === id ? classes.active : ""}`}
        onClick={() => handleClick(id)}
        title={label}
        aria-label={labelWithBadge(label, count)}
        aria-current={activePanel === id ? "page" : undefined}
      >
        <Icon size={20} />
        <span className={classes.label}>{label}</span>
        <NavBadge count={count} className={classes.badge} />
      </button>
    );
  }

  return (
    <nav className={classes.navRail}>
      {railItems.map((item, index) => (
        <Fragment key={item.id}>
          {renderNavItem(item)}
          {index === spacerAfterIndex && <div className={classes.spacer} />}
        </Fragment>
      ))}

      {moreItems.length > 0 && (
        <>
          <button
            id={MORE_BUTTON_ID}
            className={`${classes.navItem} ${moreSelected ? classes.active : ""}`}
            onClick={(event) => setMoreAnchor(event.currentTarget)}
            title="More"
            aria-label={labelWithBadge("More", moreBadgeCount)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? MORE_MENU_ID : undefined}
          >
            <Ellipsis size={20} />
            <span className={classes.label}>More</span>
            <NavBadge count={moreBadgeCount} className={classes.badge} />
          </button>

          {/* MUI Menu (not the app's BottomSheet, which carries no focus trap
              or Escape handling) so the sheet gets WAI-ARIA menu semantics,
              focus trap, Escape-to-close, focus restore to the More button,
              and arrow-key/typeahead navigation without hand-rolling any of
              it. Anchored to open upward off the bottom strip. */}
          <Menu
            id={MORE_MENU_ID}
            anchorEl={moreAnchor}
            open={moreOpen}
            onClose={() => setMoreAnchor(null)}
            anchorOrigin={{ vertical: "top", horizontal: "right" }}
            transformOrigin={{ vertical: "bottom", horizontal: "right" }}
            MenuListProps={{ "aria-labelledby": MORE_BUTTON_ID }}
            slotProps={{
              paper: {
                sx: {
                  backgroundColor: "var(--theme-primary)",
                  color: "var(--theme-text-primary)",
                  minWidth: 200,
                },
              },
            }}
          >
            {moreItems.map(({ id, label, Icon }) => {
              const count = badgeCounts[id] ?? 0;
              return (
                <MenuItem
                  key={id}
                  selected={activePanel === id}
                  onClick={() => {
                    setMoreAnchor(null);
                    handleClick(id);
                  }}
                  aria-label={labelWithBadge(label, count)}
                  sx={{
                    // Match the rail's 48px touch targets.
                    minHeight: 48,
                    gap: 1.5,
                    fontSize: "0.9em",
                    "&.Mui-selected": {
                      backgroundColor:
                        "color-mix(in srgb, var(--theme-secondary) 80%, transparent)",
                    },
                  }}
                >
                  <Icon size={18} />
                  <span className={classes.moreLabel}>{label}</span>
                  <NavBadge count={count} className={classes.moreBadge} />
                </MenuItem>
              );
            })}
          </Menu>
        </>
      )}
    </nav>
  );
}

export default NavRail;
