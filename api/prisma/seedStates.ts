// The states the seed must hold: every one a screen has to render and a test
// has to be able to reach. A state is a name and a query that returns a row
// when the seeded database is in it. src/__tests__/seedStates.test.ts runs the
// queries and fails naming every state with no row, so deleting the row from
// seed.ts, or adding a state here the seed does not write, is red either way.
// seedStates.unit.test.ts holds the list itself.
//
// Where a vocabulary is declared in shared/ (a plan role, a file send status),
// each of its values is a state, built from that declaration: a new value
// fails until the seed holds a row of it. The ones with no declaration there
// are written out below.
import {
  CURRENT_CONSENT_VERSION,
  FILE_SEND_STATUSES,
  SYSTEM_PLACE_TYPE_IDS,
  TRIP_PLAN_FORM_VISIBILITIES,
  TRIP_PLAN_ITEM_KINDS,
  TRIP_PLAN_MEMBER_STATUSES,
  TRIP_PLAN_QUESTION_KINDS,
  TRIP_PLAN_ROLES,
} from "@logjam/shared";
import { SEED_EDGE_USERS } from "./seedIds";

export type SeedState = {
  name: string;
  /** Returns at least one row when the seeded database is in the state. */
  sql: string;
};

const state = (name: string, sql: string): SeedState => ({ name, sql });
/** `SELECT 1 FROM <from> WHERE <where>`. */
const some = (name: string, from: string, where: string) =>
  state(name, `SELECT 1 FROM ${from} WHERE ${where} LIMIT 1`);

const NSW =
  "latitude BETWEEN -37.6 AND -28.1 AND longitude BETWEEN 140.9 AND 153.7";
// A name as long as the API lets one be is 200; these are the ones a card
// cannot fit on a line.
const LONG = 150;

const owns = (userId: string) =>
  [
    ["places", "owner_id"],
    ["routes", "owner_id"],
    ["media", "owner_id"],
    ["trip_logs", "user_id"],
    ["topo_jobs", "user_id"],
    ["topo_export_jobs", "user_id"],
    ["topo_templates", "user_id"],
    ["file_sends", "sender_id"],
    ["file_send_recipients", "user_id"],
    ["friendships", "requester_id"],
    ["friendships", "addressee_id"],
    ["trip_plan_members", "user_id"],
    ["notifications", "user_id"],
    ["custom_field_defs", "owner_id"],
  ]
    .map(
      ([table, column]) =>
        `NOT EXISTS (SELECT 1 FROM ${table} WHERE ${column} = '${userId}')`,
    )
    .join(" AND ");

/** Written out: the schema comments name them, nothing in shared/ does. */
const TOPO_JOB_STATUSES = [
  "uploading",
  "processing",
  "complete",
  "failed",
  // "pending" is left out on purpose: it would put the seed's work in flight
  // at the site's 24-vCPU ceiling and refuse the suites their own launches.
] as const;
const TOPO_EXPORT_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
] as const;
const TOPO_EXPORT_FORMATS = ["geojson", "gpkg", "geotiff", "mbtiles"] as const;
const FRIENDSHIP_STATUSES = ["pending", "accepted"] as const;
const MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
] as const;

const PLAN_ITEM_TABLES: Record<(typeof TRIP_PLAN_ITEM_KINDS)[number], string> =
  {
    place: "places",
    route: "routes",
    media: "media",
  };

