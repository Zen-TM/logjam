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
    if (moduleOpen) {
      setShouldRenderContent(true);
      setTimeout(() => {
        if (contentRef.current) {
          setMaxHeight(contentRef.current.scrollHeight + "px");
        }
      }, 10);
    } else {
      if (contentRef.current) {
        setMaxHeight("0px");
      }
      setTimeout(() => setShouldRenderContent(false), 300);
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
            maxHeight: maxHeight,
            minHeight: "0px",
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
