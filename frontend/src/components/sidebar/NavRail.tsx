import { Fragment, type Ref } from "react";
import { Ellipsis, Map as MapIcon, type LucideIcon } from "lucide-react";
import type { PanelId } from "./panels";
import {
  partitionNavItems,
  aggregateBadgeCount,
  isPanelInMore,
  labelWithBadge,
  type NavBadgeCounts,
} from "./navItems";
import { useIsMobile } from "../../useIsMobile";
import BrandMark from "../brand/BrandMark";
import { Menu } from "../../ui";
import classes from "./NavRail.module.css";

/** One destination: an icon in a pill over its label. The active page fills the
 *  pill with the accent — the only filled thing on the rail. */
function NavButton({
  label,
  Icon,
  active,
  count,
  onClick,
  ref,
  ...rest
}: {
  label: string;
  Icon: LucideIcon;
  active: boolean;
  count: number;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      ref={ref}
      type="button"
      className={classes.item}
      data-active={active}
      aria-label={labelWithBadge(label, count)}
      onClick={onClick}
      {...rest}
    >
      <span className={classes.pill}>
        <Icon size={22} aria-hidden />
      </span>
      <span className={classes.label}>{label}</span>
      {count > 0 && (
        <span className={classes.badge} aria-hidden>
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * The page nav. A fixed 84px rail on desktop — every page labelled, the active
 * one filled — and Logjam GPS's tab bar on narrow web (Map · Places · Logs ·
 * Ways · More). Pressing the open page's button closes it; on narrow web the
 * Map tab does.
 */
function NavRail({
  activePanel,
  onPanelChange,
  badgeCounts,
}: {
  activePanel: PanelId | null;
  onPanelChange: (panel: PanelId | null) => void;
  badgeCounts: NavBadgeCounts;
}) {
  const isNarrow = useIsMobile();
  const { railItems, moreItems, spacerAfterIndex } = partitionNavItems(isNarrow);

  const toggle = (id: PanelId) => onPanelChange(activePanel === id ? null : id);

  const items = railItems.map((item, index) => (
    <Fragment key={item.id}>
      <NavButton
        label={item.label}
        Icon={item.Icon}
        active={activePanel === item.id}
        aria-current={activePanel === item.id ? "page" : undefined}
        count={badgeCounts[item.id] ?? 0}
        onClick={() => toggle(item.id)}
      />
      {index === spacerAfterIndex && <div className={classes.spacer} />}
    </Fragment>
  ));

  if (!isNarrow) {
    return (
      <nav className={classes.rail} aria-label="Pages">
        <div className={classes.brand}>
          <BrandMark className={classes.brandMark} />
        </div>
        {items}
      </nav>
    );
  }

  const moreCount = aggregateBadgeCount(moreItems, badgeCounts);
  return (
    <nav className={classes.tabs} aria-label="Pages">
      <NavButton
        label="Map"
        Icon={MapIcon}
        active={activePanel === null}
        aria-current={activePanel === null ? "page" : undefined}
        count={0}
        onClick={() => onPanelChange(null)}
      />
      {items}
      <Menu
        label="More pages"
        placement="top-end"
        entries={moreItems.map((item) => ({
          id: item.id,
          label: item.label,
          accessibleLabel: labelWithBadge(item.label, badgeCounts[item.id] ?? 0),
          icon: item.Icon,
          badge: badgeCounts[item.id],
          onSelect: () => toggle(item.id),
        }))}
        trigger={(props) => (
          <NavButton
            {...props}
            label="More"
            Icon={Ellipsis}
            active={isPanelInMore(moreItems, activePanel)}
            count={moreCount}
          />
        )}
      />
    </nav>
  );
}

export default NavRail;
