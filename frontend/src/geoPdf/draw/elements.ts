// Map elements drawn over the map: title, scale bar and text, compass, grid
// lines, place markers and the attribution. A port of the server's
// generateGeoPdf.ts drawing onto an OffscreenCanvasRenderingContext2D with the
// same constants, so a browser GeoPDF looks like a server one.
import { model as magneticModel } from "geomagnetism";
import {
  detectMgaZone,
  extractionCreditLine,
  fromEastingNorthing,
  BASEMAP_CATALOG,
  gridConvergence,
  overlayAttributionLines,
  toEastingNorthing,
  type GeoPdfConfig,
} from "@logjam/shared";
import {
  ACCENT,
  DEG_TO_RAD,
  GN_COLOR,
  HAIRLINE,
  INK,
  INK_MUTED,
  latLonToCanvasPx,
  MAP_FONT,
  MN_COLOR,
  mmToPx,
  PAPER_FILL,
  TN_COLOR,
  type Ctx,
} from "./common";

const SCALE_BAR_DISTANCES = [100, 250, 500, 1000, 2000, 5000, 10000];

/** Format distance label for scale bar */
function formatDistance(m: number): string {
  if (m >= 1000) return `${m / 1000} km`;
  return `${m} m`;
}

export function drawRoundedRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawElementBackground(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  dpi: number,
) {
  const radius = mmToPx(1.2, dpi);

  // Soft drop shadow + warm-paper fill, then a hairline border with no shadow.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
  ctx.shadowBlur = mmToPx(0.9, dpi);
  ctx.shadowOffsetY = mmToPx(0.4, dpi);
  ctx.fillStyle = PAPER_FILL;
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = HAIRLINE;
  ctx.lineWidth = mmToPx(0.2, dpi);
  drawRoundedRect(ctx, x, y, w, h, radius);
  ctx.stroke();
  ctx.restore();
}

export function drawTitle(
  ctx: Ctx,
  title: string,
  margin: number,
  padH: number,
  padV: number,
  dpi: number,
) {
  const fontPx = mmToPx(4, dpi);
  ctx.font = `bold ${fontPx}px ${MAP_FONT}`;
  const metrics = ctx.measureText(title);
  const boxW = metrics.width + padH * 2;
  const boxH = fontPx + padV * 2;
  const x = margin;
  const y = margin;

  drawElementBackground(ctx, x, y, boxW, boxH, dpi);
  ctx.fillStyle = INK;
  ctx.fillText(title, x + padH, y + padV + fontPx * 0.85);

  // Thin accent rule under the title.
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = mmToPx(0.5, dpi);
  ctx.beginPath();
  ctx.moveTo(x + padH, y + padV + fontPx + mmToPx(0.6, dpi));
  ctx.lineTo(x + padH + metrics.width, y + padV + fontPx + mmToPx(0.6, dpi));
  ctx.stroke();
}

export function drawScaleBar(
  ctx: Ctx,
  config: GeoPdfConfig,
  canvasWidth: number,
  stackY: number,
  margin: number,
  padH: number,
  padV: number,
  dpi: number,
): number {
  // Find largest round distance fitting 25% of map width
  const midLat = (config.extent.north + config.extent.south) / 2;
  const mapWidthM =
    (config.extent.east - config.extent.west) *
    111320 *
    Math.cos(midLat * DEG_TO_RAD);
  const maxBarM = mapWidthM * 0.25;
  let barDistM = SCALE_BAR_DISTANCES[0];
  for (const d of SCALE_BAR_DISTANCES) {
    if (d <= maxBarM) barDistM = d;
    else break;
  }

  const barWidthPx = (barDistM / mapWidthM) * canvasWidth;
  const barHeight = mmToPx(2, dpi);
  const fontPx = mmToPx(2.5, dpi);
  const segments = 4;
  const segWidth = barWidthPx / segments;

  const labelText = formatDistance(barDistM);
  ctx.font = `${fontPx}px ${MAP_FONT}`;
  const labelW = ctx.measureText(labelText).width;

  const boxW = barWidthPx + padH * 2 + labelW + mmToPx(2, dpi);
  const boxH = barHeight + fontPx + padV * 3;
  const x = margin;
  const y = stackY - boxH;

  drawElementBackground(ctx, x, y, boxW, boxH, dpi);

  // Draw alternating segments
  for (let i = 0; i < segments; i++) {
    ctx.fillStyle = i % 2 === 0 ? INK : "white";
    ctx.fillRect(x + padH + i * segWidth, y + padV, segWidth, barHeight);
  }

  // Bar border
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + padH, y + padV, barWidthPx, barHeight);

  // Labels
  ctx.fillStyle = INK;
  ctx.font = `${fontPx}px ${MAP_FONT}`;
  ctx.fillText("0", x + padH, y + padV + barHeight + fontPx + mmToPx(0.5, dpi));
  ctx.fillText(
    labelText,
    x + padH + barWidthPx + mmToPx(1, dpi),
    y + padV + barHeight / 2 + fontPx * 0.35,
  );

  return y - mmToPx(1, dpi);
}

