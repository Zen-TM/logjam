// What a form that makes a NEW place or trip holds while the photos and the way
// are picked: the picks themselves, the sheet that picks them, and the form
// stepping out of its way while a system picker runs. Shared by
// `PlaceEditSheet` and `TripEditSheet`, so the two cannot drift.
//
// A system picker cannot run under an open sheet (DESIGN.md §4), so while one
// of the pickers is up the form steps out of the way, state intact, like the
// map picker's `resuming` round trip. Nothing is queued until the form saves
// (`stagedPlaceMedia.ts`), so cancelling leaves nothing behind but the picked
// files, which `reset` and `cancel` delete.
import { useState } from "react";
import { mediaCategory } from "@logjam/shared";

import { useHues } from "../theme";
import { ADD_PHOTO_LABEL, PHOTO_SOURCES, pickMedia } from "../media/pickMedia";
import { discardPickedFile } from "../sync/mediaUpload";
import { BottomSheet, Button, IconButton, Row, SectionHeader } from "../ui";
import type { StagedWay } from "./AddWaySheet";
import {
  discardStagedMedia,
  NO_STAGED_MEDIA,
  type StagedMedia,
} from "./stagedPlaceMedia";

export type PickSheet = "photos" | "way";

export function useStagedMedia(onPickFailed: () => void) {
  const [staged, setStaged] = useState<StagedMedia>(NO_STAGED_MEDIA);
  const [pickSheet, setPickSheet] = useState<PickSheet | null>(null);
  // Outlasts the picking sheet: it clears on that sheet's `onClosed`, after any
  // system picker it parked.
  const [away, setAway] = useState(false);
  // The sheet to show once the form has finished sliding out: the two never
  // coexist (DESIGN.md §4).
  const [nextSheet, setNextSheet] = useState<PickSheet | null>(null);
  const [pickJob, setPickJob] = useState<null | (() => Promise<void>)>(null);

  /** Picks from an abandoned form are cache files nothing else will reach. */
  function discardFiles() {
    discardStagedMedia(staged, discardPickedFile);
    setStaged(NO_STAGED_MEDIA);
  }

  return {
    staged,
    setStaged,
    /** Stage a way, freeing the one it replaces. */
    stageWay(way: StagedWay) {
      void staged.way?.discard?.();
      setStaged((current) => ({ ...current, way }));
    },
    /** Take the staged way out, freeing what it holds. */
    removeWay() {
      void staged.way?.discard?.();
      setStaged((current) => ({ ...current, way: null }));
    },
    pickSheet,
    setPickSheet,
    away,
    setAway,
    /** Seeding a fresh form: drop whatever the last one held. */
    reset() {
      discardFiles();
      setPickSheet(null);
      setNextSheet(null);
      setAway(false);
      setPickJob(null);
    },
    /** Cancel: nothing was queued, so the held picks' files go too. */
    cancel: discardFiles,
    stepOutTo(sheet: PickSheet) {
      setAway(true);
      setNextSheet(sheet);
    },
    /** The form has finished sliding out. */
    formClosed() {
      if (nextSheet) setPickSheet(nextSheet);
      setNextSheet(null);
    },
    /** Close the photo sheet, then run the picker with nothing on screen. */
    pickFrom(source: "camera" | "library", kind: "photo" | "video") {
      setPickJob(() => async () => {
        const files = await pickMedia(source, kind);
        if (files.length > 0)
          setStaged((current) => ({
            ...current,
            files: [...current.files, ...files],
          }));
      });
      setPickSheet(null);
    },
    photoSheetClosed() {
      const job = pickJob;
      setPickJob(null);
      if (!job) {
        setAway(false);
        return;
      }
      void job()
        .catch((err: unknown) => {
          console.error(err);
          onPickFailed();
        })
        .finally(() => setAway(false));
    },
  };
}

export type StagedMediaState = ReturnType<typeof useStagedMedia>;

/** The photos picked so far, and the way to pick more. */
export function StagedPhotosSection({
  media,
  title,
  hint,
}: {
  media: StagedMediaState;
  title: string;
  hint: string;
}) {
  return (
    <>
      <SectionHeader title={title} />
      {media.staged.files.map((file, index) => {
        const video = mediaCategory(file.mimeType ?? "image/jpeg") === "video";
        const name = file.fileName ?? (video ? "Video" : "Photo");
        return (
          <Row
            key={`${file.uri}-${index}`}
            icon={video ? "video" : "photo"}
            title={name}
            subtitle={hint}
            right={
              <IconButton
                icon="close"
                accessibilityLabel={`Remove ${name}`}
                onPress={() => {
                  void discardPickedFile(file.uri);
                  media.setStaged((current) => ({
                    ...current,
                    files: current.files.filter((_, at) => at !== index),
                  }));
                }}
              />
            }
          />
        );
      })}
      <Button
        label={ADD_PHOTO_LABEL}
        icon="add"
        variant="outlineAccent"
        onPress={() => media.stepOutTo("photos")}
      />
    </>
  );
}

/** The way picked so far, and the way to pick another. */
export function StagedWaySection({
  media,
  title,
  hint,
  addLabel,
  chooseAnotherLabel,
}: {
  media: StagedMediaState;
  title: string;
  hint: string;
  addLabel: string;
  chooseAnotherLabel: string;
}) {
  const { assetHue } = useHues();
  const way = media.staged.way;
  return (
    <>
      <SectionHeader title={title} />
      {way ? (
        <Row
          icon="route"
          hue={assetHue.route}
          title={way.label}
          subtitle={hint}
          right={
            <IconButton
              icon="close"
              accessibilityLabel={`Remove ${way.label}`}
              onPress={media.removeWay}
            />
          }
        />
      ) : null}
      <Button
        label={way ? chooseAnotherLabel : addLabel}
        icon={way ? "replace" : "add"}
        variant="outlineAccent"
        onPress={() => media.stepOutTo("way")}
      />
    </>
  );
}

/** The sheet that says where a photo comes from. */
export function PhotoSourceSheet({ media }: { media: StagedMediaState }) {
  return (
    <BottomSheet
      visible={media.pickSheet === "photos"}
      onClose={() => media.setPickSheet(null)}
      onClosed={media.photoSheetClosed}
      title={ADD_PHOTO_LABEL}
    >
      {PHOTO_SOURCES.map((entry) => (
        <Row
          key={entry.title}
          icon={entry.icon}
          title={entry.title}
          onPress={() => media.pickFrom(entry.source, entry.kind)}
        />
      ))}
    </BottomSheet>
  );
}
