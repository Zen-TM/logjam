import { AppState } from "react-native";
import { gaugeIdsByFeed } from "@logjam/shared";

import { listMirrorPlaces } from "../sync/mirrorStore";
import { refreshGaugeHistories } from "./gaugeFeed";

/** Keeps the history of the gauges on saved places, so a trip read offline
 *  has its reading. Only at start and when the app returns to the front, and
 *  only for what is missing or a day old: no timer (ADR 0013). */
export function registerSavedGaugeHistoryRefresh(): () => void {
  const refresh = () =>
    listMirrorPlaces()
      .then((places) =>
        Promise.all(
          gaugeIdsByFeed(places).map(({ feed, gaugeIds }) =>
            refreshGaugeHistories(feed, gaugeIds),
          ),
        ),
      )
      .catch(() => {});
  void refresh();
  const app = AppState.addEventListener("change", (state) => {
    if (state === "active") void refresh();
  });
  return () => app.remove();
}