export function drawScaleText(
  ctx: Ctx,
  config: GeoPdfConfig,
  stackY: number,
  margin: number,
  padH: number,
  padV: number,
  dpi: number,
): number {
  const text = `1:${Math.round(config.scale).toLocaleString("en-US")}`;
  const fontPx = mmToPx(3, dpi);
  ctx.font = `bold ${fontPx}px ${MAP_FONT}`;
  const metrics = ctx.measureText(text);
  const boxW = metrics.width + padH * 2;
  const boxH = fontPx + padV * 2;
  const x = margin;
  const y = stackY - boxH;

  drawElementBackground(ctx, x, y, boxW, boxH, dpi);
  ctx.fillStyle = INK;
  ctx.fillText(text, x + padH, y + padV + fontPx * 0.85);

  return y - mmToPx(1, dpi);
}

export function drawCompass(
  ctx: Ctx,
  config: GeoPdfConfig,
  stackY: number,
  margin: number,
  dpi: number,
): number {
  const midLat = (config.extent.north + config.extent.south) / 2;
  const midLon = (config.extent.east + config.extent.west) / 2;

  // Magnetic declination
  const model = magneticModel();
  const magInfo = model.point([midLat, midLon]);
  const magDecl = magInfo.decl as number; // degrees, positive = east

  // Grid convergence
  const gridConv = gridConvergence(midLat, midLon);

  // ── Layout ───────────────────────────────────────────────────────────────
  // Standard declination diagram: three arms from one origin at their TRUE
  // angles (no exaggeration). Arms have distinct lengths (TN longest, GN
  // shortest, MN medium) so the near-coincident TN/GN arms stay distinguishable
  // and their tip labels land at different radii without colliding.
  const armTN = mmToPx(16, dpi);
  const armMN = mmToPx(13, dpi);
  const armGN = mmToPx(10, dpi);
  const headroom = mmToPx(5.5, dpi); // star + TN label above the longest arm
  const topPad = mmToPx(2, dpi);
  const tipFont = mmToPx(2.3, dpi);
  const readoutFont = mmToPx(2.6, dpi);
  const readoutGap = mmToPx(3.5, dpi);
  const rowH = readoutFont * 1.55;
  const bottomPad = mmToPx(3, dpi);
  const readoutInset = mmToPx(4, dpi);
  const sidePad = mmToPx(3.5, dpi);
  const starR = mmToPx(1.7, dpi);
  const barbLen = mmToPx(3, dpi);
  const barbW = mmToPx(1.7, dpi);
  // Tip-label radial offsets beyond each arm tip (shared by sizing + drawing).
  const tnLabelExtra = starR + mmToPx(2.2, dpi);
  const mnLabelExtra = mmToPx(3, dpi);
  const gnLabelExtra = mmToPx(2.6, dpi);

  const fmtDecl = (v: number) =>
    `${Math.abs(v).toFixed(1)}° ${v >= 0 ? "E" : "W"}`;

  // ── Dynamic width ──────────────────────────────────────────────────────────
  // The fixed 34 mm box left wide gutters. Size the panel to the wider of two
  // content blocks: the arm/label cluster, and the two-line declination readout.
  // x-offsets below are measured RELATIVE TO THE ARM ORIGIN (positive = right).
  const armX: number[] = [0];
  ctx.font = `bold ${tipFont}px ${MAP_FONT}`;
  const addArm = (
    deg: number,
    len: number,
    labelExtra: number,
    label: string,
  ) => {
    const s = Math.sin(deg * DEG_TO_RAD);
    armX.push(s * len, s * len - starR, s * len + starR); // tip + star/tick spread
    const lw = ctx.measureText(label).width;
    const lcx = s * (len + labelExtra);
    armX.push(lcx - lw / 2, lcx + lw / 2);
  };
  addArm(0, armTN, tnLabelExtra, "TN");
  addArm(magDecl, armMN, mnLabelExtra, "MN");
  addArm(gridConv, armGN, gnLabelExtra, "GN");
  // MN half-arrow barb reaches perpendicular to its arm.
  {
    const r = magDecl * DEG_TO_RAD;
    armX.push(Math.sin(r) * (armMN - barbLen) + Math.cos(r) * barbW);
  }
  const leftHalf = -Math.min(...armX);
  const rightHalf = Math.max(...armX);
  const armBlockWidth = 2 * (Math.max(leftHalf, rightHalf) + sidePad);

  // Readout block: bold abbreviation + regular value, per row; take the widest.
  let readoutRowWidth = 0;
  for (const [abbr, val] of [
    ["MN", fmtDecl(magDecl)],
    ["GN", fmtDecl(gridConv)],
  ] as const) {
    ctx.font = `bold ${readoutFont}px ${MAP_FONT}`;
    const w = ctx.measureText(abbr + "  ").width;
    ctx.font = `${readoutFont}px ${MAP_FONT}`;
    readoutRowWidth = Math.max(readoutRowWidth, w + ctx.measureText(val).width);
  }
  const readoutBlockWidth = readoutInset + readoutRowWidth + mmToPx(2, dpi);

  const arrowAreaH = headroom + armTN;
  const boxW = Math.max(armBlockWidth, readoutBlockWidth, mmToPx(20, dpi));
  const boxH = topPad + arrowAreaH + readoutGap + 2 * rowH + bottomPad;
  const boxX = margin;
  const boxY = stackY - boxH;

  drawElementBackground(ctx, boxX, boxY, boxW, boxH, dpi);

  const cx = boxX + boxW / 2;
  const cy = boxY + topPad + arrowAreaH; // arm origin (base), arms point up

  // Bearing (deg, clockwise from up, +ve = east) → screen point at radius `len`.
  const bearingPt = (deg: number, len: number) => {
    const r = deg * DEG_TO_RAD;
    return { x: cx + Math.sin(r) * len, y: cy - Math.cos(r) * len };
  };

  const drawArm = (deg: number, len: number, color: string) => {
    const tip = bearingPt(deg, len);
    ctx.strokeStyle = color;
    ctx.lineWidth = mmToPx(0.45, dpi);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    return tip;
  };

  // Five-point star (points up), filled — marks True North per convention.
  const drawStar = (x: number, y: number, rOuter: number, color: string) => {
    const rInner = rOuter * 0.42;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? rOuter : rInner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  // Single-sided barb (half-arrowhead) at MN tip, per convention.
  const drawHalfArrow = (
    tip: { x: number; y: number },
    deg: number,
    color: string,
  ) => {
    const r = deg * DEG_TO_RAD;
    const dir = { x: Math.sin(r), y: -Math.cos(r) }; // along arm toward tip
    const perp = { x: -dir.y, y: dir.x }; // left of travel
    const base = { x: tip.x - dir.x * barbLen, y: tip.y - dir.y * barbLen };
    const side = { x: base.x + perp.x * barbW, y: base.y + perp.y * barbW };
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(base.x, base.y);
    ctx.lineTo(side.x, side.y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };

  // ── Arms (longest first so shorter arms read on top near the origin) ───────
  const tnTip = drawArm(0, armTN, TN_COLOR);
  const mnTip = drawArm(magDecl, armMN, MN_COLOR);
  const gnTip = drawArm(gridConv, armGN, GN_COLOR);

  // Origin dot
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, cy, mmToPx(0.5, dpi), 0, Math.PI * 2);
  ctx.fill();

  // Tip symbology
  drawStar(tnTip.x, tnTip.y, starR, TN_COLOR);
  drawHalfArrow(mnTip, magDecl, MN_COLOR);
  // GN: short perpendicular tick across the tip
  ctx.strokeStyle = GN_COLOR;
  ctx.lineWidth = mmToPx(0.45, dpi);
  {
    const r = gridConv * DEG_TO_RAD;
    const perp = { x: Math.cos(r), y: Math.sin(r) };
    const t = mmToPx(1, dpi);
    ctx.beginPath();
    ctx.moveTo(gnTip.x - perp.x * t, gnTip.y - perp.y * t);
    ctx.lineTo(gnTip.x + perp.x * t, gnTip.y + perp.y * t);
    ctx.stroke();
  }

  // Tip labels — placed just beyond each tip along its bearing; distinct arm
  // lengths keep them from colliding.
  ctx.font = `bold ${tipFont}px ${MAP_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tnLabel = bearingPt(0, armTN + tnLabelExtra);
  ctx.fillStyle = TN_COLOR;
  ctx.fillText("TN", tnLabel.x, tnLabel.y);
  const mnLabel = bearingPt(magDecl, armMN + mnLabelExtra);
  ctx.fillStyle = MN_COLOR;
  ctx.fillText("MN", mnLabel.x, mnLabel.y);
  const gnLabel = bearingPt(gridConv, armGN + gnLabelExtra);
  ctx.fillStyle = GN_COLOR;
  ctx.fillText("GN", gnLabel.x, gnLabel.y);

  // ── Angle readout (relative to true north, cardinal-suffixed) ──────────────
  const rx = boxX + readoutInset;
  let ry = cy + readoutGap + rowH / 2;
  ctx.textAlign = "start";
  ctx.textBaseline = "middle";
  for (const [color, abbr, val] of [
    [MN_COLOR, "MN", fmtDecl(magDecl)],
    [GN_COLOR, "GN", fmtDecl(gridConv)],
  ] as const) {
    ctx.fillStyle = color;
    ctx.font = `bold ${readoutFont}px ${MAP_FONT}`;
    ctx.fillText(abbr, rx, ry);
    const abbrW = ctx.measureText(abbr + "  ").width;
    ctx.fillStyle = INK;
    ctx.font = `${readoutFont}px ${MAP_FONT}`;
    ctx.fillText(val, rx + abbrW, ry);
    ry += rowH;
  }

  // Reset context state
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";

  return boxY;
}

export function drawPlaceMarkers(
  ctx: Ctx,
  config: GeoPdfConfig,
  widthPx: number,
  heightPx: number,
  dpi: number,
) {
  const radius = mmToPx(2, dpi);
  const labelFontSize = mmToPx(2.5, dpi);

  for (const marker of config.placeMarkers!) {
    const { x, y } = latLonToCanvasPx(
      marker.lat,
      marker.lon,
      config.extent,
      widthPx,
      heightPx,
    );

    // Skip markers outside canvas bounds
    if (
      x < -radius ||
      x > widthPx + radius ||
      y < -radius ||
      y > heightPx + radius
    )
      continue;

    // Filled circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = marker.color === "owned" ? "#f97316" : "#3b82f6";
    ctx.fill();
    ctx.strokeStyle = "#333333";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Name label at scales <= 1:50000
    if (config.scale <= 50000 && marker.name) {
      ctx.font = `${labelFontSize}px ${MAP_FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      const labelX = x + radius + mmToPx(1, dpi);
      const labelY = y;

      // White halo for legibility
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeText(marker.name, labelX, labelY);

      ctx.fillStyle = INK;
      ctx.fillText(marker.name, labelX, labelY);
    }
  }

  // Reset context state
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

/**
 * Draw an MGA grid label with the principal 2-digit grid reference in a
 * larger bold font, following standard topographic map conventions.
 */
export function drawGridLabel(
  ctx: Ctx,
  value: number,
  interval: number,
  x: number,
  y: number,
  smallFontSize: number,
  largeFontSize: number,
) {
  const km = Math.round(value / 1000);
  const principal = String(km % 100).padStart(2, "0");
  const prefix = String(Math.floor(km / 100));

  let curX = x;

  ctx.font = `${smallFontSize}px ${MAP_FONT}`;
  ctx.fillText(prefix, curX, y);
  curX += ctx.measureText(prefix).width;

  ctx.font = `bold ${largeFontSize}px ${MAP_FONT}`;
  ctx.fillText(principal, curX, y);
  curX += ctx.measureText(principal).width;

  if (interval < 10000) {
    ctx.font = `${smallFontSize}px ${MAP_FONT}`;
    ctx.fillText("000", curX, y);
  }

  // Restore font
  ctx.font = `${smallFontSize}px ${MAP_FONT}`;
}

export function drawGridLines(
  ctx: Ctx,
  config: GeoPdfConfig,
  widthPx: number,
  heightPx: number,
  dpi: number,
) {
  const { north, south, east, west } = config.extent;
  const fontPx = mmToPx(2, dpi);
  const largeFontSize = mmToPx(3.2, dpi);
  ctx.font = `${fontPx}px ${MAP_FONT}`;
  ctx.strokeStyle = INK_MUTED;
  ctx.fillStyle = INK;
  ctx.lineWidth = 2.5;

  if (config.elements.gridLines === "enNorthing") {
    // MGA easting/northing grid
    const interval = config.scale <= 25000 ? 1000 : 10000;

    // Use a single MGA zone based on the map centre to avoid cross-zone issues
    const midLon = (east + west) / 2;
    const zone = detectMgaZone(midLon);

    const swEN = toEastingNorthing(south, west);
    const neEN = toEastingNorthing(north, east);

    const toPixel = (lat: number, lon: number) =>
      latLonToCanvasPx(lat, lon, config.extent, widthPx, heightPx);

    // Vertical lines (constant easting, varying northing)
    const startE = Math.ceil(swEN.easting / interval) * interval;
    const endE = Math.floor(neEN.easting / interval) * interval;
    for (let e = startE; e <= endE; e += interval) {
      const topLL = fromEastingNorthing(e, neEN.northing, zone);
      const botLL = fromEastingNorthing(e, swEN.northing, zone);
      const topPx = toPixel(topLL.lat, topLL.lon);
      const botPx = toPixel(botLL.lat, botLL.lon);
      ctx.beginPath();
      ctx.moveTo(topPx.x, topPx.y);
      ctx.lineTo(botPx.x, botPx.y);
      ctx.stroke();
      drawGridLabel(
        ctx,
        e,
        interval,
        topPx.x + 2,
        largeFontSize + 4,
        fontPx,
        largeFontSize,
      );
    }

    // Horizontal lines (constant northing, varying easting)
    const startN = Math.ceil(swEN.northing / interval) * interval;
    const endN = Math.floor(neEN.northing / interval) * interval;
    for (let n = startN; n <= endN; n += interval) {
      const leftLL = fromEastingNorthing(swEN.easting, n, zone);
      const rightLL = fromEastingNorthing(neEN.easting, n, zone);
      const leftPx = toPixel(leftLL.lat, leftLL.lon);
      const rightPx = toPixel(rightLL.lat, rightLL.lon);
      ctx.beginPath();
      ctx.moveTo(leftPx.x, leftPx.y);
      ctx.lineTo(rightPx.x, rightPx.y);
      ctx.stroke();
      drawGridLabel(ctx, n, interval, 2, leftPx.y - 2, fontPx, largeFontSize);
    }
  } else {
    // Lat/lon grid
    const latRange = north - south;
    const lonRange = east - west;

    // Choose interval based on extent size
    const intervals = [10, 5, 2, 1, 0.5, 1 / 6, 1 / 12, 1 / 60, 1 / 120]; // degrees
    let latInterval = intervals[0];
    for (const iv of intervals) {
      if (latRange / iv >= 3 && latRange / iv <= 15) {
        latInterval = iv;
        break;
      }
    }
    let lonInterval = intervals[0];
    for (const iv of intervals) {
      if (lonRange / iv >= 3 && lonRange / iv <= 15) {
        lonInterval = iv;
        break;
      }
    }

    // Horizontal lines (latitudes)
    const startLat = Math.ceil(south / latInterval) * latInterval;
    for (let lat = startLat; lat <= north; lat += latInterval) {
      const { y } = latLonToCanvasPx(
        lat,
        west,
        config.extent,
        widthPx,
        heightPx,
      );
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(widthPx, y);
      ctx.stroke();
      ctx.fillText(lat.toFixed(4) + "°", 2, y - 2);
    }

    // Vertical lines (longitudes)
    const startLon = Math.ceil(west / lonInterval) * lonInterval;
    for (let lon = startLon; lon <= east; lon += lonInterval) {
      const frac = (lon - west) / (east - west);
      const x = frac * widthPx;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, heightPx);
      ctx.stroke();
      ctx.fillText(lon.toFixed(4) + "°", x + 2, fontPx + 6);
    }
  }
}

