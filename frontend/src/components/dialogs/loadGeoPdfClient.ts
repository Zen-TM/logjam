/** The renderer's chunk. Its own module so a test can stand in for the
 *  renderer: vitest does not mock a dynamic `import()` inside the dialog. */
export const loadGeoPdfClient = () => import("../../geoPdf/client");
