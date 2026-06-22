import classes from "./Footer.module.css";

const BUG_MAILTO =
  "mailto:zentmarcos@gmail.com?subject=Logjam%20bug%20report";

const SOURCE_URL = "https://github.com/Zen-TM/logjam";

function Footer() {
  return (
    <footer className={classes.footer}>
      <a className={classes.link} href="/tos.html" target="_blank" rel="noopener noreferrer">
        Terms
      </a>
      <span className={classes.sep} aria-hidden="true">·</span>
      <a className={classes.link} href="/privacy.html" target="_blank" rel="noopener noreferrer">
        Privacy
      </a>
      <span className={classes.sep} aria-hidden="true">·</span>
      <a className={classes.link} href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
        Source
      </a>
      <span className={classes.sep} aria-hidden="true">·</span>
      <a className={classes.link} href={BUG_MAILTO}>
        Report a bug
      </a>
    </footer>
  );
}

export default Footer;
