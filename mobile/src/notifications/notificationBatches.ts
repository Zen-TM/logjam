// COLLAPSING the notifications one bulk share created into a single expandable
// row.
// Re-exported from @logjam/shared.
export {
  type BatchGroup,
  type NotificationBatch,
  type NotificationTally,
  batchHeaderRow,
  batchKeyFromRowId,
  batchKeyOf,
  findNotificationBatches,
  collapseBatches,
  batchLabel,
  batchPendingFileSends,
  countBatchRows,
  tallyNotifications,
} from "@logjam/shared";
