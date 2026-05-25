import { useState, useEffect, useRef, useMemo } from "react";
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
  Autocomplete,
  ToggleButtonGroup,
  ToggleButton,
  Chip,
  Tooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import type { TCanyon, BulkCanyonInput, BulkCanyonRequest } from "../../canyonUtils";
import { bulkCanyonImport } from "../../canyonUtils";
import { parseCsv } from "../../csvImport/parseCsv";
import {
  detectCanyonColumns,
  ROLE_LABELS,
  ALL_ASSIGNABLE_ROLES,
  REQUIRED_ROLES,
  GRADE_RANGES,
} from "../../csvImport/canyonColumns";
import type { CanyonFieldRole } from "../../csvImport/canyonColumns";
import { parseByRole } from "../../csvImport/canyonValueParsers";
import { detectMismatches } from "../../csvImport/mismatchDetection";
import type { ColumnMismatch } from "../../csvImport/mismatchDetection";
import {
  getHandlers,
  getDefaultHandlerId,
  DISCARD_COLUMN_ID,
  STORE_AS_ATTR_ID,
  LEAVE_BLANK_ID,
} from "../../csvImport/mismatchHandlers";
import { mergeCanyon } from "../../csvImport/mergeCanyon";
import type { ConflictPolicy } from "../../csvImport/mergeCanyon";
import { matchCanyonByName } from "../../csvImport/matchCanyon";
import { norm } from "@logjam/shared";
import { fieldSx, selectSx, menuPaperProps, SectionLabel } from "../../csvImport/dialogStyles";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";

// ── Types ─────────────────────────────────────────────────────────────────────

type MismatchChoice = {
  handlerId: string;
  lookupTable: Record<string, string>;
  customAttrKey: string;
};

type PreparedCanyonRow = {
  rowIndex: number;
  csvName: string;
  input: BulkCanyonInput;
};

type UnmatchedGroup = {
  csvName: string;
  rows: PreparedCanyonRow[];
};

type MatchedRow = {
  rowIndex: number;
  csvName: string;
  input: BulkCanyonInput;
  matchedCanyon: TCanyon;
};

type UnmatchedResolution =
  | { kind: "create" }
  | { kind: "discard" }
  | { kind: "assign"; canyonId: string; canyonName: string };

type MatchedAction = "skip" | "replace" | "merge";

type Stage =
  | { name: "select-file" }
  | { name: "mapping"; headers: string[]; rows: Record<string, string>[] }
  | {
      name: "mismatch-resolve";
      headers: string[];
      rows: Record<string, string>[];
      mismatches: ColumnMismatch[];
    }
  | {
      name: "resolve-unmatched";
      unmatched: UnmatchedGroup[];
      matched: MatchedRow[];
    }
  | {
      name: "resolve-matched";
      creates: PreparedCanyonRow[];
      discardCount: number;
      matched: MatchedRow[];
    }
  | {
      name: "confirm";
      creates: PreparedCanyonRow[];
      replaces: { canyonId: string; data: BulkCanyonInput }[];
      discardCount: number;
      newAttrKeys: string[];
    }
  | { name: "importing" }
  | {
      name: "result";
      created: number;
      replaced: number;
      errors: { rowIndex: number; message: string }[];
    };

// ── Row processing ────────────────────────────────────────────────────────────

function applyHandlerToRaw(
  raw: string,
  handlerId: string,
  choice: MismatchChoice,
  role: CanyonFieldRole,
  columnSourceRange: [number, number] | null,
): unknown {
  if (!raw.trim()) return null;

  if (handlerId === DISCARD_COLUMN_ID) return undefined; // signals "skip this column"
  if (handlerId === STORE_AS_ATTR_ID) return raw.trim();
  if (handlerId === LEAVE_BLANK_ID) return null;

  if (handlerId === "manualLookupTable") {
    const mapped = choice.lookupTable[raw.trim()];
    if (mapped === undefined) return null;
    const n = Number(mapped);
    return isNaN(n) ? mapped : n;
  }

  if (handlerId === "clamp") {
    const range = GRADE_RANGES[role];
    const n = Number(raw);
    if (!range || isNaN(n)) return null;
    return Math.max(range[0], Math.min(range[1], Math.round(n)));
  }

  if (handlerId === "rescaleLinear" && columnSourceRange) {
    const [srcMin, srcMax] = columnSourceRange;
    const range = GRADE_RANGES[role];
    if (!range || srcMax === srcMin) return null;
    const [tgtMin, tgtMax] = range;
    const n = Number(raw);
    if (isNaN(n)) return null;
    return Math.round(
      tgtMin + ((n - srcMin) / (srcMax - srcMin)) * (tgtMax - tgtMin),
    );
  }

  // Look up in handler registry
  const handlers = getHandlers("decimalInInt", false); // get all handlers across kinds
  // Search across all kinds for the handler
  const allKinds = [
    "decimalInInt", "outOfRange", "scaleMismatch", "nonNumeric",
    "unparsableArray", "unparsableJson", "coordFormat", "booleanish", "mixedTypes",
  ] as const;
  for (const k of allKinds) {
    const found = getHandlers(k, true).find((h) => h.id === handlerId);
    if (found) return found.apply(raw);
  }
  void handlers;
  return null;
}

