// Runs before the app bundle, as a classic script so an engine too old to
// parse the bundle still gets here. Feature test, never the user agent: the
// Popover API is the newest thing Logjam Web needs. docs/decisions/0042.
// Test: src/browserCheck.test.ts.
(function () {
  if ("popover" in HTMLElement.prototype) return;
  var root = document.getElementById("root");
  if (!root) return;
  var dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  var page = document.createElement("main");
  page.setAttribute("data-unsupported-browser", "");
  page.style.cssText =
    "box-sizing:border-box;min-height:100vh;padding:24px;display:flex;" +
    "flex-direction:column;justify-content:center;max-width:32rem;margin:0 auto;" +
    "font:16px/1.5 system-ui,sans-serif;color:" +
    (dark ? "#eee" : "#222");
  document.body.style.cssText =
    "margin:0;background:" + (dark ? "#1c1a18" : "#fff");
  page.innerHTML =
    '<h1 style="font-size:1.5rem;margin:0 0 12px">Logjam Web needs a newer browser</h1>' +
    '<p style="margin:0">Logjam Web needs Safari 17, Chrome 114 or Firefox 125, or newer. Update your browser, or open Logjam Web in another one.</p>';
  // main.tsx mounts only when #root exists.
  root.replaceWith(page);
})();
