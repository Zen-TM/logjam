import { useState, useEffect, useRef } from "react";
import classes from "./SidebarModule.module.css";
import Arrow from "../../../assets/arrow.svg";

function SidebarModule({
  sidebarOpen = false,
  moduleName,
  children,
}: {
  sidebarOpen?: boolean;
  moduleName: string;
  children: React.ReactNode;
}) {
  const [moduleOpen, setModuleOpen] = useState(false);
  const [shouldRenderContent, setShouldRenderContent] = useState(moduleOpen);
  const [maxHeight, setMaxHeight] = useState("0px");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sidebarOpen) {
      setModuleOpen(false);
    }
  }, [sidebarOpen]);

  const [transitionDone, setTransitionDone] = useState(false);

  useEffect(() => {
    if (moduleOpen) {
      setShouldRenderContent(true);
      setTransitionDone(false);
      const timer = setTimeout(() => {
        if (contentRef.current) {
          setMaxHeight(contentRef.current.scrollHeight + "px");
        }
      }, 10);
      // After the CSS transition (300ms), switch to none so dynamic content can grow
      const doneTimer = setTimeout(() => setTransitionDone(true), 320);
      return () => {
        clearTimeout(timer);
        clearTimeout(doneTimer);
      };
    } else {
      setTransitionDone(false);
      if (contentRef.current) {
        // Snap back to a fixed value before animating to 0
        setMaxHeight(contentRef.current.scrollHeight + "px");
        requestAnimationFrame(() => setMaxHeight("0px"));
      }
      const timer = setTimeout(() => setShouldRenderContent(false), 300);
      return () => clearTimeout(timer);
    }
  }, [moduleOpen]);

  return (
    <div
      className={classes.sidebarModule}
      style={{ opacity: sidebarOpen ? "1" : "0" }}
    >
      <div className={classes.header}>
        <h3>{moduleName}</h3>
        <button
          className={classes.toggleButton}
          onClick={() => setModuleOpen(!moduleOpen)}
        >
          <img
            className={`${classes.arrow} icon`}
            style={{
              transform: moduleOpen ? "rotate(270deg)" : "rotate(90deg)",
            }}
            src={Arrow}
            alt="Arrow"
          />
        </button>
      </div>
      {shouldRenderContent && (
        <div
          className={classes.content}
          style={{
            maxHeight: transitionDone ? "none" : maxHeight,
            minHeight: "0px",
            overflow: transitionDone ? "visible" : "hidden",
          }}
          ref={contentRef}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export default SidebarModule;
