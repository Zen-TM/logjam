// A place's details as a plan's forms ask them: other names, position,
// elevation, notes and the attributes of its system type. Shared by the edit
// form (which compares against the plan) and the new-place form.
import {
  customFieldDisplayLabel,
  ITEM_ATTR,
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
  TRIP_PLAN_PAGE,
  type ItemWords,
  type TripLogCustomFieldDef,
} from "@logjam/shared";
import { NumberField, SectionHeader, TextArea, TextField } from "../../ui";
import CustomFieldInput from "../dialogs/CustomFieldInput";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;
const LATITUDE = { min: LATITUDE_RANGE.min, max: LATITUDE_RANGE.max };
const LONGITUDE = { min: LONGITUDE_RANGE.min, max: LONGITUDE_RANGE.max };

export default function PlanPlaceFields({
  values,
  defs,
  asked,
  set,
  theirsHint = () => undefined,
}: {
  values: ItemWords;
  defs: TripLogCustomFieldDef[];
  /** A Save was tried: show what is wrong. */
  asked: boolean;
  set: (next: Record<string, string>) => void;
  /** The plan's words under a field someone else changed, if any. */
  theirsHint?: (field: string) => string | undefined;
}) {
  return (
    <>
      <TextField
        label={copy.itemAlsoKnownAs}
        value={values.altNames}
        onChange={(event) => set({ altNames: event.target.value })}
        hint={theirsHint("altNames") ?? copy.itemAlsoKnownAsHint}
      />
      <div className={classes.pair}>
        <NumberField
          label={copy.itemLatitude}
          required
          value={values.latitude}
          onChange={(latitude) => set({ latitude })}
          coordinate={{ axis: "latitude", onPair: set }}
          constraints={LATITUDE}
          showError={asked}
          hint={theirsHint("latitude")}
        />
        <NumberField
          label={copy.itemLongitude}
          required
          value={values.longitude}
          onChange={(longitude) => set({ longitude })}
          coordinate={{ axis: "longitude", onPair: set }}
          constraints={LONGITUDE}
          showError={asked}
          hint={theirsHint("longitude")}
        />
      </div>
      <NumberField
        label={copy.itemElevation}
        value={values.elevation}
        onChange={(elevation) => set({ elevation })}
        constraints={{}}
        showError={asked}
        hint={theirsHint("elevation")}
      />
      <TextArea
        label={copy.itemNotes}
        value={values.notes}
        onChange={(event) => set({ notes: event.target.value })}
        hint={theirsHint("notes")}
      />
      {defs.length > 0 && (
        <section className={classes.form}>
          <SectionHeader title={copy.itemAttributes} />
          {defs.map((def) => (
            <div key={def.key}>
              <CustomFieldInput
                def={def}
                value={values[ITEM_ATTR + def.key]}
                onChange={(value) => set({ [ITEM_ATTR + def.key]: value })}
                showError={asked}
              />
              {theirsHint(ITEM_ATTR + def.key) && (
                <p className={classes.note}>
                  {customFieldDisplayLabel(def)}:{" "}
                  {theirsHint(ITEM_ATTR + def.key)}
                </p>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