export const SEED_STATES: readonly SeedState[] = [
  // ── Accounts ──────────────────────────────────────────────────────────────
  some(
    "a user with nothing: no places, trips, files, jobs, plans, friends or inbox",
    "users",
    `id = '${SEED_EDGE_USERS.empty}' AND ${owns(SEED_EDGE_USERS.empty)}`,
  ),
  some(
    "a user who has not consented",
    "users",
    "consented_at IS NULL AND consent_version IS NULL",
  ),
  some(
    "a user who consented to an earlier text than the current one",
    "users",
    `consent_version IS NOT NULL AND consent_version <> '${CURRENT_CONSENT_VERSION}'`,
  ),
  some(
    "a user within 5% of their storage allowance, whose files add up to it",
    "users u",
    `storage_used_bytes >= 0.95 * storage_quota_bytes
     AND storage_used_bytes <= (SELECT COALESCE(SUM(file_size_bytes), 0) FROM media WHERE owner_id = u.id)`,
  ),
  some(
    "a user who has used this month's downloads",
    "users",
    "monthly_egress_used_bytes >= monthly_egress_quota_bytes",
  ),

  // ── Text that breaks a layout ─────────────────────────────────────────────
  some(
    "a place named as long as the rules allow",
    "places",
    `char_length(name) >= ${LONG}`,
  ),
  some(
    "a place with six or more other names",
    "places",
    `cardinality("altNames") >= 6`,
  ),
  some(
    "a place with notes far past a card",
    "places",
    "char_length(notes) >= 1500",
  ),
  some("a place named right to left", "places", "name ~ '[\\u0590-\\u08FF]'"),
  some(
    "a place named with combining marks",
    "places",
    "name ~ '[\\u0300-\\u036F]'",
  ),
  some(
    "a place named with an emoji and a joiner",
    "places",
    "name LIKE '%' || chr(8205) || '%'",
  ),
  some(
    "a place named with markup and quotes",
    "places",
    "name ~ '<b>' AND name LIKE '%\"%'",
  ),
  some("a place named with a run of spaces", "places", "name LIKE '%  %'"),
  some(
    "a trip named as long as the rules allow",
    "trip_logs",
    `char_length(display_name) >= ${LONG}`,
  ),
  some(
    "a trip named right to left",
    "trip_logs",
    "display_name ~ '[\\u0590-\\u08FF]'",
  ),
  some(
    "a route named as long as the rules allow",
    "routes",
    `char_length(name) >= ${LONG}`,
  ),
  some("a route named right to left", "routes", "name ~ '[\\u0590-\\u08FF]'"),

  // ── Places and trips ──────────────────────────────────────────────────────
  some("a place with a river gauge", "places", "gauge_id IS NOT NULL"),
  some(
    "a canyon with a height",
    "places",
    `elevation IS NOT NULL AND place_type_id = '${SYSTEM_PLACE_TYPE_IDS.canyon}'`,
  ),
  some("a place outside New South Wales", "places", `NOT (${NSW})`),
  some("a place beside the date line", "places", "abs(longitude) > 179"),
  some(
    "a place an import left, with its key and batch",
    "places",
    "import_key IS NOT NULL AND import_batch_id IS NOT NULL",
  ),
  some(
    "a trip on two or more places",
    "(SELECT trip_log_id FROM trip_log_places GROUP BY trip_log_id HAVING count(*) >= 2) t",
    "true",
  ),
  some(
    "a trip that is not canyoning",
    "trip_logs",
    "cardinality(types) > 0 AND NOT ('canyoning' = ANY(types))",
  ),
  some("a trip with no notes", "trip_logs", "notes IS NULL"),
  some(
    "a trip dated on another day in Sydney than in UTC",
    "trip_logs",
    "date::date <> (date AT TIME ZONE 'UTC' AT TIME ZONE 'Australia/Sydney')::date",
  ),

  // ── Files ─────────────────────────────────────────────────────────────────
  some("a file attached to a trip", "media", "linked_type = 'tripLog'"),
  some("a trip's copy of a recording", "media", "source_media_id IS NOT NULL"),
  some(
    "a recording with no colour",
    "media",
    "origin = 'track' AND color IS NULL",
  ),
  ...MEDIA_TYPES.map((type) =>
    some(`a file of type ${type}`, "media", `media_type = '${type}'`),
  ),

  // ── Work in flight and finished ───────────────────────────────────────────
  ...TOPO_JOB_STATUSES.map((status) =>
    some(`a LiDAR job that is ${status}`, "topo_jobs", `status = '${status}'`),
  ),
  some(
    "a LiDAR job part-way through its render",
    "topo_jobs",
    "status = 'processing' AND render_tiles_done > 0 AND render_tiles_total > render_tiles_done AND last_progress_at IS NOT NULL",
  ),
  some(
    "a finished LiDAR job that lists its layers and has no sharpen result",
    "topo_jobs",
    "status = 'complete' AND sharpen IS NULL AND jsonb_array_length(s3_output_keys) > 0",
  ),
  ...TOPO_EXPORT_STATUSES.map((status) =>
    some(
      `an export that is ${status}`,
      "topo_export_jobs",
      `status = '${status}'`,
    ),
  ),
  ...TOPO_EXPORT_FORMATS.map((format) =>
    some(`an export as ${format}`, "topo_export_jobs", `format = '${format}'`),
  ),
  some(
    "an export of an area, with a box and no job",
    "topo_export_jobs",
    "bbox IS NOT NULL AND cardinality(source_job_ids) = 0",
  ),
  some(
    "a failed export's notification",
    "notifications",
    "type = 'topo_export_complete' AND payload ->> 'status' = 'failed'",
  ),
  some(
    "a finished-job notification with no job name",
    "notifications",
    "type = 'topo_complete' AND NOT (payload ? 'jobName')",
  ),

  // ── Plans ─────────────────────────────────────────────────────────────────
  ...TRIP_PLAN_ROLES.map((role) =>
    some(
      `a plan member with the role ${role}`,
      "trip_plan_members",
      `role = '${role}'`,
    ),
  ),
  ...TRIP_PLAN_MEMBER_STATUSES.map((status) =>
    some(
      `a plan member with the status ${status}`,
      "trip_plan_members",
      `status = '${status}'`,
    ),
  ),
  ...TRIP_PLAN_FORM_VISIBILITIES.map((who) =>
    some(
      `a plan form read by ${who}`,
      "trip_plan_forms",
      `visible_to = '${who}'`,
    ),
  ),
  ...TRIP_PLAN_QUESTION_KINDS.map((kind) =>
    some(
      `a plan question of kind ${kind}`,
      "trip_plan_forms",
      `questions @> '[{"kind": "${kind}"}]'`,
    ),
  ),
  ...TRIP_PLAN_ITEM_KINDS.map((kind) =>
    some(`a plan ${kind}`, PLAN_ITEM_TABLES[kind], "plan_id IS NOT NULL"),
  ),
  some("a plan with no dates", "trip_plans", "start_date IS NULL"),
  some("a plan put away", "trip_plans", "archived_at IS NOT NULL"),
  some("a plan form with no preset", "trip_plan_forms", "preset IS NULL"),
  some(
    "a plan invite that has lapsed",
    "trip_plan_invites",
    "expires_at < now()",
  ),
  some(
    "a plan notification with no reason given",
    "notifications",
    "type = 'plan_access_ended' AND NOT (payload ? 'reason')",
  ),

  // ── Sends and friends ─────────────────────────────────────────────────────
  ...FILE_SEND_STATUSES.map((status) =>
    some(
      `a file send that is ${status}`,
      "file_send_recipients",
      `status = '${status}'`,
    ),
  ),
  some(
    "a file send to two people",
    "(SELECT file_send_id FROM file_send_recipients GROUP BY file_send_id HAVING count(*) >= 2) t",
    "true",
  ),
  ...FRIENDSHIP_STATUSES.map((status) =>
    some(
      `a friendship that is ${status}`,
      "friendships",
      `status = '${status}'`,
    ),
  ),
  some(
    "two friends who share nothing",
    "friendships f",
    `status = 'accepted'
     AND NOT EXISTS (SELECT 1 FROM place_shares s WHERE (s.shared_by_id, s.shared_with_id) IN ((f.requester_id, f.addressee_id), (f.addressee_id, f.requester_id)))
     AND NOT EXISTS (SELECT 1 FROM shares s WHERE (s.shared_by_id, s.shared_with_id) IN ((f.requester_id, f.addressee_id), (f.addressee_id, f.requester_id)))`,
  ),
];
