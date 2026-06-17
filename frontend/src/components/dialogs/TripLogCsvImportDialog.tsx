import { useState, useEffect, useRef, useMemo } from "react";
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
  Autocomplete,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import type { TripLogCustomFieldDef, TripLogCustomFieldType } from "@logjam/shared";
import { CUSTOM_FIELD_TYPES, makeCustomFieldKey, coerceFieldValue } from "@logjam/shared";
import type { TCanyon, TTripLog } from "../../canyonUtils";
import {
  createCanyon,
  updateUserPreferences,
  bulkCreateTripLogs,
} from "../../canyonUtils";
import { parseCsv } from "../../csvImport/parseCsv";
import { detectColumns } from "../../csvImport/detectColumns";
import { detectDateFormat, toIsoDate, DATE_FORMAT_LABELS } from "../../csvImport/detectDateFormat";
import type { DateFormat } from "../../csvImport/detectDateFormat";
import { matchCanyonByName } from "../../csvImport/matchCanyon";
import { fieldSx, selectSx, menuPaperProps, SectionLabel } from "../../csvImport/dialogStyles";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";

// ── Types ─────────────────────────────────────────────────────────────────────

type ColumnRole = string; // "name" | "date" | "notes" | "cf:<key>" | "new-cf" | "appendNotes" | "discard"

type NewCfForm = { label: string; type: TripLogCustomFieldType };

type PreparedRow = {
  rowIndex: number;
  csvCanyonName: string;
  canyonId: string | null;
  date: string;
  notes: string | null;
  customFields: Record<string, unknown>;
};

type UnmappedGroup = {
  csvName: string;
  rowIndices: number[];
};

type CanyonResolution =
  | { kind: "discard" }
  | { kind: "assign"; canyonId: string; canyonName: string }
  | { kind: "create" };

type CreateForm = { name: string; latitude: string; longitude: string };

type DupEntry = {
  rowIndex: number;
  canyonName: string;
  date: string;
};

type Stage =
  | { name: "select-file" }
  | {
      name: "mapping";
      headers: string[];
      rows: Record<string, string>[];
      dateSample: string;
      detectedFormat: DateFormat;
      formatAmbiguous: boolean;
    }
  | {
      name: "resolve-canyons";
      prepared: PreparedRow[];
      groups: UnmappedGroup[];
    }
  | {
      name: "resolve-duplicates";
      prepared: PreparedRow[];
      groups: UnmappedGroup[];
      dups: DupEntry[];
    }
  | {
      name: "confirm";
      importRows: PreparedRow[];
      newCanyons: NewCanyonSpec[];
      newFieldDefs: TripLogCustomFieldDef[];
      skipCount: number;
      discardCount: number;
    }
  | { name: "importing" }
  | { name: "result"; imported: number; errors: string[] };