function buildSourceRange(
  rows: Record<string, string>[],
  header: string,
): [number, number] | null {
  const nums = rows
    .map((r) => Number((r[header] ?? "").trim()))
    .filter((n) => !isNaN(n));
  if (nums.length === 0) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

function processRows(
  rows: Record<string, string>[],
  assignments: Record<string, CanyonFieldRole>,
  newAttrForms: Record<string, string>,
  mismatchChoices: Record<string, MismatchChoice>,
  mismatches: ColumnMismatch[],
): PreparedCanyonRow[] {
  // Pre-compute source ranges for scaleMismatch columns
  const sourceRanges = new Map<string, [number, number] | null>();
  for (const m of mismatches) {
    if (m.kind === "scaleMismatch") {
      sourceRanges.set(m.csvHeader, buildSourceRange(rows, m.csvHeader));
    }
  }

  // Determine which columns have "storeAsCustomAttribute" chosen
  const storeAsAttrHeaders = new Set<string>();
  for (const [header, choice] of Object.entries(mismatchChoices)) {
    if (choice.handlerId === STORE_AS_ATTR_ID || choice.handlerId === "treatAllAsString") {
      storeAsAttrHeaders.add(header);
    }
  }

  return rows.map((row, rowIndex) => {
    const input: BulkCanyonInput = { name: "", latitude: 0, longitude: 0 };
    const attrs: Record<string, unknown> = {};

    for (const [header, role] of Object.entries(assignments)) {
      if (role === "discard") continue;

      const raw = row[header] ?? "";
      const choice = mismatchChoices[header];

      // Handle storeAsAttr override
      if (storeAsAttrHeaders.has(header)) {
        const key = choice?.customAttrKey || header.toLowerCase().replace(/\s+/g, "_");
        attrs[key] = raw.trim() || null;
        continue;
      }

      // Parse value
      const parseResult = parseByRole(raw, role);
      let value: unknown;

      if (parseResult.ok) {
        value = parseResult.value;
      } else if (choice) {
        const sourceRange = sourceRanges.get(header) ?? null;
        const applied = applyHandlerToRaw(raw, choice.handlerId, choice, role, sourceRange);
        if (applied === undefined) continue; // discardColumn
        value = applied;
      } else {
        value = null;
      }

      // Map to BulkCanyonInput fields
      if (role === "name") {
        input.name = String(value ?? "");
      } else if (role === "latitude") {
        const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
        if (!isNaN(n)) input.latitude = n;
      } else if (role === "longitude") {
        const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
        if (!isNaN(n)) input.longitude = n;
      } else if (role === "altNames") {
        input.altNames = Array.isArray(value) ? (value as string[]) : [];
      } else if (role === "notes") {
        input.notes = value != null && value !== "" ? String(value) : null;
      } else if (role === "numAbseils") {
        input.numAbseils = value != null && !isNaN(Number(value)) ? Math.round(Number(value)) : null;
      } else if (role === "longestAbseil") {
        input.longestAbseil = value != null && !isNaN(Number(value)) ? Number(value) : null;
      } else if (role === "hours") {
        input.hours = value != null && !isNaN(Number(value)) ? Number(value) : null;
      } else if (role === "vGrade") {
        input.vGrade = value != null && !isNaN(Number(value)) ? Math.round(Number(value)) : null;
      } else if (role === "aGrade") {
        input.aGrade = value != null && !isNaN(Number(value)) ? Math.round(Number(value)) : null;
      } else if (role === "commitment") {
        input.commitment = value != null && !isNaN(Number(value)) ? Math.round(Number(value)) : null;
      } else if (role === "quality") {
        input.quality = value != null && !isNaN(Number(value)) ? Math.round(Number(value)) : null;
      } else if (role === "wetsuits") {
        input.wetsuits = value != null && !isNaN(Number(value)) ? Math.round(Number(value)) : null;
      } else if (role === "sources") {
        attrs["sources"] = Array.isArray(value) ? value : [];
      } else if (role === "new-attr") {
        const key = newAttrForms[header]?.trim() || header.toLowerCase().replace(/\s+/g, "_");
        if (key) attrs[key] = value ?? null;
      } else if (typeof role === "string" && role.startsWith("attr:")) {
        const key = role.slice(5);
        if (key) attrs[key] = value ?? null;
      }
    }

    if (Object.keys(attrs).length > 0) {
      input.attributes = attrs;
    }

    return { rowIndex, csvName: input.name, input };
  });
}

function splitByMatch(
  prepared: PreparedCanyonRow[],
  canyons: TCanyon[],
): { matched: MatchedRow[]; unmatched: UnmatchedGroup[] } {
  const matched: MatchedRow[] = [];
  const unmatchedMap = new Map<string, PreparedCanyonRow[]>();

  for (const row of prepared) {
    const result = matchCanyonByName(row.csvName, canyons);
    if (result.kind === "match") {
      matched.push({
        rowIndex: row.rowIndex,
        csvName: row.csvName,
        input: row.input,
        matchedCanyon: result.canyon,
      });
    } else {
      const key = row.csvName;
      if (!unmatchedMap.has(key)) unmatchedMap.set(key, []);
      unmatchedMap.get(key)!.push(row);
    }
  }

  const unmatched: UnmatchedGroup[] = [];
  for (const [csvName, rows] of unmatchedMap) {
    unmatched.push({ csvName, rows });
  }

  return { matched, unmatched };
}

function filterCanyonOptions(
  options: TCanyon[],
  state: { inputValue: string },
): TCanyon[] {
  const q = norm(state.inputValue);
  if (!q) return options.slice(0, 50);

  type Scored = { canyon: TCanyon; score: number };
  const scored: Scored[] = [];
  for (const c of options) {
    const name = norm(c.name);
    const altMatches = c.altNames.map(norm);
    let score = 0;
    if (name === q || altMatches.includes(q)) score = 4;
    else if (name.startsWith(q) || altMatches.some((a) => a.startsWith(q))) score = 3;
    else if (name.includes(q) || altMatches.some((a) => a.includes(q))) score = 2;
    if (score > 0) scored.push({ canyon: c, score });
  }
  scored.sort(
    (a, b) => b.score - a.score || a.canyon.name.localeCompare(b.canyon.name),
  );
  return scored.slice(0, 50).map((s) => s.canyon);
}

// ── Component ─────────────────────────────────────────────────────────────────

function CanyonCsvImportDialog({
  open,
  onClose,
  canyons,
  onRefetchCanyons,
}: {
  open: boolean;
  onClose: () => void;
  canyons: TCanyon[];
  onRefetchCanyons: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: "select-file" });
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mapping stage state
  const [assignments, setAssignments] = useState<Record<string, CanyonFieldRole>>({});
  const [newAttrForms, setNewAttrForms] = useState<Record<string, string>>({});

  // Mismatch-resolve stage state
  const [mismatchChoices, setMismatchChoices] = useState<Record<string, MismatchChoice>>({});

  // Resolve-unmatched stage state
  const [unmatchedResolutions, setUnmatchedResolutions] = useState<
    Record<string, UnmatchedResolution | null>
  >({});

  // Resolve-matched stage state
  const [matchedActions, setMatchedActions] = useState<Record<number, MatchedAction>>({});
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>("keepExisting");
  const [perRowPolicies, setPerRowPolicies] = useState<Record<number, ConflictPolicy>>({});

  const pickingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (pickingRef.current) {
      pickingRef.current = false;
      return;
    }
    setStage({ name: "select-file" });
    setParseError(null);
    setAssignments({});
    setNewAttrForms({});
    setMismatchChoices({});
    setUnmatchedResolutions({});
    setMatchedActions({});
    setConflictPolicy("keepExisting");
    setPerRowPolicies({});
  }, [open]);

  // ── File select ────────────────────────────────────────────────────────────

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
    const dropped = e.dataTransfer.files[0];
    if (dropped) void handleFileSelected(dropped);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await handleFileSelected(file);
  }

  async function handleFileSelected(file: File) {
    setParseError(null);
    try {
      const parsed = await parseCsv(file);
      if (parsed.headers.length === 0) {
        setParseError("No columns found in CSV.");
        return;
      }
      const detected = detectCanyonColumns(parsed.headers);
      setAssignments(detected);
      setNewAttrForms({});
      setStage({ name: "mapping", headers: parsed.headers, rows: parsed.rows });
    } catch (err) {
      console.error(err);
      setParseError(messageFromError(err, "Couldn't read the CSV file. Please check the file and try again."));
    }
  }

  // ── Mapping → Mismatch-resolve (or directly to resolve-unmatched) ──────────

  function handleMappingNext() {
    if (stage.name !== "mapping") return;
    const { headers, rows } = stage;

    // Validate new-attr keys
    for (const header of headers) {
      if (assignments[header] === "new-attr") {
        if (!newAttrForms[header]?.trim()) {
          setParseError(`Column "${header}" is set to "New custom attribute" but no key name was entered.`);
          return;
        }
      }
    }

    setParseError(null);
    const mismatches = detectMismatches(rows, assignments);

    if (mismatches.length > 0) {
      // Initialize mismatch choices with defaults
      const choices: Record<string, MismatchChoice> = {};
      for (const m of mismatches) {
        choices[m.csvHeader] = {
          handlerId: getDefaultHandlerId(m.kind),
          lookupTable: {},
          customAttrKey: m.csvHeader.toLowerCase().replace(/\s+/g, "_"),
        };
      }
      setMismatchChoices(choices);
      setStage({ name: "mismatch-resolve", headers, rows, mismatches });
    } else {
      advanceToResolve(rows, []);
    }
  }

  // ── Mismatch-resolve → resolve-unmatched ──────────────────────────────────

  function handleMismatchNext() {
    if (stage.name !== "mismatch-resolve") return;
    const { rows, mismatches } = stage;
    advanceToResolve(rows, mismatches);
  }

  function advanceToResolve(
    rows: Record<string, string>[],
    mismatches: ColumnMismatch[],
  ) {
    const prepared = processRows(rows, assignments, newAttrForms, mismatchChoices, mismatches);

    if (canyons.length === 0) {
      setStage({
        name: "confirm",
        creates: prepared,
        replaces: [],
        discardCount: 0,
        newAttrKeys: collectNewAttrKeys(),
      });
      return;
    }

    const { matched, unmatched } = splitByMatch(prepared, canyons);

    // Init unmatched resolutions
    const resolutions: Record<string, UnmatchedResolution | null> = {};
    for (const g of unmatched) resolutions[g.csvName] = null;
    setUnmatchedResolutions(resolutions);

    // Init matched actions (default: skip)
    const actions: Record<number, MatchedAction> = {};
    for (const m of matched) actions[m.rowIndex] = "skip";
    setMatchedActions(actions);

    if (unmatched.length > 0) {
      setStage({ name: "resolve-unmatched", unmatched, matched });
    } else if (matched.length > 0) {
      setStage({ name: "resolve-matched", creates: [], discardCount: 0, matched });
    } else {
      // Nothing to import
      setStage({
        name: "confirm",
        creates: [],
        replaces: [],
        discardCount: prepared.length,
        newAttrKeys: collectNewAttrKeys(),
      });
    }
  }

  // ── Resolve-unmatched → resolve-matched (or confirm) ──────────────────────

  function handleUnmatchedNext() {
    if (stage.name !== "resolve-unmatched") return;
    const { unmatched, matched } = stage;

    const creates: PreparedCanyonRow[] = [];
    let discardCount = 0;
    const assignedRows: MatchedRow[] = [];

    for (const group of unmatched) {
      const resolution = unmatchedResolutions[group.csvName];
      if (!resolution || resolution.kind === "discard") {
        discardCount += group.rows.length;
      } else if (resolution.kind === "create") {
        creates.push(...group.rows);
      } else if (resolution.kind === "assign") {
        const canyon = canyons.find((c) => c.id === resolution.canyonId);
        if (canyon) {
          for (const row of group.rows) {
            assignedRows.push({
              rowIndex: row.rowIndex,
              csvName: row.csvName,
              input: row.input,
              matchedCanyon: canyon,
            });
          }
        }
      }
    }

    // Merge assigned rows into matched pool
    const allMatched = [...matched, ...assignedRows];

    // Init actions for newly-assigned rows (default: skip)
    const actions = { ...matchedActions };
    for (const r of assignedRows) {
      if (!(r.rowIndex in actions)) actions[r.rowIndex] = "skip";
    }
    setMatchedActions(actions);

    if (allMatched.length > 0) {
      setStage({ name: "resolve-matched", creates, discardCount, matched: allMatched });
    } else {
      setStage({
        name: "confirm",
        creates,
        replaces: [],
        discardCount,
        newAttrKeys: collectNewAttrKeys(),
      });
    }
  }

  // ── Resolve-matched → confirm ──────────────────────────────────────────────

  function handleMatchedNext() {
    if (stage.name !== "resolve-matched") return;
    const { creates, discardCount, matched } = stage;

    const replaces: { canyonId: string; data: BulkCanyonInput }[] = [];
    let extraDiscard = 0;

    for (const row of matched) {
      const action = matchedActions[row.rowIndex] ?? "skip";
      if (action === "skip") {
        extraDiscard++;
      } else if (action === "replace") {
        replaces.push({ canyonId: row.matchedCanyon.id, data: row.input });
      } else if (action === "merge") {
        const policy = perRowPolicies[row.rowIndex] ?? conflictPolicy;
        const merged = mergeCanyon(row.matchedCanyon, row.input, policy);
        replaces.push({ canyonId: row.matchedCanyon.id, data: merged });
      }
    }

    setStage({
      name: "confirm",
      creates,
      replaces,
      discardCount: discardCount + extraDiscard,
      newAttrKeys: collectNewAttrKeys(),
    });
  }

  function collectNewAttrKeys(): string[] {
    const keys = new Set<string>();
    for (const [header, role] of Object.entries(assignments)) {
      if (role === "new-attr") {
        const key = newAttrForms[header]?.trim();
        if (key) keys.add(key);
      } else if (typeof role === "string" && role.startsWith("attr:")) {
        keys.add(role.slice(5));
      }
    }
    // Also collect keys from storeAsAttr choices
    for (const [, choice] of Object.entries(mismatchChoices)) {
      if (choice.handlerId === STORE_AS_ATTR_ID) {
        if (choice.customAttrKey) keys.add(choice.customAttrKey);
      }
    }
    return [...keys];
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async function handleImport() {
    if (stage.name !== "confirm") return;
    const { creates, replaces } = stage;
    setStage({ name: "importing" });

    const allErrors: { rowIndex: number; message: string }[] = [];
    let totalCreated = 0;
    let totalReplaced = 0;

    try {
      if (creates.length > 0) {
        const createBody: BulkCanyonRequest = {
          mode: "create",
          canyons: creates.map((r) => r.input),
        };
        const result = await bulkCanyonImport(createBody);
        totalCreated = result.created;
        allErrors.push(...result.errors);
      }

      if (replaces.length > 0) {
        const replaceBody: BulkCanyonRequest = {
          mode: "replace",
          replacements: replaces,
        };
        const result = await bulkCanyonImport(replaceBody);
        totalReplaced = result.replaced;
        allErrors.push(...result.errors);
      }

      onRefetchCanyons();
      setStage({
        name: "result",
        created: totalCreated,
        replaced: totalReplaced,
        errors: allErrors,
      });
    } catch (err) {
      console.error(err);
      setStage({
        name: "result",
        created: totalCreated,
        replaced: totalReplaced,
        errors: [
          ...allErrors,
          { rowIndex: -1, message: messageFromError(err, "Import failed. Please try again.") },
        ],
      });
    }
  }

  // ── Validity checks ────────────────────────────────────────────────────────

  const mappingValid = useMemo(() => {
    if (stage.name !== "mapping") return false;
    const assigned = new Set(Object.values(assignments));
    for (const req of REQUIRED_ROLES) {
      if (!assigned.has(req)) return false;
    }
    // No duplicate required roles
    const counts: Record<string, number> = {};
    for (const role of Object.values(assignments)) {
      if (REQUIRED_ROLES.includes(role as typeof REQUIRED_ROLES[number])) {
        counts[role] = (counts[role] ?? 0) + 1;
        if (counts[role] > 1) return false;
      }
    }
    return true;
  }, [stage, assignments]);

  const mismatchValid = useMemo(() => {
    if (stage.name !== "mismatch-resolve") return false;
    for (const m of stage.mismatches) {
      if (!mismatchChoices[m.csvHeader]?.handlerId) return false;
    }
    return true;
  }, [stage, mismatchChoices]);

  const unmatchedValid = useMemo(() => {
    if (stage.name !== "resolve-unmatched") return false;
    for (const group of stage.unmatched) {
      const res = unmatchedResolutions[group.csvName];
      if (!res) return false;
    }
    return true;
  }, [stage, unmatchedResolutions]);

  // Count merge rows with per-row overrides (for confirm summary)
  const mergeOverrideCount = useMemo(() => {
    return Object.keys(perRowPolicies).length;
  }, [perRowPolicies]);

  // ── Render helpers ─────────────────────────────────────────────────────────

  const paperSx = {
    backgroundColor: "var(--theme-primary)",
    color: "var(--theme-text-primary)",
    "& .MuiInputBase-input": { color: "var(--theme-text-primary)" },
    "& .MuiInputBase-inputMultiline": { color: "var(--theme-text-primary)" },
    "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
    "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
    "& .MuiInputLabel-root.Mui-focused": { color: "var(--theme-accent)" },
  };

  const cardSx = {
    p: 1.5,
    mb: 1.5,
    borderRadius: 1,
    border: "1px solid rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  };

  function renderTitle(text: string) {
    return (
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}>
        {text}
        <IconButton size="small" onClick={onClose} sx={{ color: "var(--theme-text-primary)" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
    );
  }

  // ── Stage: select-file ────────────────────────────────────────────────────

  if (stage.name === "select-file") {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: paperSx }}>
        {renderTitle("Import Canyons from CSV")}
        <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
              Upload a CSV file with canyon data. You'll map columns to fields in the next step.
            </Typography>
            <Box
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              sx={{
                border: `2px dashed ${dragging ? "var(--theme-accent)" : "rgba(255,255,255,0.18)"}`,
                borderRadius: "var(--radius-md)",
                p: 3,
                textAlign: "center",
                cursor: "pointer",
                backgroundColor: dragging
                  ? "color-mix(in srgb, var(--theme-accent) 8%, transparent)"
                  : "rgba(255,255,255,0.02)",
                transition: "border-color var(--transition-fast), background-color var(--transition-fast)",
                "&:hover": {
                  borderColor: "var(--theme-accent)",
                  backgroundColor: "color-mix(in srgb, var(--theme-accent) 8%, transparent)",
                },
              }}
            >
              <UploadFileIcon
                sx={{ fontSize: 36, color: "var(--theme-text-muted)", mb: 0.5 }}
              />
              <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
                Drop CSV here, or click to browse
              </Typography>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                hidden
                onChange={handleFileChange}
              />
            </Box>
            {parseError && <ErrorBanner message={parseError} />}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ color: "var(--theme-text-primary)" }}>Cancel</Button>
        </DialogActions>
      </Dialog>
    );
  }

  // ── Stage: mapping ────────────────────────────────────────────────────────

  if (stage.name === "mapping") {
    const { headers } = stage;
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: paperSx }}>
        {renderTitle("Import Canyons — Map Columns")}
        <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, pt: 1 }}>
            <SectionLabel text="Column Assignments" />
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", mb: 1 }}>
              Name, Latitude, and Longitude are required. Each required field must be assigned exactly once.
            </Typography>
            {headers.map((header) => {
              const role = assignments[header] ?? "discard";
              return (
                <Box key={header} sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
                  <Typography
                    variant="body2"
                    sx={{ flex: 1, color: "var(--theme-text-primary)", pt: 1, fontFamily: "monospace" }}
                  >
                    {header}
                  </Typography>
                  <FormControl size="small" sx={{ flex: 2 }}>
                    <InputLabel sx={{ color: "var(--theme-text-muted)" }}>Role</InputLabel>
                    <Select
                      value={role}
                      label="Role"
                      onChange={(e) => {
                        const newRole = e.target.value as CanyonFieldRole;
                        setAssignments((prev) => ({ ...prev, [header]: newRole }));
                        if (newRole !== "new-attr") {
                          setNewAttrForms((prev) => {
                            const next = { ...prev };
                            delete next[header];
                            return next;
                          });
                        }
                      }}
                      sx={selectSx}
                      MenuProps={menuPaperProps}
                    >
                      {ALL_ASSIGNABLE_ROLES.map((r) => (
                        <MenuItem key={r} value={r}>{ROLE_LABELS[r] ?? r}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  {role === "new-attr" && (
                    <TextField
                      size="small"
                      label="Attribute key"
                      value={newAttrForms[header] ?? ""}
                      onChange={(e) =>
                        setNewAttrForms((prev) => ({ ...prev, [header]: e.target.value }))
                      }
                      sx={{ flex: 1, ...fieldSx }}
                    />
                  )}
                </Box>
              );
            })}
            {parseError && <ErrorBanner message={parseError} />}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ color: "var(--theme-text-primary)" }}>Cancel</Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleMappingNext}
            disabled={!mappingValid}
          >
            Next
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // ── Stage: mismatch-resolve ───────────────────────────────────────────────

  if (stage.name === "mismatch-resolve") {
    const { mismatches } = stage;
    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: paperSx }}>
        {renderTitle("Import Canyons — Resolve Type Mismatches")}
        <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, pt: 1 }}>
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", mb: 1 }}>
              {mismatches.length} column{mismatches.length !== 1 ? "s have" : " has"} values that
              don't match the target field type. Choose how to handle each.
            </Typography>
            {mismatches.map((m) => {
              const choice = mismatchChoices[m.csvHeader] ?? {
                handlerId: "",
                lookupTable: {},
                customAttrKey: m.csvHeader.toLowerCase().replace(/\s+/g, "_"),
              };
              const isPartial = m.badRowCount < m.totalRows;
              const handlers = getHandlers(m.kind, isPartial);
              const kindLabel: Record<string, string> = {
                decimalInInt: "Decimal in integer field",
                outOfRange: "Out of valid range",
                scaleMismatch: "Scale mismatch",
                nonNumeric: "Non-numeric value in numeric field",
                unparsableArray: "Cannot parse as list",
                unparsableJson: "Cannot parse as JSON",
                coordFormat: "Non-decimal coordinate format",
                booleanish: "Yes/No value in numeric field",
                mixedTypes: "Mixed data types",
                emptyDominant: "Column mostly empty",
              };

              return (
                <Box key={m.csvHeader} sx={cardSx}>
                  <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" sx={{ fontFamily: "monospace", fontWeight: 600 }}>
                      {m.csvHeader}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
                      → {ROLE_LABELS[m.role] ?? m.role}
                    </Typography>
                    <Chip
                      label={kindLabel[m.kind] ?? m.kind}
                      size="small"
                      sx={{
                        height: 18,
                        fontSize: "0.65em",
                        backgroundColor: "rgba(255,150,50,0.18)",
                        color: "var(--theme-text-primary)",
                      }}
                    />
                  </Box>

                  {isPartial && (
                    <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", display: "block", mb: 0.5 }}>
                      Only affects {m.badRowCount} of {m.totalRows} rows
                    </Typography>
                  )}

                  {m.sampleBadRows.length > 0 && (
                    <Box sx={{ mb: 1 }}>
                      <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
                        Sample values:{" "}
                      </Typography>
                      {m.sampleBadRows.map((r, i) => (
                        <Chip
                          key={i}
                          label={r.raw}
                          size="small"
                          sx={{
                            mr: 0.5,
                            height: 18,
                            fontSize: "0.65em",
                            fontFamily: "monospace",
                            backgroundColor: "rgba(255,255,255,0.08)",
                            color: "var(--theme-text-primary)",
                          }}
                        />
                      ))}
                    </Box>
                  )}

                  <FormControl size="small" fullWidth>
                    <InputLabel sx={{ color: "var(--theme-text-muted)" }}>How to handle</InputLabel>
                    <Select
                      value={choice.handlerId}
                      label="How to handle"
                      onChange={(e) => {
                        setMismatchChoices((prev) => ({
                          ...prev,
                          [m.csvHeader]: { ...choice, handlerId: e.target.value },
                        }));
                      }}
                      sx={selectSx}
                      MenuProps={menuPaperProps}
                    >
                      {handlers.map((h) => {
                        const label =
                          h.id === LEAVE_BLANK_ID
                            ? `Leave blank for ${m.badRowCount} bad row${m.badRowCount !== 1 ? "s" : ""}`
                            : h.label;
                        return (
                          <MenuItem key={h.id} value={h.id}>{label}</MenuItem>
                        );
                      })}
                    </Select>
                  </FormControl>

                  {/* Custom attribute key input */}
                  {choice.handlerId === STORE_AS_ATTR_ID && (
                    <TextField
                      size="small"
                      label="Custom attribute key"
                      value={choice.customAttrKey}
                      onChange={(e) =>
                        setMismatchChoices((prev) => ({
                          ...prev,
                          [m.csvHeader]: { ...choice, customAttrKey: e.target.value },
                        }))
                      }
                      sx={{ mt: 1, width: "100%", ...fieldSx }}
                    />
                  )}

                  {/* Manual lookup table */}
                  {choice.handlerId === "manualLookupTable" && (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", display: "block", mb: 0.5 }}>
                        Map each distinct value to a number:
                      </Typography>
                      {[...new Set(m.sampleBadRows.map((r) => r.raw))].map((rawVal) => (
                        <Box key={rawVal} sx={{ display: "flex", gap: 1, mb: 0.5, alignItems: "center" }}>
                          <Typography
                            variant="caption"
                            sx={{ flex: 1, fontFamily: "monospace", color: "var(--theme-text-primary)" }}
                          >
                            {rawVal}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>→</Typography>
                          <TextField
                            size="small"
                            type="number"
                            value={choice.lookupTable[rawVal] ?? ""}
                            onChange={(e) =>
                              setMismatchChoices((prev) => ({
                                ...prev,
                                [m.csvHeader]: {
                                  ...choice,
                                  lookupTable: { ...choice.lookupTable, [rawVal]: e.target.value },
                                },
                              }))
                            }
                            sx={{ width: 80, ...fieldSx }}
                          />
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ color: "var(--theme-text-primary)" }}>Cancel</Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleMismatchNext}
            disabled={!mismatchValid}
          >
            Next
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // ── Stage: resolve-unmatched ──────────────────────────────────────────────

  if (stage.name === "resolve-unmatched") {
    const { unmatched } = stage;
    const pendingGroups = unmatched.filter((g) => unmatchedResolutions[g.csvName] === null);
    const resolvedCount = unmatched.length - pendingGroups.length;

    function resolveGroup(csvName: string, resolution: UnmatchedResolution) {
      setUnmatchedResolutions((prev) => ({ ...prev, [csvName]: resolution }));
    }

    function setAllUnmatched(resolution: UnmatchedResolution) {
      const next: Record<string, UnmatchedResolution | null> = {};
      for (const g of unmatched) next[g.csvName] = resolution;
      setUnmatchedResolutions(next);
    }

    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: paperSx }}>
        {renderTitle("Import Canyons — Unmatched Names")}
        <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, pt: 1 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
              <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
                {pendingGroups.length > 0
                  ? `${pendingGroups.length} of ${unmatched.length} remaining`
                  : `All ${unmatched.length} resolved`}
              </Typography>
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ color: "var(--theme-text-primary)", borderColor: "var(--theme-accent)" }}
                  onClick={() => setAllUnmatched({ kind: "create" })}
                  disabled={pendingGroups.length === 0}
                >
                  Create All
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ color: "var(--theme-text-muted)", borderColor: "rgba(255,255,255,0.2)" }}
                  onClick={() => setAllUnmatched({ kind: "discard" })}
                  disabled={pendingGroups.length === 0}
                >
                  Discard All
                </Button>
              </Box>
            </Box>

            {resolvedCount > 0 && pendingGroups.length > 0 && (
              <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", mb: 0.5 }}>
                {resolvedCount} resolved ✓
              </Typography>
            )}

            {pendingGroups.length === 0 && (
              <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", py: 2, textAlign: "center" }}>
                All canyons resolved. Click Next to continue.
              </Typography>
            )}

            {pendingGroups.map((group) => {
              const firstRow = group.rows[0];
              const { input } = firstRow;

              return (
                <Box key={group.csvName} sx={cardSx}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1 }}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{group.csvName}</Typography>
                      <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
                        {input.latitude?.toFixed(4)}, {input.longitude?.toFixed(4)}
                        {group.rows.length > 1 && ` · ${group.rows.length} rows`}
                      </Typography>
                    </Box>
                    <Box sx={{ display: "flex", gap: 0.5 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        color="secondary"
                        onClick={() => resolveGroup(group.csvName, { kind: "create" })}
                        sx={{ fontSize: "0.75em" }}
                      >
                        Create
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        onClick={() => resolveGroup(group.csvName, { kind: "discard" })}
                        sx={{ fontSize: "0.75em" }}
                      >
                        Discard
                      </Button>
                    </Box>
                  </Box>

                  <Autocomplete
                    size="small"
                    options={canyons}
                    getOptionLabel={(c) => c.name}
                    getOptionKey={(c) => c.id}
                    filterOptions={filterCanyonOptions}
                    clearOnBlur={false}
                    value={null}
                    onChange={(_, canyon) => {
                      if (canyon) {
                        resolveGroup(group.csvName, {
                          kind: "assign",
                          canyonId: canyon.id,
                          canyonName: canyon.name,
                        });
                      }
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Assign to existing canyon"
                        sx={fieldSx}
                      />
                    )}
                    PaperComponent={({ children }) => (
                      <Box sx={{ backgroundColor: "var(--theme-primary)", border: "1px solid var(--theme-accent)", borderRadius: 1 }}>
                        {children}
                      </Box>
                    )}
                  />
                </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ color: "var(--theme-text-primary)" }}>Cancel</Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleUnmatchedNext}
            disabled={!unmatchedValid}
          >
            Next
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // ── Stage: resolve-matched ────────────────────────────────────────────────

  if (stage.name === "resolve-matched") {
    const { matched } = stage;
    const mergeCount = matched.filter((r) => matchedActions[r.rowIndex] === "merge").length;

    function setAllMatchedAction(action: MatchedAction) {
      const next: Record<number, MatchedAction> = {};
      for (const r of matched) next[r.rowIndex] = action;
      setMatchedActions(next);
    }

    return (
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: paperSx }}>
        {renderTitle("Import Canyons — Matched Names")}
        <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, pt: 1 }}>
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", mb: 0.5 }}>
              {matched.length} canyon{matched.length !== 1 ? "s" : ""} matched existing records.
              Default action is Skip.
            </Typography>

            {/* Bulk actions row */}
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1, flexWrap: "wrap" }}>
              <Button size="small" variant="outlined"
                sx={{ color: "var(--theme-text-muted)", borderColor: "rgba(255,255,255,0.2)" }}
                onClick={() => setAllMatchedAction("skip")}>
                Skip All
              </Button>
              <Button size="small" variant="outlined"
                sx={{ color: "var(--theme-text-primary)", borderColor: "var(--theme-accent)" }}
                onClick={() => setAllMatchedAction("replace")}>
                Replace All
              </Button>
              <Button size="small" variant="outlined"
                sx={{ color: "var(--theme-text-primary)", borderColor: "var(--theme-accent)" }}
                onClick={() => setAllMatchedAction("merge")}>
                Merge All
              </Button>
              {mergeCount > 0 && (
                <>
                  <Divider orientation="vertical" flexItem sx={{ borderColor: "rgba(255,255,255,0.15)", mx: 0.5 }} />
                  <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
                    Merge conflict policy:
                  </Typography>
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={conflictPolicy}
                    onChange={(_, v) => { if (v) setConflictPolicy(v as ConflictPolicy); }}
                    sx={{
                      "& .MuiToggleButton-root": {
                        color: "var(--theme-text-muted)",
                        borderColor: "rgba(255,255,255,0.2)",
                        fontSize: "0.75em",
                        py: 0.3,
                        "&.Mui-selected": {
                          backgroundColor: "rgba(255,255,255,0.12)",
                          color: "var(--theme-text-primary)",
                        },
                      },
                    }}
                  >
                    <ToggleButton value="keepExisting">Keep existing</ToggleButton>
                    <ToggleButton value="useCsv">Use CSV</ToggleButton>
                  </ToggleButtonGroup>
                </>
              )}
            </Box>

            {matched.map((row) => {
              const action = matchedActions[row.rowIndex] ?? "skip";
              const rowPolicy = perRowPolicies[row.rowIndex] ?? conflictPolicy;

              return (
                <Box key={row.rowIndex} sx={cardSx}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 0.75 }}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.csvName}</Typography>
                      <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
                        Matched: {row.matchedCanyon.name}
                      </Typography>
                    </Box>
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={action}
                      onChange={(_, v) => {
                        if (v) setMatchedActions((prev) => ({ ...prev, [row.rowIndex]: v as MatchedAction }));
                      }}
                      sx={{
                        "& .MuiToggleButton-root": {
                          color: "var(--theme-text-muted)",
                          borderColor: "rgba(255,255,255,0.2)",
                          fontSize: "0.75em",
                          py: 0.3,
                          "&.Mui-selected": {
                            backgroundColor: "rgba(255,255,255,0.12)",
                            color: "var(--theme-text-primary)",
                          },
                        },
                      }}
                    >
                      <ToggleButton value="skip">Skip</ToggleButton>
                      <ToggleButton value="replace">Replace</ToggleButton>
                      <ToggleButton value="merge">Merge</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>

                  {/* Per-row merge policy override */}
                  {action === "merge" && (
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
                      <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
                        Policy:
                      </Typography>
                      <Chip
                        label={
                          row.rowIndex in perRowPolicies
                            ? (rowPolicy === "keepExisting" ? "Keep existing (override)" : "Use CSV (override)")
                            : (conflictPolicy === "keepExisting" ? "Keep existing (global)" : "Use CSV (global)")
                        }
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: "0.65em",
                          backgroundColor: row.rowIndex in perRowPolicies
                            ? "rgba(100,180,255,0.18)"
                            : "rgba(255,255,255,0.08)",
                          color: "var(--theme-text-primary)",
                          cursor: "pointer",
                        }}
                        onClick={() => {
                          // Toggle: if overridden, remove override; else set opposite of global
                          if (row.rowIndex in perRowPolicies) {
                            setPerRowPolicies((prev) => {
                              const next = { ...prev };
                              delete next[row.rowIndex];
                              return next;
                            });
                          } else {
                            const override: ConflictPolicy =
                              conflictPolicy === "keepExisting" ? "useCsv" : "keepExisting";
                            setPerRowPolicies((prev) => ({ ...prev, [row.rowIndex]: override }));
                          }
                        }}
                      />
                      {row.rowIndex in perRowPolicies && (
                        <Tooltip title="Click policy chip to remove override">
                          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
                            (click chip to reset to global)
                          </Typography>
                        </Tooltip>
                      )}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ color: "var(--theme-text-primary)" }}>Cancel</Button>
          <Button variant="contained" color="secondary" onClick={handleMatchedNext}>
            Next
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // ── Stage: confirm ────────────────────────────────────────────────────────

  if (stage.name === "confirm") {
    const { creates, replaces, discardCount, newAttrKeys } = stage;
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: paperSx }}>
        {renderTitle("Import Canyons — Confirm")}
        <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 1 }}>
            <SectionLabel text="Summary" />
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              <Typography variant="body2">
                <strong>{creates.length}</strong> new canyon{creates.length !== 1 ? "s" : ""} to create
              </Typography>
              <Typography variant="body2">
                <strong>{replaces.length}</strong> existing canyon{replaces.length !== 1 ? "s" : ""} to update (replace or merge)
              </Typography>
              {mergeOverrideCount > 0 && (
                <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
                  · {mergeOverrideCount} row{mergeOverrideCount !== 1 ? "s" : ""} use per-row policy override
                </Typography>
              )}
              <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
                <strong>{discardCount}</strong> row{discardCount !== 1 ? "s" : ""} discarded / skipped
              </Typography>
            </Box>
            {newAttrKeys.length > 0 && (
              <Box>
                <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", display: "block", mb: 0.5 }}>
                  New attribute keys being created:
                </Typography>
                <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                  {newAttrKeys.map((k) => (
                    <Chip
                      key={k}
                      label={k}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: "0.7em",
                        backgroundColor: "rgba(255,255,255,0.08)",
                        color: "var(--theme-text-primary)",
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}
            {creates.length === 0 && replaces.length === 0 && (
              <Typography variant="body2" color="warning.main">
                Nothing to import — all rows were skipped or discarded.
              </Typography>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ color: "var(--theme-text-primary)" }}>Cancel</Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleImport}
            disabled={creates.length === 0 && replaces.length === 0}
          >
            Import
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // ── Stage: importing ──────────────────────────────────────────────────────

  if (stage.name === "importing") {
    return (
      <Dialog open={open} maxWidth="sm" fullWidth PaperProps={{ sx: paperSx }}>
        {renderTitle("Import Canyons")}
        <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 4, gap: 2 }}>
            <CircularProgress size={24} />
            <Typography variant="body2">Importing…</Typography>
          </Box>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Stage: result ─────────────────────────────────────────────────────────

  if (stage.name === "result") {
    const { created, replaced, errors } = stage;
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: paperSx }}>
        {renderTitle("Import Complete")}
        <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 1 }}>
            <Typography variant="body2">
              <strong>{created}</strong> canyon{created !== 1 ? "s" : ""} created,{" "}
              <strong>{replaced}</strong> updated.
            </Typography>
            {errors.length > 0 && (
              <Box>
                <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", display: "block", mb: 0.5 }}>
                  {errors.length} error{errors.length !== 1 ? "s" : ""}:
                </Typography>
                {errors.map((e, i) => (
                  <Typography key={i} variant="caption" sx={{ color: "var(--theme-warning)", display: "block" }}>
                    {e.message}
                  </Typography>
                ))}
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" color="secondary" onClick={onClose}>Done</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return null;
}

export default CanyonCsvImportDialog;
