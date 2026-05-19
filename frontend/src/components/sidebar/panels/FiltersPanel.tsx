import { useState } from "react";
import { Slider, TextField, Select, MenuItem } from "@mui/material";
import { Search } from "lucide-react";
import classes from "./FiltersPanel.module.css";
import type { TFilters } from "../../../canyonUtils";

function FiltersPanel({
  filters,
  onChangeFilters,
}: {
  filters: TFilters;
  onChangeFilters: (filters: TFilters) => void;
}) {
  const [filterInputs, setFilterInputs] = useState({
    name: filters.name || "",
    v_grade: filters.v_grade || [1, 7],
    a_grade: filters.a_grade || [1, 7],
    commitment: filters.commitment || [1, 6],
    quality: filters.quality || [1, 5],
    pitches: filters.pitches || ["Any", 0],
    longest_pitch: filters.longest_pitch || ["Any", 0],
    hours: filters.hours || ["Any", 0],
    wetsuits: filters.wetsuits || [1, 5],
  });

  function sliderCell(
    name: keyof TFilters,
    displayName: string,
    range: [number, number] = [1, 7],
    step: number = 1,
  ) {
    const value =
      Array.isArray(filterInputs[name]) &&
      typeof filterInputs[name][0] === "number"
        ? (filterInputs[name] as number[])
        : range;

    return (
      <div className={classes.sliderCell} key={name}>
        <div className={classes.sliderLabel}>
          <span className={classes.sliderLabelText}>{displayName}</span>
          <span className={classes.sliderValue}>
            {value[0]}–{value[1]}
          </span>
        </div>
        <Slider
          id={name}
          color="secondary"
          marks={step === 1}
          step={step}
          min={range[0]}
          max={range[1]}
          value={value}
          valueLabelDisplay="auto"
          onChange={(_e, v) => {
            if (Array.isArray(v) && v.length === 2) {
              setFilterInputs({ ...filterInputs, [name]: v });
            }
          }}
        />
      </div>
    );
  }

  function selectCell(name: keyof TFilters, displayName: string) {
    return (
      <div className={classes.selectCell} key={name}>
        <div className={classes.selectLabel}>{displayName}</div>
        <div className={classes.selectContainer}>
          <Select
            id={`${name}Operator`}
            className={classes.select}
            color="secondary"
            size="small"
            value={filterInputs[name][0] ?? "Any"}
            onChange={(e) => {
              setFilterInputs({
                ...filterInputs,
                [name]: [e.target.value, filterInputs[name][1] || 0],
              });
            }}
            MenuProps={{
              PaperProps: {
                sx: {
                  backgroundColor: "var(--theme-primary)",
                  boxShadow: "0 8px 16px rgba(0, 0, 0, 0.3)",
                },
              },
            }}
          >
            <MenuItem value="Any">Any</MenuItem>
            <MenuItem value="Less than">&lt;</MenuItem>
            <MenuItem value="More than">&gt;</MenuItem>
            <MenuItem value="Exactly">=</MenuItem>
          </Select>
          {filterInputs[name][0] !== "Any" && (
            <TextField
              id={`${name}Count`}
              className={classes.numberInput}
              type="number"
              size="small"
              color="secondary"
              value={filterInputs[name][1] || 0}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) {
                  setFilterInputs({
                    ...filterInputs,
                    [name]: [filterInputs[name][0], v],
                  });
                }
              }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={classes.filterOptions}>
      <div className={classes.scrollArea}>
        <div className={classes.searchContainer}>
          <TextField
            id="name"
            className={classes.searchInput}
            type="search"
            size="small"
            label="Search by name"
            value={filterInputs.name}
            slotProps={{
              input: {
                endAdornment: (
                  <Search className={`${classes.search} icon`} />
                ),
              },
            }}
            onChange={(e) => {
              setFilterInputs({ ...filterInputs, name: e.target.value.trim() });
            }}
          />
        </div>

        <div className={classes.section}>
          <div className={classes.sectionHeader}>Grades</div>
          <div className={classes.sliderGrid}>
            {sliderCell("v_grade", "Vertical", [1, 7])}
            {sliderCell("a_grade", "Aquatic", [1, 7])}
            {sliderCell("commitment", "Commitment", [1, 6])}
          </div>
        </div>

        <div className={classes.section}>
          <div className={classes.sectionHeader}>Character</div>
          <div className={classes.sliderGrid}>
            {sliderCell("quality", "Quality", [1, 5])}
            {sliderCell("wetsuits", "Wetsuits", [1, 5])}
          </div>
        </div>

        <div className={classes.section}>
          <div className={classes.sectionHeader}>Logistics</div>
          <div className={classes.selectGrid}>
            {selectCell("pitches", "Pitches")}
            {selectCell("longest_pitch", "Longest pitch")}
            {selectCell("hours", "Hours")}
          </div>
        </div>
      </div>

      <div className={classes.buttonBar}>
        <button
          className={classes.applyButton}
          onClick={() => onChangeFilters({ ...filters, ...filterInputs })}
        >
          Apply
        </button>
        <button
          className={classes.resetButton}
          onClick={() => {
            const reset: TFilters = {
              name: null,
              v_grade: [1, 7],
              a_grade: [1, 7],
              commitment: [1, 6],
              quality: [1, 5],
              pitches: null,
              longest_pitch: null,
              hours: null,
              wetsuits: null,
            };
            onChangeFilters(reset);
            setFilterInputs({
              name: "",
              v_grade: [1, 7],
              a_grade: [1, 7],
              commitment: [1, 6],
              quality: [1, 5],
              pitches: ["Any", 0],
              longest_pitch: ["Any", 0],
              hours: ["Any", 0],
              wetsuits: [1, 5],
            });
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

export default FiltersPanel;