/** What the credits are made of: the page's config and what drew. */
export type AttributionInput = {
  baseLayer: string;
  /** Overlay layer names whose data is on the page (`overlayAttributionLines`). */
  renderedOverlays: readonly string[];
  /** `terrainCreditLines` of what drew. */
  terrainLines: readonly string[];
  /** When the base tiles were taken (the dated NSW Spatial Services credit). */
  extractedAt: Date;
};

/**
 * The attribution's lines in reading order, each word-wrapped to the right
 * 55% of the map so long licence strings never run off the left edge (worst
 * in portrait); the left 45% stays clear of the bottom-left stack. The last
 * line is "Generated by Logjam", pinned to the corner. Sets `ctx.font`.
 */
export function attributionLines(
  ctx: Ctx,
  widthPx: number,
  dpi: number,
  input: AttributionInput,
): string[] {
  ctx.font = `${mmToPx(1.8, dpi)}px ${MAP_FONT}`;
  const baseAttrib =
    BASEMAP_CATALOG.find((entry) => entry.id === input.baseLayer)
      ?.attribution ?? "Base map data";
  const maxLineWidth = widthPx * 0.55;
  const wrap = (text: string): string[] => {
    const words = text.split(" ");
    const wrapped: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(candidate).width > maxLineWidth) {
        wrapped.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) wrapped.push(current);
    return wrapped;
  };
  const lines = [
    baseAttrib,
    // NSW Spatial Services require a dated extraction credit beside the
    // standing one (web-service terms cl. 3.1.1); null for other base layers.
    extractionCreditLine(input.baseLayer, input.extractedAt),
    ...input.terrainLines,
    ...overlayAttributionLines([...input.renderedOverlays]),
  ]
    .filter((line): line is string => line !== null)
    .flatMap(wrap);
  lines.push("Generated by Logjam");
  return lines;
}

