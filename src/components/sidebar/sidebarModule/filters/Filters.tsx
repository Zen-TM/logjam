import { useState } from "react";
import classes from "./Filters.module.css";
import Search from "../../../../assets/search.svg";
import { Slider, TextField, Button } from "@mui/material";
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
  });

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
      <h4>Vertical Grade</h4>
      <Slider
        id="v_grade"
        style={{ width: "100%" }}
        marks
        step={1}
        min={1}
        max={7}
        value={filterInputs.v_grade || [1, 7]}
        valueLabelDisplay="auto"
        onChange={(_e, value) => {
          if (Array.isArray(value) && value.length === 2) {
            setFilterInputs({
              ...filterInputs,
              v_grade: value,
            });
          }
        }}
      />
      <h4>Aquatic Grade</h4>
      <Slider
        id="a_grade"
        style={{ width: "100%" }}
        marks
        step={1}
        min={1}
        max={7}
        value={filterInputs.a_grade || [1, 7]}
        valueLabelDisplay="auto"
        onChange={(_e, value) => {
          if (Array.isArray(value) && value.length === 2) {
            setFilterInputs({
              ...filterInputs,
              a_grade: value,
            });
          }
        }}
      />
      <h4>Commitment</h4>
      <Slider
        id="commitment"
        style={{ width: "100%" }}
        marks
        step={1}
        min={1}
        max={6}
        value={filterInputs.commitment || [1, 6]}
        valueLabelDisplay="auto"
        onChange={(_e, value) => {
          if (Array.isArray(value) && value.length === 2) {
            setFilterInputs({
              ...filterInputs,
              commitment: value,
            });
          }
        }}
      />
      <h4>Quality</h4>
      <Slider
        id="quality"
        style={{ width: "100%" }}
        step={0.1}
        min={1}
        max={5}
        value={filterInputs.quality || [1, 5]}
        valueLabelDisplay="auto"
        onChange={(_e, value) => {
          if (Array.isArray(value) && value.length === 2) {
            setFilterInputs({
              ...filterInputs,
              quality: value,
            });
          }
        }}
      />
      {/* Additional filters will be added for pitches, longest pitch, hours, wetsuits */}
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
