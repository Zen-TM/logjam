import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  TextField,
  Typography,
  Box,
  CircularProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  FormControlLabel,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  matchCanyon,
  haversineMeters,
  DEFAULT_CANYON_MERGE_POLICY,
  type MatchCandidate,
  type CanyonMergePolicy,
  type MergeableField,
  type TripLogCustomFieldDef,
  type TripLogCustomFieldType,
} from "@logjam/shared";
import {
  CUSTOM_FIELD_TYPES,
  makeCustomFieldKey,
  coerceFieldValue,
} from "@logjam/shared";
import type { TCanyon, TUser, BulkCanyonInput } from "../../canyonUtils";
import {
  apiFetch,
  bulkCanyonImport,
  bulkCreateTripLogs,
  undoImport,
  updateUserPreferences,
} from "../../canyonUtils";
import { parseCsv } from "../../csvImport/parseCsv";
import { detectFileKind, type FileKind } from "../../csvImport/detectFileKind";
import {
  detectCanyonColumns,
  ROLE_LABELS,
  ALL_ASSIGNABLE_ROLES,
  type CanyonFieldRole,
} from "../../csvImport/canyonColumns";
import { detectColumns, type ColumnRole } from "../../csvImport/detectColumns";
import {
  detectDateFormat,
  toIsoDate,
  DATE_FORMAT_LABELS,
  type DateFormat,
} from "../../csvImport/detectDateFormat";
import { parseByRole } from "../../csvImport/canyonValueParsers";
import {
  fieldSx,
  selectSx,
  menuPaperProps,
  SectionLabel,
} from "../../csvImport/dialogStyles";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import MatchReview, {
  type ReviewItem,
  type ReviewDecision,
} from "./MatchReview";
import ImportResultSummary, {
  type HeadlineCount,
  type DetailSection,
} from "./ImportResultSummary";
import classes from "./UnifiedImportDialog.module.css";

// ── Types ────────────────────────────────────────────────────────────────────

type Step = "map" | "review" | "confirm";

// A parsed-and-classified dropped file. `kind` may be overridden by the user.
type LoadedFile = {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  kind: FileKind;
};

// Per-canyon-row prepared input, plus the raw file name string used as the
// match key and stable provenance.
type PreparedCanyonRow = {
  rowIndex: number;
  sourceName: string;
  input: BulkCanyonInput;
};

// Per-trip-row prepared content. `sourceCanyonName` is the raw file string.
// `type` is free text (trimmed, empty → null) — no enum validation.
type PreparedTripRow = {
  rowIndex: number;
  sourceCanyonName: string;
  date: string;
  notes: string | null;
  type: string | null;
  customFields: Record<string, unknown>;
};

// A unique unmatched/ambiguous canyon name surfaced for review, plus the inline
// create-canyon coords the user fills in when they pick "Create".
type CreateForm = { name: string; latitude: string; longitude: string };

// What the user decided for each surfaced trip-canyon name. Mirrors ReviewItem
// decision kinds; `create` additionally requires a filled CreateForm.
type ReviewState = {
  // keyed by lowercased source canyon name
  decisions: Record<string, ReviewDecision>;
  createForms: Record<string, CreateForm>;
  options: Record<string, MatchCandidate[]>; // ranked candidates for the name
  // distance (m) from the incoming row to each option, aligned with options[key].
  // null when the import carries no coords (trip logs) or the candidate is unscored.
  distances: Record<string, (number | null)[]>;
  bestGuessId: Record<string, string | null>;
  // Original-cased source name (first occurrence) for each lowercased key, shown
  // in the review UI instead of the lowercased match key.
  displayName: Record<string, string>;
  // Auto-resolved canyon merges (confidence "auto") that are never surfaced for
  // review but still need to map a source name → an existing canyon id.
  autoMergeId: Record<string, string>;
};

type ImportOutcome =
  | { kind: "canyon"; batchId: string; created: number; merged: number; skipped: number; errors: string[] }
  | { kind: "triplog"; batchId: string; imported: number; updated: number; createdCanyons: number; noCanyon: number; linked: number; discarded: number; errors: string[] };

// ── Helpers ──────────────────────────────────────────────────────────────────

function genBatchId(): string {
  return crypto.randomUUID();
}

function toMatchCandidate(c: TCanyon): MatchCandidate {
  return {
    id: c.id,
    name: c.name,
    altNames: c.altNames,
    latitude: c.latitude,
    longitude: c.longitude,
  };
}

// Build a BulkCanyonInput from a mapped canyon row. Mirrors the field mapping in
// the (now removed) CanyonCsvImportDialog, but without the per-cell mismatch UI:
// values that don't parse are dropped (left null) — the importer is additive and
// merge fills nulls, so a bad cell never blocks the row.
function buildCanyonInput(
  row: Record<string, string>,
  assignments: Record<string, CanyonFieldRole>,
): BulkCanyonInput {
  const input: BulkCanyonInput = { name: "", latitude: NaN, longitude: NaN };
  const attrs: Record<string, unknown> = {};

  for (const [header, role] of Object.entries(assignments)) {
    if (role === "discard") continue;
    const raw = row[header] ?? "";
    const parsed = parseByRole(raw, role);
    const value: unknown = parsed.ok ? parsed.value : null;

    switch (role) {
      case "name":
        input.name = String(value ?? raw ?? "").trim();
        break;
      case "latitude": {
        const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
        if (!isNaN(n)) input.latitude = n;
        break;
      }
      case "longitude": {
        const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
        if (!isNaN(n)) input.longitude = n;
        break;
      }
      case "altNames":
        input.altNames = Array.isArray(value) ? (value as string[]) : [];
        break;
      case "notes":
        input.notes = value != null && value !== "" ? String(value) : null;
        break;
      case "numAbseils":
        input.numAbseils = value != null && !isNaN(Number(value)) ? Math.round(Number(value)) : null;
        break;
      case "longestAbseil":
        input.longestAbseil = value != null && !isNaN(Number(value)) ? Number(value) : null;
        break;
      case "hours":
        input.hours = value != null && !isNaN(Number(value)) ? Number(value) : null;
        break;
      case "vGrade":
        input.vGrade = value != null && !isNaN(Number(value)) ? Math.round(Number(value)) : null;
        break;
      case "aGrade":
        input.aGrade = value != null && !isNaN(Number(value)) ? Math.round(Number(value)) : null;
        break;
      case "commitment":
        input.commitment = value != null && !isNaN(Number(value)) ? Math.round(Number(value)) : null;
        break;
      case "quality":
        input.quality = value != null && !isNaN(Number(value)) ? Number(value) : null;
        break;
      case "sources":
        attrs["sources"] = Array.isArray(value) ? value : [];
        break;
      default:
        // attr:* / new-attr — store as a custom attribute keyed by the header.
        if (typeof role === "string" && role.startsWith("attr:")) {
          attrs[role.slice(5)] = value ?? null;
        }
        break;
    }
  }

  if (Object.keys(attrs).length > 0) input.attributes = attrs;
  return input;
}