/** The rows the attribution block covers: [top, bottom) in map pixels. */
export function attributionRows(
  lineCount: number,
  heightPx: number,
  margin: number,
  dpi: number,
): { top: number; bottom: number } {
  const fontPx = mmToPx(1.8, dpi);
  const lineStep = fontPx + mmToPx(0.5, dpi);
  // The bottom baseline sits on the margin; the top line's glyphs rise a font
  // size above its baseline, and the halo a little further.
  return {
    top: Math.floor(
      heightPx -
        margin -
        lineStep * (lineCount - 1) -
        fontPx -
        mmToPx(0.6, dpi),
    ),
    bottom: heightPx,
  };
}

export function drawAttribution(
  ctx: Ctx,
  widthPx: number,
  heightPx: number,
  margin: number,
  dpi: number,
  input: AttributionInput,
) {
  const fontPx = mmToPx(1.8, dpi);
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  // Credit sources stack bottom-up, so draw the list in reverse: index counts
  // distance up from the bottom margin.
  const visualLines = attributionLines(ctx, widthPx, dpi, input);
  const lineStep = fontPx + mmToPx(0.5, dpi);
  const x = widthPx - margin;
  for (let i = 0; i < visualLines.length; i++) {
    const line = visualLines[visualLines.length - 1 - i]!;
    const y = heightPx - margin - lineStep * i;
    // A light paper-cream halo carries legibility over any basemap (including
    // dark imagery), so the attribution needs no panel.
    ctx.save();
    ctx.lineWidth = mmToPx(0.6, dpi);
    ctx.lineJoin = "round";
    ctx.strokeStyle = PAPER_FILL;
    ctx.strokeText(line, x, y);
    ctx.fillStyle = INK;
    ctx.fillText(line, x, y);
    ctx.restore();
  }
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}
