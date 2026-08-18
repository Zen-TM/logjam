// Kit barrel — screens import components from "../ui" rather than reaching into
// individual files. Keep this the single public surface of the UI kit.
export { ActivitySpark, type ActivityBucket } from "./ActivitySpark";
export { Button } from "./Button";
export { CapacityBar, type CapacitySegment } from "./CapacityBar";
export { Card } from "./Card";
export { Chip } from "./Chip";
export { ChipPicker, type ChipOption } from "./ChipPicker";
export { DatePicker } from "./DatePicker";
export { RangePills } from "./RangePills";
export { formatRange, isFullRange, nextRange, type NumberRange } from "./rangeSelect";
export { HeroHeader } from "./HeroHeader";
export { toDateKey, fromDateKey, todayDateKey } from "./monthGrid";
export { IconButton } from "./IconButton";
export { SectionHeader } from "./SectionHeader";
export { StatusPill } from "./StatusPill";
export { SyncStatusPills } from "./SyncStatusPills";
export { Toggle } from "./Toggle";
export { SegmentedControl, type SegmentOption } from "./SegmentedControl";
export { BottomSheet } from "./BottomSheet";
export { TextField } from "./TextField";
export { EmptyState, ErrorState, LoadingState } from "./ScreenStates";
export { ErrorBanner } from "./ErrorBanner";
export { RootErrorBoundary } from "./RootErrorBoundary";
export { RenameForm } from "./RenameForm";
export { Screen, ScreenScroll } from "./Screen";
export { Row } from "./Row";
export { StatGrid, type Stat } from "./StatGrid";
export {
  ProfileChart,
  elevationSeries,
  speedSeries,
  type ProfileSeries,
} from "./ProfileChart";
export { Toast, type ToastMessage } from "./Toast";
