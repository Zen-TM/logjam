// A plan place, read: what it is, where, its notes, attributes and photos,
// as Logjam GPS's plan place sheet shows it. One step inside the Map view, so
// the map stays beside it (shared/DESIGN.md §10: a page is for looking).
// Read-only: editing is the row's ⋯.
import { useState } from "react";
import {
  attributeRows,
  formatElevationM,
  formatFieldValue,
  mapPointPosition,
  mediaCategory,
  PLACE_PAGE,
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPES,
  TRIP_PLAN_PAGE,
  tripPlanAddedByLine,
  tripPlanCopyCoordinatesLabel,
  userFieldValues,
  type TripPlanPlace,
} from "@logjam/shared";
import { Hero, IconButton, IconTile, Row, SectionHeader } from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import PlaceSlideshow from "../media/PlaceSlideshow";
import classes from "./plans.module.css";

const copy = PLACE_PAGE.copy;
const planCopy = TRIP_PLAN_PAGE.copy;

export default function PlanPlacePage({
  place,
  onBack,
}: {
  place: TripPlanPlace;
  onBack: () => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const type = SYSTEM_PLACE_TYPES.find((each) => each.id === place.placeTypeId);
  const position = mapPointPosition(place);
  const attributes = attributeRows(
    SYSTEM_FIELD_DEFS,
    userFieldValues(place.fieldValues),
  );
  const photos = place.media.filter(
    (item) => mediaCategory(item.mediaType) !== "track",
  );

  async function copyPosition() {
    try {
      await navigator.clipboard.writeText(position);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
      toast.error(planCopy.placeCopyFailed);
    }
  }

  return (
    <div className={classes.root}>
      <Hero title={place.name} onBack={onBack} backLabel={planCopy.back} />
      <div className={classes.list}>
        <p className={classes.note}>
          {[
            type?.name ?? planCopy.placeTypeFallback,
            tripPlanAddedByLine(place.addedBy),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {place.altNames.length > 0 && (
          <p className={classes.note}>
            {copy.alsoKnownAs} {place.altNames.join(", ")}
          </p>
        )}
        {place.notes && <p className={classes.body}>{place.notes}</p>}
        {photos.length > 0 && <PlaceSlideshow media={photos} />}
        <SectionHeader title={copy.position} />
        <Row
          leading={<IconTile icon="place" hue="var(--color-accent)" />}
          title={position}
          subtitle={
            place.elevation != null
              ? formatElevationM(place.elevation)
              : undefined
          }
          trailing={
            <IconButton
              icon={copied ? "done" : "copy"}
              label={tripPlanCopyCoordinatesLabel(place.name)}
              onClick={() => void copyPosition()}
            />
          }
        />
        {attributes.length > 0 && (
          <dl className={classes.facts}>
            {attributes.map(([key, label, value, type]) => (
              <div key={key} className={classes.fact}>
                <dt>{label}</dt>
                <dd>{formatFieldValue(value, type)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
