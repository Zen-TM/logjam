# 0010. What syncs

- **Date:** 2026-09-25
- **Status:** Accepted
- **Supersedes:** —

## Context

Before this, the sync boundary was decided piecemeal and invisible: a GPX linked to a place synced while the same file imported on its own did not, and routes synced while imports did not.

Seven categories and a 4/3 split existed until the places rework: markers were their own Saved category, and folding them into places took the category with them — a shared place surfaces on the Places screen under its type's tab, not in Saved.

An earlier "This device" pill on every region and GeoPDF spent a whole pill saying something reassuring in the language of a warning, on the rows least at risk, while the rows a user actually worries about said nothing.

## Decision

What syncs has ONE rule, and it is stated in the UI: things you made sync, maps you downloaded stay on this device. Places, routes, imports and recorded tracks belong to the account; offline regions, LiDAR topo overlays and GeoPDFs are map material obtained elsewhere and stay on the handset. It splits the Saved tab's six categories 3/3 with no exception to explain, which is why it can be said in one sentence.

The user meets it TWICE and in two registers:
1. A small green cloud on each Saved row that is actually in the account (`theme.success`, per item, derived from `pendingCreateIds` rather than from the category — the category says what SHOULD be there, the outbox says what is). Mark the positive, never the absence.
2. The sentence itself in Settings → Offline and storage. The rule does NOT belong at the top of Saved — that is the most valuable space on the tab, for a sentence read once.

The declaration is `CATEGORY_SYNCS` in `mobile/src/saved/savedKeys.ts` (RN-free, so it is testable) and NOT `SavedScreen`'s `CATEGORY_META`; a new Saved category cannot be added without answering the question, because the `Record<SavedCategory, boolean>` refuses the omission.

Guard: `mobile/src/saved/savedKeys.test.ts` pins the actual split rather than only its completeness — so a change there fails until the hero copy that states the rule moves with it.

## Consequences

- **Positive:** splits the Saved tab's six categories 3/3 with no exception to explain; a new Saved category cannot be added without explicitly declaring whether it syncs (`Record<SavedCategory, boolean>`).
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

- An earlier "This device" pill on every region and GeoPDF: rejected; spent a whole pill saying something reassuring in the language of a warning, on the rows least at risk, while the rows a user actually worries about said nothing.
- Placing the rule at the top of Saved: rejected; that is the most valuable space on the tab, for a sentence read once.
- Declaring sync status in `SavedScreen`'s `CATEGORY_META`: rejected in favour of `CATEGORY_SYNCS` in `mobile/src/saved/savedKeys.ts` (RN-free, so it is testable).
