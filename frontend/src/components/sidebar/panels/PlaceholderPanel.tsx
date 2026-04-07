import classes from "./PlaceholderPanel.module.css";

function PlaceholderPanel({ text }: { text: string }) {
  return <div className={classes.placeholder}>{text}</div>;
}

export default PlaceholderPanel;
