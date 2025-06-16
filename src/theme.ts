import { createTheme } from "@mui/material/styles";
import "./index.css";

const theme = createTheme({
  palette: {
    primary: {
      main: "#8C7A5B",
    },
    secondary: {
      main: "#4E4944",
    },
  },
  components: {
    MuiTextField: {
      styleOverrides: {
        root: {
          input: {
            color: "var(--content-color)",
            "&::placeholder": {
              color: "var(--content-color)",
            },
          },
          "& .MuiInputLabel-root": {
            color: "var(--content-color)",
          },
          label: {
            color: "var(--content-color)",
          },
          "& .MuiOutlinedInput-root": {
            "& fieldset": {
              borderColor: "var(--content-color)",
            },
            "&:hover:not(.Mui-focused) fieldset": {
              borderColor: "var(--content-color)",
            },
          },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        root: {
          color: "var(--content-color)",
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: "var(--content-color)",
          },
          "&:hover:not(.Mui-focused) .MuiOutlinedInput-notchedOutline": {
            borderColor: "var(--content-color)",
          },
        },
        icon: {
          color: "var(--content-color)",
        },
      },
    },
  },
});

export default theme;