const MERGEABLE_FIELD_LABELS: Record<MergeableField, string> = {
  vGrade: "V grade",
  aGrade: "A grade",
  commitment: "Commitment",
  quality: "Quality",
  numAbseils: "Pitches",
  longestAbseil: "Longest pitch",
  hours: "Hours",
  notes: "Notes",
};

// ── Component ────────────────────────────────────────────────────────────────

function UnifiedImportDialog({
  open,
  onClose,
  onBack,
  canyons,
  customFieldDefs,
  onCustomFieldDefsChange,
  currentUser,
  onRefetchCanyons,
  onRefetchTripLogs,
  onRefetchAnalytics,
  onPickCoords,
}: {
  open: boolean;
  onClose: () => void;
  // When set (the dialog was opened from the onboarding wizard), the map-step
  // Back button and the title-bar close return to the welcome hub instead of
  // dropping the user into an empty app.
  onBack?: () => void;
  canyons: TCanyon[];
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
  currentUser: TUser | null;
  onRefetchCanyons: () => void;
  onRefetchTripLogs: () => void;
  onRefetchAnalytics: () => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
}) {
  const isMobile = useIsMobile();

  const [step, setStep] = useState<Step>("map");
  const [importing, setImporting] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 (map) state
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [canyonFile, setCanyonFile] = useState<LoadedFile | null>(null);
  const [tripFile, setTripFile] = useState<LoadedFile | null>(null);
  const [canyonAssignments, setCanyonAssignments] = useState<Record<string, CanyonFieldRole>>({});
  const [tripAssignments, setTripAssignments] = useState<Record<string, ColumnRole>>({});
  const [tripNewCfForms, setTripNewCfForms] = useState<Record<string, { label: string; type: TripLogCustomFieldType }>>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>("DD/MM/YYYY");

  // Step 2 (review) state — only one kind of file is active per import run.
  const [activeKind, setActiveKind] = useState<"canyon" | "triplog" | null>(null);
  const [preparedCanyonRows, setPreparedCanyonRows] = useState<PreparedCanyonRow[]>([]);
  const [preparedTripRows, setPreparedTripRows] = useState<PreparedTripRow[]>([]);
  const [reviewState, setReviewState] = useState<ReviewState>({
    decisions: {},
    createForms: {},
    options: {},
    distances: {},
    bestGuessId: {},
    displayName: {},
    autoMergeId: {},
  });

  // Step 3 (confirm) state
  const [mergePolicy, setMergePolicy] = useState<CanyonMergePolicy>(DEFAULT_CANYON_MERGE_POLICY);

  // Map-pick bookkeeping: which surfaced trip name is awaiting a picked coord.
  const pickingRef = useRef(false);
  const pickingForRef = useRef<string | null>(null);
  // Scrollable DialogContent + saved scroll position, so picking coords (which
  // hides the dialog) doesn't reset the review scroll on reopen.
  const contentRef = useRef<HTMLDivElement>(null);
  const pickScrollRef = useRef(0);
  // One batch id per import session, shared across the canyon + logbook stages so
  // a single Undo reverts both. Lazily created, cleared on reset.
  const batchIdRef = useRef<string | null>(null);
  function sessionBatchId(): string {
    if (!batchIdRef.current) batchIdRef.current = genBatchId();
    return batchIdRef.current;
  }

  // Reset everything whenever the dialog (re)opens — unless we are returning
  // from a map-pick (the dialog is hidden during picking, then reopens).
  useEffect(() => {
    if (!open) return;
    if (pickingRef.current) {
      pickingRef.current = false;
      // Restore the review scroll position lost when the dialog closed to pick.
      requestAnimationFrame(() => {
        if (contentRef.current) contentRef.current.scrollTop = pickScrollRef.current;
      });
      return;
    }
    batchIdRef.current = null;
    setStep("map");
    setImporting(false);
    setOutcome(null);
    setUndoing(false);
    setError(null);
    setCanyonFile(null);
    setTripFile(null);
    setCanyonAssignments({});
    setTripAssignments({});
    setTripNewCfForms({});
    setDateFormat("DD/MM/YYYY");
    setActiveKind(null);
    setPreparedCanyonRows([]);
    setPreparedTripRows([]);
    setReviewState({ decisions: {}, createForms: {}, options: {}, distances: {}, bestGuessId: {}, displayName: {}, autoMergeId: {} });
    setMergePolicy(
      currentUser?.uiPreferences?.importMergePolicy ?? DEFAULT_CANYON_MERGE_POLICY,
    );
  }, [open, currentUser]);

  const noCanyonsYet = canyons.length === 0;

  // ── File loading ────────────────────────────────────────────────────────────

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }
  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
  }
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    for (const file of Array.from(e.dataTransfer.files)) {
      void loadFile(file);
    }
  }
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    for (const file of files) {
      await loadFile(file);
    }
    e.target.value = "";
  }

  async function loadFile(file: File) {
    setError(null);
    let parsed;
    try {
      parsed = await parseCsv(file);
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(
          err,
          "We couldn't read that file. Make sure it's a valid CSV and try again.",
        ),
      );
      return;
    }

    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError(
        "That file has no data rows we could read. Make sure the first row is a header and there's at least one row of data.",
      );
      return;
    }

    const kind = detectFileKind(parsed.headers);
    if (kind === "unknown") {
      setError(
        "This file doesn't look like a canyon list or a logbook. We couldn't find a coordinates column (for canyons) or a date column (for trips). Canyons need name, latitude, longitude; logbooks need a canyon name and date.",
      );
      return;
    }

    // Only one file of each kind at a time. A second canyon list / logbook would
    // silently overwrite the first, so reject it instead.
    if (kind === "canyon" && canyonFile) {
      setError("You can import one canyon list at a time. Remove the current one first.");
      return;
    }
    if (kind === "triplog" && tripFile) {
      setError("You can import one logbook at a time. Remove the current one first.");
      return;
    }

    const loaded: LoadedFile = {
      fileName: file.name,
      headers: parsed.headers,
      rows: parsed.rows,
      kind,
    };

    if (kind === "canyon") {
      setCanyonFile(loaded);
      setCanyonAssignments(detectCanyonColumns(parsed.headers));
    } else {
      setTripFile(loaded);
      const detected = detectColumns(parsed.headers, customFieldDefs);
      setTripAssignments(detected);
      const forms: Record<string, { label: string; type: TripLogCustomFieldType }> = {};
      for (const h of parsed.headers) forms[h] = { label: h, type: "string" };
      setTripNewCfForms(forms);
      const dateCol = parsed.headers.find((h) => detected[h] === "date");
      const samples = dateCol
        ? parsed.rows.map((r) => r[dateCol] ?? "").filter(Boolean).slice(0, 10)
        : [];
      setDateFormat(detectDateFormat(samples).format);
    }
  }

  function overrideKind(loaded: LoadedFile, which: "canyon" | "triplog", newKind: FileKind) {
    if (newKind === loaded.kind) return;
    // Reclassify: move the file to the other bucket and re-detect columns.
    if (which === "canyon") setCanyonFile(null);
    else setTripFile(null);
    const moved: LoadedFile = { ...loaded, kind: newKind };
    if (newKind === "canyon") {
      setCanyonFile(moved);
      setCanyonAssignments(detectCanyonColumns(moved.headers));
    } else if (newKind === "triplog") {
      setTripFile(moved);
      const detected = detectColumns(moved.headers, customFieldDefs);
      setTripAssignments(detected);
      const forms: Record<string, { label: string; type: TripLogCustomFieldType }> = {};
      for (const h of moved.headers) forms[h] = { label: h, type: "string" };
      setTripNewCfForms(forms);
      const dateCol = moved.headers.find((h) => detected[h] === "date");
      const samples = dateCol
        ? moved.rows.map((r) => r[dateCol] ?? "").filter(Boolean).slice(0, 10)
        : [];
      setDateFormat(detectDateFormat(samples).format);
    }
  }

  // ── Map → Review ─────────────────────────────────────────────────────────────

  // Which mapped fields are present, for live feedback + validation.
  const canyonMapValid = useMemo(() => {
    if (!canyonFile) return false;
    const roles = new Set(Object.values(canyonAssignments));
    return roles.has("name") && roles.has("latitude") && roles.has("longitude");
  }, [canyonFile, canyonAssignments]);

  const tripMapValid = useMemo(() => {
    if (!tripFile) return false;
    const roles = new Set(Object.values(tripAssignments));
    if (!roles.has("name") || !roles.has("date")) return false;
    // Every "new custom field" column needs a non-empty label.
    return tripFile.headers.every(
      (h) => tripAssignments[h] !== "new-cf" || !!tripNewCfForms[h]?.label.trim(),
    );
  }, [tripFile, tripAssignments, tripNewCfForms]);

  const canProceedFromMap =
    (canyonFile ? canyonMapValid : false) || (tripFile ? tripMapValid : false);

  // Columns the importer will ignore (mapped to discard).
  const ignoredCanyonCols = useMemo(
    () =>
      canyonFile
        ? canyonFile.headers.filter((h) => canyonAssignments[h] === "discard")
        : [],
    [canyonFile, canyonAssignments],
  );
  const ignoredTripCols = useMemo(
    () =>
      tripFile ? tripFile.headers.filter((h) => tripAssignments[h] === "discard") : [],
    [tripFile, tripAssignments],
  );

  function buildCanyonRows(): PreparedCanyonRow[] {
    if (!canyonFile) return [];
    const out: PreparedCanyonRow[] = [];
    canyonFile.rows.forEach((row, rowIndex) => {
      const input = buildCanyonInput(row, canyonAssignments);
      if (!input.name || isNaN(input.latitude) || isNaN(input.longitude)) return;
      out.push({ rowIndex, sourceName: input.name, input });
    });
    return out;
  }

  function buildTripRows(): PreparedTripRow[] {
    if (!tripFile) return [];
    const { headers, rows } = tripFile;
    const nameCol = headers.find((h) => tripAssignments[h] === "name");
    const dateCol = headers.find((h) => tripAssignments[h] === "date");
    const notesCol = headers.find((h) => tripAssignments[h] === "notes");
    const typeCol = headers.find((h) => tripAssignments[h] === "type");
    if (!nameCol || !dateCol) return [];

    // Custom-field columns: existing cf:<key> plus any new fields the user named.
    const cfCols: { header: string; key: string; type: TripLogCustomFieldType }[] = [];
    for (const h of headers) {
      const role = tripAssignments[h];
      if (typeof role === "string" && role.startsWith("cf:")) {
        const def = customFieldDefs.find((d) => d.key === role.slice(3));
        if (def) cfCols.push({ header: h, key: def.key, type: def.type });
      } else if (role === "new-cf") {
        const form = tripNewCfForms[h];
        if (form?.label.trim()) {
          cfCols.push({ header: h, key: makeCustomFieldKey(form.label), type: form.type });
        }
      }
    }

    const out: PreparedTripRow[] = [];
    rows.forEach((row, rowIndex) => {
      const sourceCanyonName = (row[nameCol] ?? "").trim();
      const isoDate = toIsoDate(row[dateCol] ?? "", dateFormat);
      if (!isoDate) return;
      const customFields: Record<string, unknown> = {};
      for (const cf of cfCols) {
        customFields[cf.key] = coerceFieldValue(row[cf.header] ?? "", cf.type);
      }
      out.push({
        rowIndex,
        sourceCanyonName,
        date: isoDate,
        notes: notesCol ? row[notesCol] || null : null,
        type: typeCol ? (row[typeCol] ?? "").trim() || null : null,
        customFields,
      });
    });
    return out;
  }

  // Build the trip-stage review state and advance the dialog. Runs both from the
  // initial map step (logbook-only or logbook-first) and after the canyon stage
  // of a combined import, where `candidates` are the freshly imported canyons.
  function startTripStage(candidates: MatchCandidate[]): boolean {
    const rows = buildTripRows();
    if (rows.length === 0) {
      setError("No valid trip rows found (each needs a canyon name and a parseable date).");
      return false;
    }
    const decisions: Record<string, ReviewDecision> = {};
    const options: Record<string, MatchCandidate[]> = {};
    const distances: Record<string, (number | null)[]> = {};
    const bestGuessId: Record<string, string | null> = {};
    const displayName: Record<string, string> = {};
    const createForms: Record<string, CreateForm> = {};
    const surfaced = new Set<string>();
    for (const row of rows) {
      const key = row.sourceCanyonName.toLowerCase();
      if (key in decisions) continue;
      if (!row.sourceCanyonName) {
        // No name on the row → always canyon-less, never surfaced.
        decisions[key] = { kind: "noCanyon" };
        continue;
      }
      displayName[key] = row.sourceCanyonName;
      const result = matchCanyon({ name: row.sourceCanyonName }, candidates);
      if (result.confidence === "auto" && result.best) {
        decisions[key] = { kind: "link", id: result.best.candidate.id };
      } else {
        // review OR none → surfaced; none defaults to No canyon.
        surfaced.add(key);
        options[key] = result.candidates.map((c) => c.candidate);
        distances[key] = result.candidates.map((c) => c.distanceMeters);
        bestGuessId[key] = result.best?.candidate.id ?? null;
        decisions[key] = result.best
          ? { kind: "link", id: result.best.candidate.id }
          : { kind: "noCanyon" };
        createForms[key] = { name: row.sourceCanyonName, latitude: "", longitude: "" };
      }
    }
    setActiveKind("triplog");
    setPreparedTripRows(rows);
    setReviewState({ decisions, createForms, options, distances, bestGuessId, displayName, autoMergeId: {} });
    setStep(surfaced.size > 0 ? "review" : "confirm");
    return true;
  }

  function handleMapNext() {
    setError(null);
    const candidates = canyons.map(toMatchCandidate);

    // Process the canyon file first so trips can match the just-imported canyons.
    if (canyonFile && canyonMapValid) {
      const rows = buildCanyonRows();
      if (rows.length === 0) {
        setError("No valid canyon rows found (each needs a name, latitude and longitude).");
        return;
      }
      // Canyon files: auto-create on `none`; surface only the ambiguous middle.
      const decisions: Record<string, ReviewDecision> = {};
      const options: Record<string, MatchCandidate[]> = {};
      const distances: Record<string, (number | null)[]> = {};
      const bestGuessId: Record<string, string | null> = {};
      const displayName: Record<string, string> = {};
      const autoMergeId: Record<string, string> = {};
      const surfaced = new Set<string>();
      for (const row of rows) {
        const key = row.sourceName.toLowerCase();
        if (key in decisions || key in autoMergeId) continue;
        displayName[key] = row.sourceName;
        const result = matchCanyon(
          {
            name: row.sourceName,
            altNames: row.input.altNames,
            latitude: row.input.latitude,
            longitude: row.input.longitude,
          },
          candidates,
        );
        if (result.confidence === "auto" && result.best) {
          autoMergeId[key] = result.best.candidate.id;
        } else if (result.confidence === "none") {
          decisions[key] = { kind: "create" };
        } else {
          surfaced.add(key);
          options[key] = result.candidates.map((c) => c.candidate);
          // matchCanyon reports Infinity for candidates beyond its coarse bbox
          // (a matching-logic guard, not a real distance). For display, compute
          // the true great-circle distance from the row's coords so every
          // suggestion shows how far away it is.
          distances[key] = result.candidates.map((c) =>
            haversineMeters(
              row.input.latitude,
              row.input.longitude,
              c.candidate.latitude,
              c.candidate.longitude,
            ),
          );
          bestGuessId[key] = result.best?.candidate.id ?? null;
          decisions[key] = result.best
            ? { kind: "link", id: result.best.candidate.id }
            : { kind: "create" };
        }
      }
      setActiveKind("canyon");
      setPreparedCanyonRows(rows);
      setReviewState({ decisions, createForms: {}, options, distances, bestGuessId, displayName, autoMergeId });
      setStep(surfaced.size > 0 ? "review" : "confirm");
      return;
    }

    if (tripFile && tripMapValid) {
      startTripStage(candidates);
      return;
    }
  }

  // ── Review interactions ──────────────────────────────────────────────────────

  // The list of surfaced names (keys) for the active kind, in stable order.
  const surfacedKeys = useMemo(() => {
    return Object.keys(reviewState.options);
  }, [reviewState.options]);

  const reviewItems = useMemo<ReviewItem[]>(() => {
    return surfacedKeys.map((key) => {
      const opts = reviewState.options[key] ?? [];
      const dists = reviewState.distances[key] ?? [];
      const bestId = reviewState.bestGuessId[key];
      const decision = reviewState.decisions[key] ?? { kind: "create" as const };
      return {
        incomingLabel: reviewState.displayName[key] ?? key,
        options: opts.map((c, i) => ({
          id: c.id,
          label: c.name,
          distanceMeters: Number.isFinite(dists[i]) ? (dists[i] as number) : undefined,
          isGuess: c.id === bestId,
        })),
        allowCreate: true,
        allowSkip: activeKind === "triplog",
        allowNoCanyon: activeKind === "triplog",
        decision,
      };
    });
  }, [surfacedKeys, reviewState, activeKind]);

  const handleReviewChange = useCallback(
    (index: number, decision: ReviewDecision) => {
      const key = surfacedKeys[index];
      if (!key) return;
      setReviewState((prev) => ({
        ...prev,
        decisions: { ...prev.decisions, [key]: decision },
      }));
    },
    [surfacedKeys],
  );

  // Trip "Create canyon" needs an inline coord-required form before the row is
  // resolved. Surface the create form for any surfaced trip name whose decision
  // is "create".
  const tripCreateKeys = useMemo(() => {
    if (activeKind !== "triplog") return [];
    return surfacedKeys.filter((key) => reviewState.decisions[key]?.kind === "create");
  }, [activeKind, surfacedKeys, reviewState.decisions]);

  function updateCreateForm(key: string, patch: Partial<CreateForm>) {
    setReviewState((prev) => ({
      ...prev,
      createForms: {
        ...prev.createForms,
        [key]: { ...(prev.createForms[key] ?? { name: key, latitude: "", longitude: "" }), ...patch },
      },
    }));
  }

  function handlePickCoordsFor(key: string) {
    pickingRef.current = true;
    pickingForRef.current = key;
    pickScrollRef.current = contentRef.current?.scrollTop ?? 0;
    onPickCoords((lat, lng) => {
      updateCreateForm(key, { latitude: lat.toFixed(6), longitude: lng.toFixed(6) });
      pickingForRef.current = null;
    });
  }

  // All surfaced trip "create" decisions must have valid coords before confirm.
  const reviewValid = useMemo(() => {
    if (activeKind !== "triplog") return true;
    return tripCreateKeys.every((key) => {
      const f = reviewState.createForms[key];
      return (
        f &&
        f.name.trim() &&
        !isNaN(parseFloat(f.latitude)) &&
        !isNaN(parseFloat(f.longitude))
      );
    });
  }, [activeKind, tripCreateKeys, reviewState.createForms]);

  // ── Confirm → Import ─────────────────────────────────────────────────────────

  // Resolved canyon rows for the POST. Each row's resolution is merge (when its
  // name resolves to an existing canyon) or create.
  function resolvedCanyonBody(batchId: string) {
    const rows = preparedCanyonRows.map((row) => {
      const key = row.sourceName.toLowerCase();
      const autoId = reviewState.autoMergeId[key];
      const decision = reviewState.decisions[key];
      let resolution: { kind: "create" } | { kind: "merge"; canyonId: string };
      if (autoId) {
        resolution = { kind: "merge", canyonId: autoId };
      } else if (decision?.kind === "link") {
        resolution = { kind: "merge", canyonId: decision.id };
      } else {
        resolution = { kind: "create" };
      }
      return { data: row.input, resolution };
    });
    return { importBatchId: batchId, rows, mergePolicy };
  }

  async function handleImportCanyons() {
    const batchId = sessionBatchId();
    setImporting(true);
    setError(null);
    try {
      const result = await bulkCanyonImport(resolvedCanyonBody(batchId));

      // Staged combined import: if a logbook was also dropped, don't finish here.
      // Refetch the canyon list (now including the just-imported canyons) and move
      // into the logbook stage, matching trips against the fresh canyons.
      if (tripFile && tripMapValid) {
        const all = await apiFetch<TCanyon[]>("/canyons");
        onRefetchCanyons();
        setImporting(false);
        const started = startTripStage(all.map(toMatchCandidate));
        if (!started) {
          // No usable trip rows — fall back to reporting the canyon result.
          setOutcome({
            kind: "canyon",
            batchId,
            created: result.created,
            merged: result.merged,
            skipped: result.skipped,
            errors: result.errors.map((e) => `Row ${e.rowIndex + 1}: ${e.message}`),
          });
        }
        return;
      }

      onRefetchCanyons();
      setOutcome({
        kind: "canyon",
        batchId,
        created: result.created,
        merged: result.merged,
        skipped: result.skipped,
        errors: result.errors.map((e) => `Row ${e.rowIndex + 1}: ${e.message}`),
      });
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't import canyons. Please try again."));
    } finally {
      setImporting(false);
    }
  }

  async function handleImportTrips() {
    const batchId = sessionBatchId();
    setImporting(true);
    setError(null);
    try {
      const errors: string[] = [];

      // Persist any new custom-field definitions named during mapping.
      const newFieldDefs: TripLogCustomFieldDef[] = [];
      if (tripFile) {
        for (const [header, form] of Object.entries(tripNewCfForms)) {
          if (tripAssignments[header] !== "new-cf") continue;
          if (!form.label.trim()) continue;
          const key = makeCustomFieldKey(form.label);
          if (!customFieldDefs.some((d) => d.key === key) && !newFieldDefs.some((d) => d.key === key)) {
            newFieldDefs.push({ key, label: form.label.trim(), type: form.type });
          }
        }
      }
      if (newFieldDefs.length > 0) {
        const merged = [...customFieldDefs, ...newFieldDefs];
        await updateUserPreferences({ tripLogCustomFields: merged });
        onCustomFieldDefsChange(merged);
      }

      // Create the canyons the user resolved via "Create canyon" inline. The
      // bulk endpoint stamps them with importBatchId (so undo removes them) but
      // doesn't return ids — so after creating, refetch the canyon list and
      // resolve each created canyon's id by exact name+coords match.
      const createdCanyonIdByKey: Record<string, string> = {};
      let createdCanyons = 0;
      if (tripCreateKeys.length > 0) {
        const createRows = tripCreateKeys
          .map((key) => ({ key, form: reviewState.createForms[key] }))
          .filter((e): e is { key: string; form: CreateForm } => !!e.form);
        try {
          const result = await bulkCanyonImport({
            importBatchId: batchId,
            rows: createRows.map((e) => ({
              data: {
                name: e.form.name.trim(),
                latitude: parseFloat(e.form.latitude),
                longitude: parseFloat(e.form.longitude),
              },
              resolution: { kind: "create" as const },
            })),
            mergePolicy,
          });
          createdCanyons = result.created;
          // Resolve ids from the freshly-fetched canyon list.
          const all = await apiFetch<TCanyon[]>("/canyons");
          const candidates = all.map(toMatchCandidate);
          for (const e of createRows) {
            const m = matchCanyon(
              {
                name: e.form.name.trim(),
                latitude: parseFloat(e.form.latitude),
                longitude: parseFloat(e.form.longitude),
              },
              candidates,
            );
            if (m.best) createdCanyonIdByKey[e.key] = m.best.candidate.id;
            else errors.push(`Couldn't link the created canyon for "${e.key}".`);
          }
        } catch (err) {
          console.error(err);
          errors.push("Couldn't create one or more new canyons.");
        }
      }

      // Rows the user chose to discard are dropped entirely (not imported).
      let discarded = 0;
      const trips = preparedTripRows.flatMap((row) => {
        const key = row.sourceCanyonName.toLowerCase();
        const decision = reviewState.decisions[key];
        if (decision?.kind === "skip") {
          discarded += 1;
          return [];
        }
        let canyonId: string | null = null;
        let displayName: string | null | undefined = undefined;
        if (decision?.kind === "link") {
          canyonId = decision.id;
        } else if (decision?.kind === "create") {
          canyonId = createdCanyonIdByKey[key] ?? null;
          if (canyonId == null) {
            displayName = row.sourceCanyonName || null;
          }
        } else {
          // noCanyon (or unset) → canyon-less; name the trip after the raw string.
          canyonId = null;
          displayName = row.sourceCanyonName || null;
        }
        return [{
          canyonId,
          sourceCanyonName: row.sourceCanyonName,
          displayName,
          type: row.type,
          date: row.date,
          notes: row.notes,
          customFields: row.customFields,
        }];
      });

      const result = await bulkCreateTripLogs({ importBatchId: batchId, trips });
      onRefetchCanyons();
      onRefetchTripLogs();
      onRefetchAnalytics();

      const linked = trips.filter((t) => t.canyonId != null).length;
      const noCanyon = trips.filter((t) => t.canyonId == null).length;
      setOutcome({
        kind: "triplog",
        batchId,
        imported: result.imported,
        updated: result.updated,
        createdCanyons,
        noCanyon,
        linked,
        discarded,
        errors: [...errors, ...result.errors.map((e) => `Row ${e.index + 1}: ${e.error}`)],
      });
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't import trips. Please try again."));
    } finally {
      setImporting(false);
    }
  }

  async function handleUndo() {
    if (!outcome) return;
    setUndoing(true);
    try {
      await undoImport(outcome.batchId);
      onRefetchCanyons();
      onRefetchTripLogs();
      onRefetchAnalytics();
      onClose();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't undo this import. Please try again."));
    } finally {
      setUndoing(false);
    }
  }

  // ── Persist merge policy edits to user prefs ─────────────────────────────────

  function updateMergeField(field: MergeableField, useIncoming: boolean) {
    const next: CanyonMergePolicy = {
      ...mergePolicy,
      [field]: useIncoming ? "useIncoming" : "keepExisting",
    };
    setMergePolicy(next);
    // Best-effort: persist the preference so it seeds future imports.
    updateUserPreferences({ importMergePolicy: next }).catch(console.error);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  // When both a canyon list and a logbook are queued, label which stage we're in.
  const bothFiles = !!canyonFile && !!tripFile;
  const stageSuffix =
    bothFiles && !outcome
      ? activeKind === "triplog"
        ? " — logbook (2 of 2)"
        : " — canyons (1 of 2)"
      : "";

  const title = outcome
    ? "Import complete"
    : importing
      ? "Importing…"
      : (step === "map"
          ? "Import data"
          : step === "review"
            ? "Review matches"
            : "Confirm import") + stageSuffix;

  function renderFileChip(loaded: LoadedFile, which: "canyon" | "triplog") {
    return (
      <Box className={classes.fileChip}>
        <span className={classes.fileName}>{loaded.fileName}</span>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={loaded.kind}
          onChange={(_e, v) => {
            if (v) overrideKind(loaded, which, v as FileKind);
          }}
        >
          <ToggleButton value="canyon" sx={{ textTransform: "none", color: "var(--theme-text-primary)" }}>
            Canyons
          </ToggleButton>
          <ToggleButton value="triplog" sx={{ textTransform: "none", color: "var(--theme-text-primary)" }}>
            Logbook
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
    );
  }

  // Header row clarifying the left column = your CSV, right column = Logjam field.
  function renderColumnMapHeader() {
    return (
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", px: 0 }}>
        <Typography variant="caption" sx={{ flex: 1, color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
          Your file
        </Typography>
        <Typography variant="caption" sx={{ flex: 2, minWidth: 160, color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
          Logjam field
        </Typography>
      </Box>
    );
  }

  function renderMapStep() {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {noCanyonsYet && (
          <ErrorBanner message="You have no canyons yet. Importing a logbook works best after you load the RopeWiki canyon database — your trips can then match against it. You can still import now and link trips later." />
        )}
        <Box
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`${classes.dropZone} ${dragging ? classes.dropZoneActive : ""}`}
        >
          <UploadFileIcon sx={{ fontSize: 36, color: "var(--theme-text-muted)", mb: 0.5 }} />
          <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
            Drop a CSV here, or click to browse. You can add a canyon list and a logbook together.
          </Typography>
          <input ref={fileInputRef} type="file" accept=".csv" hidden multiple onChange={handleFileChange} />
        </Box>

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
          A canyon list needs a name, latitude and longitude (grades and notes are
          optional). A logbook needs a canyon name and a date (notes optional).
          Need a starting point?{" "}
          <a href="/templates/canyon-import-template.csv" download style={{ color: "var(--theme-accent)" }}>
            Canyon template
          </a>{" "}
          ·{" "}
          <a href="/templates/logbook-import-template.csv" download style={{ color: "var(--theme-accent)" }}>
            Logbook template
          </a>
        </Typography>

        {canyonFile && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {renderFileChip(canyonFile, "canyon")}
            <SectionLabel text="Canyon columns" />
            {renderColumnMapHeader()}
            {canyonFile.headers.map((header) => (
              <Box key={header} sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
                <Typography variant="body2" sx={{ flex: 1, color: "var(--theme-text-primary)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {header}
                </Typography>
                <FormControl size="small" sx={{ flex: 2, minWidth: 160 }}>
                  <Select
                    value={canyonAssignments[header] ?? "discard"}
                    onChange={(e) =>
                      setCanyonAssignments((prev) => ({ ...prev, [header]: e.target.value as CanyonFieldRole }))
                    }
                    sx={selectSx}
                    MenuProps={menuPaperProps}
                  >
                    {ALL_ASSIGNABLE_ROLES.map((r) => (
                      <MenuItem key={r} value={r}>{ROLE_LABELS[r] ?? r}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            ))}
            <Typography className={classes.mappingFeedback}>
              {canyonMapValid
                ? "Name, latitude and longitude found — canyons will be matched by name and coordinates."
                : "Name, latitude and longitude are required for a canyon list."}
            </Typography>
            {ignoredCanyonCols.length > 0 && (
              <Typography className={classes.ignoredNotice}>
                Ignored columns: {ignoredCanyonCols.join(", ")}
              </Typography>
            )}
          </Box>
        )}

        {tripFile && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {renderFileChip(tripFile, "triplog")}
            <SectionLabel text="Logbook columns" />
            {renderColumnMapHeader()}
            {tripFile.headers.map((header) => {
              const role = tripAssignments[header] ?? "discard";
              const form = tripNewCfForms[header] ?? { label: header, type: "string" as TripLogCustomFieldType };
              return (
                <Box key={header} sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
                    <Typography variant="body2" sx={{ flex: 1, color: "var(--theme-text-primary)", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {header}
                    </Typography>
                    <FormControl size="small" sx={{ flex: 2, minWidth: 160 }}>
                      <Select
                        value={role}
                        onChange={(e) =>
                          setTripAssignments((prev) => ({ ...prev, [header]: e.target.value as ColumnRole }))
                        }
                        sx={selectSx}
                        MenuProps={menuPaperProps}
                      >
                        <MenuItem value="name">Canyon Name</MenuItem>
                        <MenuItem value="date">Date</MenuItem>
                        <MenuItem value="notes">Notes</MenuItem>
                        <MenuItem value="type">Type</MenuItem>
                        {customFieldDefs.map((d) => (
                          <MenuItem key={d.key} value={`cf:${d.key}`}>Field: {d.label}</MenuItem>
                        ))}
                        <MenuItem value="new-cf">Import as new custom field…</MenuItem>
                        <MenuItem value="discard">Ignore</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                  {role === "new-cf" && (
                    <Box sx={{ ml: 2, display: "flex", gap: 1.5, alignItems: "center", pl: 1, borderLeft: "2px solid var(--theme-accent)" }}>
                      <TextField
                        label="Field label"
                        value={form.label}
                        onChange={(e) =>
                          setTripNewCfForms((prev) => ({ ...prev, [header]: { ...form, label: e.target.value } }))
                        }
                        size="small"
                        sx={fieldSx}
                      />
                      <FormControl size="small" sx={{ minWidth: 120 }}>
                        <InputLabel sx={{ color: "var(--theme-text-muted)", fontSize: "0.85em" }}>Type</InputLabel>
                        <Select
                          label="Type"
                          value={form.type}
                          onChange={(e) =>
                            setTripNewCfForms((prev) => ({ ...prev, [header]: { ...form, type: e.target.value as TripLogCustomFieldType } }))
                          }
                          sx={selectSx}
                          MenuProps={menuPaperProps}
                        >
                          {CUSTOM_FIELD_TYPES.map((t) => (
                            <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                  )}
                </Box>
              );
            })}
            <Typography className={classes.mappingFeedback}>
              {tripMapValid
                ? "Canyon name and date found — trips will match canyons by name."
                : "A canyon name column and a date column are required for a logbook."}
            </Typography>
            {ignoredTripCols.length > 0 && (
              <Typography className={classes.ignoredNotice}>
                Ignored columns: {ignoredTripCols.join(", ")}
              </Typography>
            )}
            {tripMapValid && (
              <>
                <Divider sx={{ borderColor: "rgba(255,255,255,0.1)", my: 0.5 }} />
                <SectionLabel text="Date format" />
                <FormControl size="small" sx={{ minWidth: 240 }}>
                  <Select
                    value={dateFormat}
                    onChange={(e) => setDateFormat(e.target.value as DateFormat)}
                    sx={selectSx}
                    MenuProps={menuPaperProps}
                  >
                    {(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map((f) => (
                      <MenuItem key={f} value={f}>{DATE_FORMAT_LABELS[f]}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </>
            )}
          </Box>
        )}
      </Box>
    );
  }

  // Inline create-canyon coord form, rendered directly under the match whose
  // decision is "create" (trip imports only).
  function renderCreateForm(key: string) {
    const f = reviewState.createForms[key] ?? { name: key, latitude: "", longitude: "" };
    return (
      <Box className={classes.createForm}>
        <TextField
          label="Canyon name"
          value={f.name}
          onChange={(e) => updateCreateForm(key, { name: e.target.value })}
          size="small"
          fullWidth
          sx={fieldSx}
        />
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <TextField
            label="Latitude"
            value={f.latitude}
            onChange={(e) => updateCreateForm(key, { latitude: e.target.value })}
            size="small"
            sx={{ ...fieldSx, flex: 1 }}
            placeholder="-33.123456"
          />
          <TextField
            label="Longitude"
            value={f.longitude}
            onChange={(e) => updateCreateForm(key, { longitude: e.target.value })}
            size="small"
            sx={{ ...fieldSx, flex: 1 }}
            placeholder="150.123456"
          />
          <Button
            size="small"
            variant="outlined"
            onClick={() => handlePickCoordsFor(key)}
            sx={{ borderColor: "var(--theme-accent)", color: "var(--theme-accent)", flexShrink: 0, textTransform: "none" }}
          >
            Pick on map
          </Button>
        </Box>
      </Box>
    );
  }

  function renderReviewStep() {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
          {activeKind === "canyon"
            ? "These canyon names matched more than one option, or matched something far away. Choose what to do with each."
            : "These canyon names couldn't be matched confidently. Link them, create a new canyon, import the trip without a canyon, or discard it."}
        </Typography>
        <MatchReview
          items={reviewItems}
          onChange={handleReviewChange}
          renderItemExtra={(index) => {
            if (activeKind !== "triplog") return null;
            const key = surfacedKeys[index];
            if (!key || reviewState.decisions[key]?.kind !== "create") return null;
            return renderCreateForm(key);
          }}
        />
      </Box>
    );
  }

  function renderConfirmStep() {
    if (outcome) {
      const headline: HeadlineCount[] =
        outcome.kind === "canyon"
          ? [
              { count: outcome.created, label: "created" },
              { count: outcome.merged, label: "merged" },
              { count: outcome.skipped, label: "skipped" },
            ]
          : [
              { count: outcome.imported, label: "imported" },
              { count: outcome.updated, label: "updated" },
              { count: outcome.linked, label: "linked to a canyon" },
              { count: outcome.noCanyon, label: "without a canyon" },
              { count: outcome.discarded, label: "discarded" },
            ];
      const details: DetailSection[] = [];
      return (
        <ImportResultSummary
          headline={headline}
          details={details.length > 0 ? details : undefined}
          errors={outcome.errors.length > 0 ? outcome.errors : undefined}
          onUndo={handleUndo}
          undoing={undoing}
        />
      );
    }

    // Pre-import preview
    const preview =
      activeKind === "canyon"
        ? `${preparedCanyonRows.length} canyon row${preparedCanyonRows.length !== 1 ? "s" : ""} ready to import.`
        : `${preparedTripRows.length} trip${preparedTripRows.length !== 1 ? "s" : ""} ready to import.`;

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography variant="body2" sx={{ color: "var(--theme-text-primary)" }}>{preview}</Typography>

        {activeKind === "canyon" && (
          <Accordion
            sx={{
              backgroundColor: "rgba(255,255,255,0.04)",
              color: "var(--theme-text-primary)",
              "& .MuiAccordionSummary-root": { minHeight: 40 },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: "var(--theme-text-primary)" }} />}>
              <Typography variant="body2">Merge settings</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", display: "block", mb: 1 }}>
                When a row matches an existing canyon, keep the existing value or use the value from your file.
                Empty fields always fill in (no data is lost); names and coordinates never change.
              </Typography>
              {(Object.keys(MERGEABLE_FIELD_LABELS) as MergeableField[]).map((field) => (
                <FormControlLabel
                  key={field}
                  control={
                    <Switch
                      size="small"
                      checked={mergePolicy[field] === "useIncoming"}
                      onChange={(e) => updateMergeField(field, e.target.checked)}
                      color="secondary"
                    />
                  }
                  label={
                    <Typography variant="body2" sx={{ color: "var(--theme-text-primary)" }}>
                      {MERGEABLE_FIELD_LABELS[field]}: {mergePolicy[field] === "useIncoming" ? "use file" : "keep existing"}
                    </Typography>
                  }
                  sx={{ display: "flex" }}
                />
              ))}
            </AccordionDetails>
          </Accordion>
        )}

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      </Box>
    );
  }

  // Leaving the importer before it finishes: from onboarding this returns to the
  // welcome hub (so the user must explicitly "Start empty" to enter the app);
  // once an import has completed, or outside onboarding, it just closes.
  const handleDismiss = outcome ? onClose : (onBack ?? onClose);

  function renderContent() {
    if (importing) {
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 1 }}>
          <CircularProgress size={24} />
          <Typography>Importing…</Typography>
        </Box>
      );
    }
    if (outcome) return renderConfirmStep();
    if (step === "map") return renderMapStep();
    if (step === "review") return renderReviewStep();
    return renderConfirmStep();
  }

  function renderActions() {
    if (importing) return null;
    if (outcome) {
      return (
        <Button variant="contained" color="secondary" onClick={onClose}>
          Done
        </Button>
      );
    }
    if (step === "map") {
      return (
        <>
          <Button onClick={handleDismiss} sx={{ color: "var(--theme-text-primary)" }}>
            {onBack ? "Back" : "Cancel"}
          </Button>
          <Button variant="contained" color="secondary" onClick={handleMapNext} disabled={!canProceedFromMap}>
            Next
          </Button>
        </>
      );
    }
    if (step === "review") {
      return (
        <>
          <Button onClick={() => setStep("map")} sx={{ color: "var(--theme-text-primary)" }}>Back</Button>
          <Button variant="contained" color="secondary" onClick={() => setStep("confirm")} disabled={!reviewValid}>
            Next
          </Button>
        </>
      );
    }
    // confirm
    return (
      <>
        <Button onClick={() => setStep(surfacedKeys.length > 0 ? "review" : "map")} sx={{ color: "var(--theme-text-primary)" }}>
          Back
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={activeKind === "canyon" ? handleImportCanyons : handleImportTrips}
        >
          Import
        </Button>
      </>
    );
  }

  return (
    <Dialog
      fullScreen={isMobile}
      open={open}
      // Ignore backdrop clicks so a stray click can't discard an in-progress
      // merge/review. The title-bar ✕ and the Back button are the explicit exits.
      onClose={(_e, reason) => {
        if (importing || reason === "backdropClick") return;
        handleDismiss();
      }}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
          maxHeight: "85vh",
        },
      }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}>
        {title}
        <IconButton
          aria-label="Close dialog"
          size="small"
          onClick={handleDismiss}
          disabled={importing}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent ref={contentRef} dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {renderContent()}
      </DialogContent>
      <DialogActions>{renderActions()}</DialogActions>
    </Dialog>
  );
}

export default UnifiedImportDialog;
