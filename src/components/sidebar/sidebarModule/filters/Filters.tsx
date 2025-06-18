import { useState } from "react";
import classes from "./Filters.module.css";
import Search from "../../../../assets/search.svg";
import { Slider, TextField, Button, Select, MenuItem } from "@mui/material";
import type { TFilters } from "../../../../canyonUtils";

function Filters({
  onChangeFilters,
  filters,
}: {
  onChangeFilters: (filters: TFilters) => void;
  filters: TFilters;
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

  function sliderFilterInput(
    name: keyof TFilters,
    displayName: string,
    range: [number, number] = [1, 7],
    step: number = 1
  ) {
    return (
      <>
        <h4>{displayName}</h4>
        <Slider
          id={name}
          style={{ width: "100%" }}
          marks={step === 1}
          step={step}
          min={range[0]}
          max={range[1]}
          value={
            Array.isArray(filterInputs[name]) &&
            typeof filterInputs[name][0] === "number"
              ? (filterInputs[name] as number[])
              : range
          }
          valueLabelDisplay="auto"
          onChange={(_e, value) => {
            if (Array.isArray(value) && value.length === 2) {
              setFilterInputs({
                ...filterInputs,
                [name]: value,
              });
            }
          }}
        />
      </>
    );
  }

  function selectNumberFilterInput(name: keyof TFilters, displayName: string) {
    return (
      <>
        <h4>{displayName}</h4>
        <div className={classes.selectContainer}>
          <Select
            id={`${name}Operator`}
            className={classes.select}
            size="small"
            value={filterInputs[name][0] ?? "Any"}
            onChange={(e) => {
              setFilterInputs({
                ...filterInputs,
                [name]: [e.target.value, filterInputs[name][1] || 0],
              });
            }}
          >
            <MenuItem value="Any">Any</MenuItem>
            <MenuItem value="Less than">Less than</MenuItem>
            <MenuItem value="More than">More than</MenuItem>
            <MenuItem value="Exactly">Exactly</MenuItem>
          </Select>
          {filterInputs[name][0] === "Any" || (
            <TextField
              id={`${name}Count`}
              className={classes.numberInput}
              type="number"
              size="small"
              value={filterInputs[name][1] || 0}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10);
                if (!isNaN(value)) {
                  setFilterInputs({
                    ...filterInputs,
                    [name]: [filterInputs[name][0], value],
                  });
                }
              }}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <div className={classes.filterOptions}>
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
                <img className={`${classes.search} icon`} src={Search} />
              ),
            },
          }}
          onChange={(e) => {
            const value = e.target.value.trim();
            setFilterInputs({
              ...filterInputs,
              name: value,
            });
          }}
        />
      </div>
      {sliderFilterInput("v_grade", "Vertical Grade")}
      {sliderFilterInput("a_grade", "Aquatic Grade")}
      {sliderFilterInput("commitment", "Commitment", [1, 6])}
      {sliderFilterInput("quality", "Quality", [1, 5], 0.1)}
      {selectNumberFilterInput("pitches", "Pitches")}
      {selectNumberFilterInput("longest_pitch", "Longest Pitch")}
      {selectNumberFilterInput("hours", "Hours")}
      {sliderFilterInput("wetsuits", "Wetsuits", [1, 5])}
      <div className={classes.buttonContainer}>
        <Button
          variant="contained"
          onClick={() => onChangeFilters({ ...filters, ...filterInputs })}
        >
          Apply
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={() => {
            onChangeFilters({
              name: null,
              v_grade: [1, 7],
              a_grade: [1, 7],
              commitment: [1, 6],
              quality: [1, 5],
              pitches: null,
              longest_pitch: null,
              hours: null,
              wetsuits: null,
            }),
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
        </Button>
      </div>
    </div>
  );
}

export default Filters;
