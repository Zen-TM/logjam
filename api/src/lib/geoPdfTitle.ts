// The one reader of a GeoPDF job's human label.
//
// A `GeoPdfJob` has no `name` column — its title lives in the render config
// (`config.elements.title`), which is why every surface that lists a job has to
// dig for it. Two do now (the job list, and the per-friend sharing audit), so
// the dig lives here rather than in whichever route needed it first.
export function geoPdfTitle(config: unknown): string | null {
  if (config && typeof config === "object" && "elements" in config) {
    const elements = (config as { elements?: unknown }).elements;
    if (elements && typeof elements === "object" && "title" in elements) {
      const title = (elements as { title?: unknown }).title;
      if (typeof title === "string" && title.trim().length > 0) return title.trim();
    }
  }
  return null;
}
