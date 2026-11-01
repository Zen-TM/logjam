import type { Router } from "express";
import { PLACE_SEARCH_API_PATH } from "@logjam/shared";
import usersRouter from "./users";
import placesRouter from "./places";
import placeTypesRouter from "./placeTypes";
import tripLogsRouter from "./tripLogs";
import tripLogsGlobalRouter from "./tripLogsGlobal";
import tripLogsBulkRouter from "./tripLogsBulk";
import placesBulkRouter from "./placesBulk";
import foreignFieldsRouter from "./foreignFields";
import sharingRouter from "./sharing";
import sharesRouter from "./shares";
import bulkShareRouter from "./bulkShare";
import fileSendsRouter from "./fileSends";
import friendsRouter from "./friends";
import friendInvitesRouter from "./friendInvites";
import plansRouter from "./plans";
import planItemsRouter from "./planItems";
import planSectionsRouter from "./planSections";
import planFormsRouter from "./planForms";
import planMembersRouter from "./planMembers";
import planInvitesRouter, { planInviteLinksRouter } from "./planInvites";
import notificationsRouter from "./notifications";
import ropewikiRouter from "./ropewiki";
import topoJobsRouter from "./topoJobs";
import mediaRouter from "./media";
import topoExportsRouter from "./topoExports";
import computeEstimateRouter from "./computeEstimate";
import vectorStyleRouter from "./vectorStyle";
import customFieldsRouter from "./customFields";
import importsRouter from "./imports";
import metaRouter from "./meta";
import devicesRouter from "./devices";
import routesRouter from "./routes";
import elevationRouter from "./elevation";
import placeSearchRouter from "./placeSearch";
import syncRouter from "./sync";

// Every router and the path it is mounted on, in mount order (an earlier mount
// wins a path both match). index.ts mounts them; queryPlans.test.ts mounts the
// same list and checks every GET in it is guarded or left out for a reason.
export const ROUTER_MOUNTS: [string, Router][] = [
  ["/meta", metaRouter],
  ["/users", usersRouter],
  ["/place-types", placeTypesRouter],
  [PLACE_SEARCH_API_PATH, placeSearchRouter],
  ["/places", placesRouter],
  ["/places/:placeId/trips", tripLogsRouter],
  ["/trips/bulk", tripLogsBulkRouter],
  ["/places/bulk", placesBulkRouter],
  ["/imports", importsRouter],
  ["/trips", tripLogsGlobalRouter],
  ["/places", sharingRouter],
  // Mounted on /places too: the actions are per PLACE, and keeping them under
  // the place's own path is what makes "owner only, 404 otherwise" the same
  // answer the rest of that path gives.
  ["/places", foreignFieldsRouter],
  ["/shares", sharesRouter],
  // Its own path, NOT /shares/bulk: it also ends a bulk action made entirely of
  // file copies, which grant no Share row at all, and mounting it under the
  // direct-share router would say otherwise.
  ["/bulk-share", bulkShareRouter],
  ["/file-sends", fileSendsRouter],
  // Before /friends: its DELETE /:id would otherwise take DELETE /friends/invites.
  ["/friends/invites", friendInvitesRouter],
  ["/plans/:planId/sections", planSectionsRouter],
  ["/plans/:planId/forms", planFormsRouter],
  ["/plans/:planId/invites", planInviteLinksRouter],
  ["/plans/:planId/items", planItemsRouter],
  ["/plans/:planId", planMembersRouter],
  ["/plan-invites", planInvitesRouter],
  ["/plans", plansRouter],
  ["/friends", friendsRouter],
  ["/notifications", notificationsRouter],
  ["/devices", devicesRouter],
  ["/ropewiki", ropewikiRouter],
  ["/topo-jobs", topoJobsRouter],
  ["/media", mediaRouter],
  ["/topo-exports", topoExportsRouter],
  ["/compute-estimate", computeEstimateRouter],
  ["/vector-style", vectorStyleRouter],
  ["/custom-fields", customFieldsRouter],
  ["/routes", routesRouter],
  ["/elevation", elevationRouter],
  ["/sync", syncRouter],
];