type NewCanyonSpec = {
  csvName: string;
  name: string;
  latitude: number;
  longitude: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
// fieldSx, selectSx, menuPaperProps, SectionLabel imported from csvImport/dialogStyles

// ── Component ─────────────────────────────────────────────────────────────────

function TripLogCsvImportDialog({
  open,
  onClose,
  canyons,
  tripLogs,
  customFieldDefs,
  onCustomFieldDefsChange,
  onRefetchTripLogs,
  onRefetchAnalytics,
  onPickCoords,
}: {
  open: boolean;
  onClose: () => void;
  canyons: TCanyon[];
  tripLogs: TTripLog[];
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
  onRefetchTripLogs: () => void;
  onRefetchAnalytics: () => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
}) {
  const isMobile = useIsMobile();
  const [stage, setStage] = useState<Stage>({ name: "select-file" });
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mapping stage mutable state
  const [assignments, setAssignments] = useState<Record<string, ColumnRole>>({});
  const [newCfForms, setNewCfForms] = useState<Record<string, NewCfForm>>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>("DD/MM/YYYY");

  // Resolve-canyons stage mutable state
  const [canyonResolutions, setCanyonResolutions] = useState<Record<string, CanyonResolution | null>>({});
  const [createForms, setCreateForms] = useState<Record<string, CreateForm>>({});

  // Resolve-duplicates stage mutable state
  const [dupChoices, setDupChoices] = useState<Record<number, "skip" | "import">>({});

  const pickingRef = useRef(false);
  const pickingForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (pickingRef.current) {
      pickingRef.current = false;
      return;
    }
    setStage({ name: "select-file" });
    setParseError(null);
    setAssignments({});
    setNewCfForms({});
    setDateFormat("DD/MM/YYYY");
    setCanyonResolutions({});
    setCreateForms({});
    setDupChoices({});
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
    if (dropped) handleFileSelected(dropped);
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
      const detected = detectColumns(parsed.headers, customFieldDefs);
      setAssignments(detected);

      // Pre-populate new-cf forms with header as label
      const forms: Record<string, NewCfForm> = {};
      for (const h of parsed.headers) {
        if (detected[h] === "new-cf") forms[h] = { label: h, type: "string" };
      }
      setNewCfForms(forms);

      // Detect date format from date column sample values
      const dateCol = parsed.headers.find((h) => detected[h] === "date");
      const samples = dateCol
        ? parsed.rows.map((r) => r[dateCol] ?? "").filter(Boolean).slice(0, 10)
        : [];
      const { format, ambiguous } = detectDateFormat(samples);
      setDateFormat(format);
      const dateSample = samples[0] ?? "";

      setStage({
        name: "mapping",
        headers: parsed.headers,
        rows: parsed.rows,
        dateSample,
        detectedFormat: format,
        formatAmbiguous: ambiguous,
      });
    } catch (err) {
      console.error(err);
      setParseError(messageFromError(err, "Couldn't read the CSV file. Please check the file and try again."));
    }
  }

  // ── Mapping → Resolve canyons ──────────────────────────────────────────────

  function handleMappingNext() {
    if (stage.name !== "mapping") return;
    const { headers, rows } = stage;

    const nameCol = headers.find((h) => assignments[h] === "name");
    const dateCol = headers.find((h) => assignments[h] === "date");
    if (!nameCol || !dateCol) return;

    // Collect notes columns (could be one "notes" + multiple "appendNotes")
    const notesCol = headers.find((h) => assignments[h] === "notes");
    const appendCols = headers.filter((h) => assignments[h] === "appendNotes");

    // Collect custom field columns
    const cfCols: { header: string; key: string; type: TripLogCustomFieldType }[] = [];
    for (const h of headers) {
      const role = assignments[h];
      if (typeof role === "string" && role.startsWith("cf:")) {
        const key = role.slice(3);
        const def = customFieldDefs.find((d) => d.key === key);
        if (def) cfCols.push({ header: h, key: def.key, type: def.type });
      } else if (role === "new-cf") {
        const form = newCfForms[h];
        if (form?.label.trim()) {
          const key = makeCustomFieldKey(form.label);
          cfCols.push({ header: h, key, type: form.type });
        }
      }
    }

    // Build PreparedRow[]
    const prepared: PreparedRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const csvCanyonName = row[nameCol] ?? "";
      if (!csvCanyonName) continue;

      const rawDate = row[dateCol] ?? "";
      const isoDate = toIsoDate(rawDate, dateFormat);
      if (!isoDate) continue;

      let notes: string | null = notesCol ? row[notesCol] || null : null;
      for (const col of appendCols) {
        const v = row[col]?.trim();
        if (v) notes = notes ? `${notes}\n\n${col}: ${v}` : `${col}: ${v}`;
      }

      const customFields: Record<string, unknown> = {};
      for (const cf of cfCols) {
        customFields[cf.key] = coerceFieldValue(row[cf.header] ?? "", cf.type);
      }

      // Try to match canyon
      const match = matchCanyonByName(csvCanyonName, canyons);
      const canyonId = match.kind === "match" ? match.canyon.id : null;

      prepared.push({ rowIndex: i, csvCanyonName, canyonId, date: isoDate, notes, customFields });
    }

    // Find unique unmapped names
    const unmappedMap: Record<string, number[]> = {};
    for (const row of prepared) {
      if (row.canyonId === null) {
        const key = row.csvCanyonName.toLowerCase();
        if (!unmappedMap[key]) unmappedMap[key] = [];
        unmappedMap[key].push(row.rowIndex);
      }
    }
    const groups: UnmappedGroup[] = Object.entries(unmappedMap).map(([, rowIndices]) => ({
      csvName: prepared.find((r) => rowIndices.includes(r.rowIndex))!.csvCanyonName,
      rowIndices,
    }));

    // Init resolutions
    const resolutions: Record<string, CanyonResolution | null> = {};
    for (const g of groups) resolutions[g.csvName.toLowerCase()] = null;
    setCanyonResolutions(resolutions);

    const initForms: Record<string, CreateForm> = {};
    for (const g of groups) initForms[g.csvName.toLowerCase()] = { name: g.csvName, latitude: "", longitude: "" };
    setCreateForms(initForms);

    if (groups.length === 0) {
      // Skip canyon resolution, go to duplicates
      advanceToDups(prepared, groups);
    } else {
      setStage({ name: "resolve-canyons", prepared, groups });
    }
  }

  // ── Resolve canyons → Resolve duplicates ──────────────────────────────────

  function advanceToDups(prepared: PreparedRow[], groups: UnmappedGroup[]) {
    // Apply resolutions to prepared rows
    const resolved = prepared.map((row) => {
      if (row.canyonId !== null) return row;
      const key = row.csvCanyonName.toLowerCase();
      const res = canyonResolutions[key];
      if (!res) return { ...row };
      if (res.kind === "discard") return { ...row, canyonId: "DISCARD" };
      if (res.kind === "assign") return { ...row, canyonId: res.canyonId };
      if (res.kind === "create") return { ...row, canyonId: `NEW:${key}` };
      return row;
    });

    // Existing trip log lookup for dup detection: only for rows with known canyonIds
    const tripLogSet = new Set(tripLogs.map((t) => `${t.canyonId}::${t.date.split("T")[0]}`));
    const dups: DupEntry[] = [];
    for (const row of resolved) {
      if (!row.canyonId || row.canyonId === "DISCARD" || row.canyonId.startsWith("NEW:")) continue;
      if (tripLogSet.has(`${row.canyonId}::${row.date}`)) {
        const canyon = canyons.find((c) => c.id === row.canyonId);
        dups.push({ rowIndex: row.rowIndex, canyonName: canyon?.name ?? row.csvCanyonName, date: row.date });
      }
    }

    // Default all dups to "skip"
    const choices: Record<number, "skip" | "import"> = {};
    for (const d of dups) choices[d.rowIndex] = "skip";
    setDupChoices(choices);

    if (dups.length === 0) {
      advanceToConfirm(resolved, groups);
    } else {
      setStage({ name: "resolve-duplicates", prepared: resolved, groups, dups });
    }
  }

  function handleCanyonsNext() {
    if (stage.name !== "resolve-canyons") return;
    const allResolved = stage.groups.every((g) => canyonResolutions[g.csvName.toLowerCase()] !== null);
    const createFormsValid = stage.groups.every((g) => {
      const res = canyonResolutions[g.csvName.toLowerCase()];
      if (res?.kind !== "create") return true;
      const f = createForms[g.csvName.toLowerCase()];
      return f && f.latitude.trim() && f.longitude.trim() && !isNaN(parseFloat(f.latitude)) && !isNaN(parseFloat(f.longitude));
    });
    if (!allResolved || !createFormsValid) return;
    advanceToDups(stage.prepared, stage.groups);
  }

  // ── Resolve duplicates → Confirm ──────────────────────────────────────────

  function advanceToConfirm(resolved: PreparedRow[], groups: UnmappedGroup[]) {
    const discardCount = resolved.filter((r) => r.canyonId === "DISCARD").length;
    const skipCount = resolved.filter((r) => {
      if (!r.canyonId || r.canyonId === "DISCARD" || r.canyonId.startsWith("NEW:")) return false;
      return dupChoices[r.rowIndex] === "skip";
    }).length;

    const importRows = resolved.filter((r) => {
      if (!r.canyonId || r.canyonId === "DISCARD") return false;
      return dupChoices[r.rowIndex] !== "skip";
    });

    // Collect new canyon specs
    const newCanyonsMap: Record<string, NewCanyonSpec> = {};
    for (const g of groups) {
      const key = g.csvName.toLowerCase();
      const res = canyonResolutions[key];
      if (res?.kind === "create") {
        const f = createForms[key];
        if (f) {
          newCanyonsMap[key] = {
            csvName: g.csvName,
            name: f.name.trim(),
            latitude: parseFloat(f.latitude),
            longitude: parseFloat(f.longitude),
          };
        }
      }
    }
    const newCanyons = Object.values(newCanyonsMap);

    // Collect new field defs queued from "new-cf" assignments
    const newFieldDefs: TripLogCustomFieldDef[] = [];
    if (stage.name === "mapping" || stage.name === "resolve-canyons" || stage.name === "resolve-duplicates") {
      // stage is now resolve-canyons or resolve-duplicates; we need the mapping stage headers
      // newCfForms was captured at mapping time
      for (const [header, form] of Object.entries(newCfForms)) {
        if (assignments[header] === "new-cf" && form.label.trim()) {
          const key = makeCustomFieldKey(form.label);
          if (!customFieldDefs.some((d) => d.key === key)) {
            newFieldDefs.push({ key, label: form.label.trim(), type: form.type });
          }
        }
      }
    }

    setStage({ name: "confirm", importRows, newCanyons, newFieldDefs, skipCount, discardCount });
  }

  function handleDupsNext() {
    if (stage.name !== "resolve-duplicates") return;
    advanceToConfirm(stage.prepared, stage.groups);
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  async function handleImport() {
    if (stage.name !== "confirm") return;
    const { importRows, newCanyons, newFieldDefs } = stage;

    setStage({ name: "importing" });

    const errors: string[] = [];
    try {
      // 1. Persist new custom field defs
      if (newFieldDefs.length > 0) {
        const merged = [...customFieldDefs, ...newFieldDefs];
        await updateUserPreferences({ tripLogCustomFields: merged });
        onCustomFieldDefsChange(merged);
      }

      // 2. Create new canyons and map csvName → id
      const newCanyonIds: Record<string, string> = {};
      for (const spec of newCanyons) {
        try {
          const created = await createCanyon({ name: spec.name, latitude: spec.latitude, longitude: spec.longitude });
          newCanyonIds[spec.csvName.toLowerCase()] = created.id;
        } catch {
          errors.push(`Failed to create canyon "${spec.name}"`);
        }
      }

      // 3. Resolve NEW: canyonIds and build final trips array
      const trips = importRows
        .map((row) => {
          let canyonId = row.canyonId!;
          if (canyonId.startsWith("NEW:")) {
            const key = canyonId.slice(4);
            canyonId = newCanyonIds[key] ?? "";
          }
          return { canyonId, date: row.date, notes: row.notes, customFields: row.customFields };
        })
        .filter((t) => t.canyonId);

      // 4. Bulk insert
      let imported = 0;
      if (trips.length > 0) {
        const result = await bulkCreateTripLogs(trips);
        imported = result.imported;
        for (const e of result.errors) {
          errors.push(`Row ${e.index + 1}: ${e.error}`);
        }
      }

      setStage({ name: "result", imported, errors });
    } catch (err) {
      console.error(err);
      errors.push(messageFromError(err, "Import failed. Please try again."));
      setStage({ name: "result", imported: 0, errors });
    }
  }

  function handleClose() {
    if (stage.name === "importing") return;
    if (stage.name === "result") {
      onRefetchTripLogs();
      onRefetchAnalytics();
    }
    onClose();
  }

  // ── Map coord picking ──────────────────────────────────────────────────────

  function handlePickCoords(csvName: string) {
    pickingRef.current = true;
    pickingForRef.current = csvName;
    onPickCoords((lat, lng) => {
      const key = csvName.toLowerCase();
      setCreateForms((prev) => ({
        ...prev,
        [key]: { ...prev[key], latitude: String(lat.toFixed(6)), longitude: String(lng.toFixed(6)) },
      }));
      pickingForRef.current = null;
    });
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const isImporting = stage.name === "importing";
  const dialogTitle = {
    "select-file": "Import Trip Logs from CSV",
    mapping: "Map Columns",
    "resolve-canyons": "Resolve Canyon Names",
    "resolve-duplicates": "Resolve Duplicates",
    confirm: "Confirm Import",
    importing: "Importing…",
    result: "Import Complete",
  }[stage.name];

  // Mapping stage: validation
  const mappingValid = useMemo(() => {
    if (stage.name !== "mapping") return false;
    const { headers } = stage;
    const hasName = headers.some((h) => assignments[h] === "name");
    const hasDate = headers.some((h) => assignments[h] === "date");
    const newCfValid = headers.every((h) => {
      if (assignments[h] !== "new-cf") return true;
      return newCfForms[h]?.label.trim() !== "";
    });
    return hasName && hasDate && newCfValid;
  }, [stage, assignments, newCfForms]);

  // Resolve-canyons: validation — discarded groups count as resolved
  const canyonsValid = useMemo(() => {
    if (stage.name !== "resolve-canyons") return false;
    return stage.groups.every((g) => {
      const key = g.csvName.toLowerCase();
      const res = canyonResolutions[key];
      if (!res) return false;
      if (res.kind === "discard" || res.kind === "assign") return true;
      if (res.kind === "create") {
        const f = createForms[key];
        return (
          f &&
          f.latitude.trim() &&
          f.longitude.trim() &&
          !isNaN(parseFloat(f.latitude)) &&
          !isNaN(parseFloat(f.longitude))
        );
      }
      return false;
    });
  }, [stage, canyonResolutions, createForms]);

  // ── Render ─────────────────────────────────────────────────────────────────

  function renderContent() {
    // ── Select file ──
    if (stage.name === "select-file") {
      return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
            Upload a CSV file with your trip history. The importer will detect columns for canyon name,
            date, notes, and custom fields.
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
      );
    }

    // ── Mapping ──
    if (stage.name === "mapping") {
      const { headers, rows, dateSample, formatAmbiguous } = stage;
      const dateCol = headers.find((h) => assignments[h] === "date");

      return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {<SectionLabel text="Column Assignments" />}
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
            Exactly one column must be assigned Canyon Name and one to Date.
          </Typography>
          {headers.map((header) => {
            const sample = rows[0]?.[header] ?? "";
            const role = assignments[header] ?? "discard";
            const isNewCf = role === "new-cf";
            const form = newCfForms[header] ?? { label: header, type: "string" as TripLogCustomFieldType };

            return (
              <Box key={header} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.85em", color: "var(--theme-text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {header}
                    </Typography>
                    {sample && (
                      <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", fontSize: "0.75em" }}>
                        e.g. {sample}
                      </Typography>
                    )}
                  </Box>
                  <FormControl size="small" sx={{ minWidth: 200 }}>
                    <Select
                      value={role}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAssignments((prev) => ({ ...prev, [header]: val }));
                        if (val === "new-cf" && !newCfForms[header]) {
                          setNewCfForms((prev) => ({ ...prev, [header]: { label: header, type: "string" } }));
                        }
                      }}
                      sx={selectSx}
                      MenuProps={menuPaperProps}
                    >
                      <MenuItem value="name">Canyon Name</MenuItem>
                      <MenuItem value="date">Date</MenuItem>
                      <MenuItem value="notes">Notes</MenuItem>
                      <MenuItem disabled>
                        <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>— Custom Fields —</Typography>
                      </MenuItem>
                      {customFieldDefs.map((d) => (
                        <MenuItem key={d.key} value={`cf:${d.key}`}>Field: {d.label}</MenuItem>
                      ))}
                      <MenuItem value="new-cf">Create new custom field…</MenuItem>
                      <MenuItem disabled>
                        <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>— Other —</Typography>
                      </MenuItem>
                      <MenuItem value="appendNotes">Append to Notes</MenuItem>
                      <MenuItem value="discard">Discard</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
                {isNewCf && (
                  <Box sx={{ ml: 2, display: "flex", gap: 1.5, alignItems: "center", pl: 1, borderLeft: "2px solid var(--theme-accent)" }}>
                    <TextField
                      label="Field Label"
                      value={form.label}
                      onChange={(e) => setNewCfForms((prev) => ({ ...prev, [header]: { ...form, label: e.target.value } }))}
                      size="small"
                      sx={fieldSx}
                    />
                    <FormControl size="small" sx={{ minWidth: 120 }}>
                      <InputLabel sx={{ color: "var(--theme-text-muted)", fontSize: "0.85em" }}>Type</InputLabel>
                      <Select
                        label="Type"
                        value={form.type}
                        onChange={(e) => setNewCfForms((prev) => ({ ...prev, [header]: { ...form, type: e.target.value as TripLogCustomFieldType } }))}
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

          {dateCol && (
            <>
              <Divider sx={{ borderColor: "rgba(255,255,255,0.1)", my: 0.5 }} />
              {<SectionLabel text="Date Format" />}
              {formatAmbiguous && (
                <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
                  Ambiguous format detected — please confirm.
                </Typography>
              )}
              <Box sx={{ display: "flex", gap: 1.5, alignItems: "center" }}>
                {dateSample && (
                  <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", fontSize: "0.85em", flexShrink: 0 }}>
                    Sample: <code>{dateSample}</code>
                  </Typography>
                )}
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
              </Box>
            </>
          )}
        </Box>
      );
    }

    // ── Resolve canyons ──
    if (stage.name === "resolve-canyons") {
      const { groups } = stage;
      const visibleGroups = groups.filter(
        (g) => canyonResolutions[g.csvName.toLowerCase()]?.kind !== "discard",
      );

      return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
            {visibleGroups.length} canyon name{visibleGroups.length !== 1 ? "s" : ""} could not be matched to your collection.
          </Typography>
          {visibleGroups.length > 1 && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                const updates: Record<string, CanyonResolution> = {};
                for (const g of groups) updates[g.csvName.toLowerCase()] = { kind: "discard" };
                setCanyonResolutions((prev) => ({ ...prev, ...updates }));
              }}
              sx={{ borderColor: "var(--theme-accent)", color: "var(--theme-accent)", fontSize: "0.8em", alignSelf: "flex-start" }}
            >
              Discard All
            </Button>
          )}
          {visibleGroups.map((g) => {
            const key = g.csvName.toLowerCase();
            const res = canyonResolutions[key] ?? null;
            const form = createForms[key] ?? { name: g.csvName, latitude: "", longitude: "" };
            const isCreateMode = res?.kind === "create";

            return (
              <Box
                key={key}
                sx={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "var(--radius-sm)",
                  p: 1.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.5,
                }}
              >
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: "var(--theme-text-primary)" }}>
                    {g.csvName}
                  </Typography>
                  <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
                    {g.rowIndices.length} row{g.rowIndices.length !== 1 ? "s" : ""}
                  </Typography>
                </Box>

                {isCreateMode ? (
                  <>
                    {/* Inline create form */}
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, pl: 1, borderLeft: "2px solid var(--theme-accent)" }}>
                      <TextField
                        label="Canyon Name"
                        value={form.name}
                        onChange={(e) => setCreateForms((prev) => ({ ...prev, [key]: { ...form, name: e.target.value } }))}
                        size="small"
                        fullWidth
                        sx={fieldSx}
                      />
                      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                        <TextField
                          label="Latitude"
                          value={form.latitude}
                          onChange={(e) => setCreateForms((prev) => ({ ...prev, [key]: { ...form, latitude: e.target.value } }))}
                          size="small"
                          sx={{ ...fieldSx, flex: 1 }}
                          placeholder="-33.123456"
                        />
                        <TextField
                          label="Longitude"
                          value={form.longitude}
                          onChange={(e) => setCreateForms((prev) => ({ ...prev, [key]: { ...form, longitude: e.target.value } }))}
                          size="small"
                          sx={{ ...fieldSx, flex: 1 }}
                          placeholder="150.123456"
                        />
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handlePickCoords(g.csvName)}
                          sx={{ borderColor: "var(--theme-accent)", color: "var(--theme-accent)", flexShrink: 0, fontSize: "0.75em" }}
                        >
                          Pick on map
                        </Button>
                      </Box>
                    </Box>
                    <Button
                      size="small"
                      onClick={() => setCanyonResolutions((prev) => ({ ...prev, [key]: null }))}
                      sx={{ color: "var(--theme-text-muted)", alignSelf: "flex-start", textTransform: "none", fontSize: "0.8em" }}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    {/* Assign to existing via autocomplete */}
                    <Autocomplete
                      options={canyons}
                      getOptionLabel={(c) => c.name}
                      size="small"
                      value={res?.kind === "assign" ? canyons.find((c) => c.id === res.canyonId) ?? null : null}
                      onChange={(_, c) => {
                        setCanyonResolutions((prev) => ({
                          ...prev,
                          [key]: c ? { kind: "assign", canyonId: c.id, canyonName: c.name } : null,
                        }));
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Assign to existing canyon…"
                          size="small"
                          sx={fieldSx}
                        />
                      )}
                      PaperComponent={({ children }) => (
                        <Box sx={{ backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)", border: "1px solid rgba(255,255,255,0.1)" }}>
                          {children}
                        </Box>
                      )}
                      sx={{ "& .MuiInputBase-input": { color: "var(--theme-text-primary)" } }}
                    />
                    {/* Action buttons */}
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setCanyonResolutions((prev) => ({ ...prev, [key]: { kind: "create" } }))}
                        sx={{ borderColor: "var(--theme-accent)", color: "var(--theme-accent)", fontSize: "0.8em" }}
                      >
                        Create new canyon
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setCanyonResolutions((prev) => ({ ...prev, [key]: { kind: "discard" } }))}
                        sx={{ borderColor: "rgba(255,255,255,0.3)", color: "var(--theme-text-muted)", fontSize: "0.8em" }}
                      >
                        Discard
                      </Button>
                    </Box>
                  </>
                )}
              </Box>
            );
          })}
        </Box>
      );
    }

    // ── Resolve duplicates ──
    if (stage.name === "resolve-duplicates") {
      const { dups } = stage;
      const allSkipped = dups.every((d) => dupChoices[d.rowIndex] === "skip");
      const allImported = dups.every((d) => dupChoices[d.rowIndex] === "import");

      return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
            {dups.length} row{dups.length !== 1 ? "s" : ""} match existing trip log{dups.length !== 1 ? "s" : ""} (same canyon and date). Choose what to do with each.
          </Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              disabled={allSkipped}
              onClick={() => {
                const updates: Record<number, "skip"> = {};
                for (const d of dups) updates[d.rowIndex] = "skip";
                setDupChoices((prev) => ({ ...prev, ...updates }));
              }}
              sx={{ borderColor: "var(--theme-accent)", color: "var(--theme-accent)", fontSize: "0.8em" }}
            >
              Skip All
            </Button>
            <Button
              size="small"
              variant="outlined"
              disabled={allImported}
              onClick={() => {
                const updates: Record<number, "import"> = {};
                for (const d of dups) updates[d.rowIndex] = "import";
                setDupChoices((prev) => ({ ...prev, ...updates }));
              }}
              sx={{ borderColor: "var(--theme-accent)", color: "var(--theme-accent)", fontSize: "0.8em" }}
            >
              Import All
            </Button>
          </Box>
          {dups.map((d) => (
            <Box
              key={d.rowIndex}
              sx={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "var(--radius-sm)",
                p: 1.5,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 2,
              }}
            >
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600, color: "var(--theme-text-primary)", fontSize: "0.85em" }}>
                  {d.canyonName}
                </Typography>
                <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
                  {new Date(d.date).toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" })}
                </Typography>
              </Box>
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <Select
                  value={dupChoices[d.rowIndex] ?? "skip"}
                  onChange={(e) =>
                    setDupChoices((prev) => ({ ...prev, [d.rowIndex]: e.target.value as "skip" | "import" }))
                  }
                  sx={selectSx}
                  MenuProps={menuPaperProps}
                >
                  <MenuItem value="skip">Skip</MenuItem>
                  <MenuItem value="import">Import anyway</MenuItem>
                </Select>
              </FormControl>
            </Box>
          ))}
        </Box>
      );
    }

    // ── Confirm ──
    if (stage.name === "confirm") {
      const { importRows, newCanyons, newFieldDefs, skipCount, discardCount } = stage;
      return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {<SectionLabel text="Summary" />}
          <Typography variant="body2" sx={{ color: "var(--theme-text-primary)" }}>
            {importRows.length} trip log{importRows.length !== 1 ? "s" : ""} will be imported
          </Typography>
          {newCanyons.length > 0 && (
            <Typography variant="body2" sx={{ color: "var(--theme-text-primary)" }}>
              {newCanyons.length} new canyon{newCanyons.length !== 1 ? "s" : ""} will be created: {newCanyons.map((c) => c.name).join(", ")}
            </Typography>
          )}
          {skipCount > 0 && (
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
              {skipCount} duplicate{skipCount !== 1 ? "s" : ""} will be skipped
            </Typography>
          )}
          {discardCount > 0 && (
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
              {discardCount} row{discardCount !== 1 ? "s" : ""} discarded (unmatched canyon)
            </Typography>
          )}
          {newFieldDefs.length > 0 && (
            <>
              <Divider sx={{ borderColor: "rgba(255,255,255,0.1)" }} />
              <Typography variant="body2" sx={{ color: "var(--theme-text-primary)" }}>
                New custom fields: {newFieldDefs.map((f) => f.label).join(", ")}
              </Typography>
            </>
          )}
        </Box>
      );
    }

    // ── Importing ──
    if (stage.name === "importing") {
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 1 }}>
          <CircularProgress size={24} />
          <Typography>Importing trip logs…</Typography>
        </Box>
      );
    }

    // ── Result ──
    if (stage.name === "result") {
      const { imported, errors } = stage;
      return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography variant="body2" sx={{ color: "var(--theme-text-primary)" }}>
            Imported {imported} trip log{imported !== 1 ? "s" : ""}.
          </Typography>
          {errors.length > 0 && (
            <>
              <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
                {errors.length} error{errors.length !== 1 ? "s" : ""}:
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                {errors.map((e, i) => (
                  <Typography key={i} variant="caption" sx={{ color: "var(--theme-warning)" }}>{e}</Typography>
                ))}
              </Box>
            </>
          )}
        </Box>
      );
    }

    return null;
  }

  function renderActions() {
    if (stage.name === "select-file") {
      return <Button onClick={handleClose} sx={{ color: "var(--theme-text-primary)" }}>Cancel</Button>;
    }
    if (stage.name === "mapping") {
      return (
        <>
          <Button onClick={() => setStage({ name: "select-file" })} sx={{ color: "var(--theme-text-primary)" }}>Back</Button>
          <Button variant="contained" color="secondary" onClick={handleMappingNext} disabled={!mappingValid}>
            Next
          </Button>
        </>
      );
    }
    if (stage.name === "resolve-canyons") {
      return (
        <>
          <Button onClick={handleClose} sx={{ color: "var(--theme-text-primary)" }}>Cancel</Button>
          <Button variant="contained" color="secondary" onClick={handleCanyonsNext} disabled={!canyonsValid}>
            Next
          </Button>
        </>
      );
    }
    if (stage.name === "resolve-duplicates") {
      return (
        <>
          <Button onClick={handleClose} sx={{ color: "var(--theme-text-primary)" }}>Cancel</Button>
          <Button variant="contained" color="secondary" onClick={handleDupsNext}>
            Next
          </Button>
        </>
      );
    }
    if (stage.name === "confirm") {
      return (
        <>
          <Button onClick={handleClose} sx={{ color: "var(--theme-text-primary)" }}>Cancel</Button>
          <Button variant="contained" color="secondary" onClick={handleImport} disabled={(stage as { importRows: PreparedRow[] }).importRows.length === 0}>
            Import
          </Button>
        </>
      );
    }
    if (stage.name === "result") {
      return (
        <Button variant="contained" color="secondary" onClick={handleClose}>
          Close
        </Button>
      );
    }
    return null;
  }

  return (
    <Dialog
      fullScreen={isMobile}
      open={open}
      onClose={isImporting ? undefined : handleClose}
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
        {dialogTitle}
        <IconButton
          aria-label="Close dialog"
          size="small"
          onClick={handleClose}
          disabled={isImporting}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {renderContent()}
      </DialogContent>
      <DialogActions>{renderActions()}</DialogActions>
    </Dialog>
  );
}

export default TripLogCsvImportDialog;
