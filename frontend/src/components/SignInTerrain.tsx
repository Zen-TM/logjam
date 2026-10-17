// A canyon area behind the sign-in form, a different one each visit, made
// from the NSW 5 m DEM, whose licence asks for its credit wherever a height
// from it is shown (ADR 0031). The credit sits in the bottom-right corner;
// narrow, the card covers that corner and SignIn shows it in its footer. useSignInArea picks and loads the area.
//
// It is shaded by the sun where it stands over the area now, so it never
// moves while you look at it. A pointer passing over it is rain: each drop
// runs downhill along the valley's own drainage, joins the creeks, thickens
// as they do, and fades behind itself. Flat ground is the page colour
// exactly, so only the slopes show.
import { useEffect, useRef, useState } from "react";
import { NSW_5M } from "@logjam/shared";
import { useIsMobile } from "../useIsMobile";
import {
  cover,
  drainage,
  dropPath,
  type Flow,
  OUTLET,
  traceDownhill,
  valleyLight,
} from "./signInTerrain";
import classes from "./SignInTerrain.module.css";
import type { Area, Terrain } from "./useSignInArea";

type Drop = {
  points: Float32Array;
  /** Distance along the drop's path to each point, in CSS px. */
  along: Float32Array;
  width: Float32Array;
  alpha: Float32Array;
  born: number;
  /** When it has soaked in, in seconds after `born`; a retired drop's comes sooner. */
  ends: number;
};

/** CSS px the pointer travels between drops. */
const DROP_EVERY = 40;
/** Past this, a new drop retires the oldest, which soaks in early: movement
 *  always answers, and nothing vanishes. */
const MAX_DROPS = 24;
/** CSS px a drop runs per second. */
const SPEED = 240;
/** Seconds a stretch of water stays lit after the drop has passed. */
const TRAIL = 1;
/** Seconds a drop runs before it soaks in, the last of them fading. */
const LIFE = 2.4;
const SOAK = 0.8;
/** Segments stroked as one, so a frame is a few hundred strokes. */
const RUN = 6;

function cssColour(name: string): [number, number, number] {
  const hex = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function sizeCanvas(canvas: HTMLCanvasElement, W: number, H: number) {
  const dpr = window.devicePixelRatio;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  return dpr;
}

/** The 100 m contours, faint, over the relief. */
function drawContours(
  canvas: HTMLCanvasElement,
  terrain: Terrain,
  paths: Path2D[],
) {
  const { clientWidth: W, clientHeight: H } = canvas;
  const dpr = sizeCanvas(canvas, W, H);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { s, ox, oy } = cover(W, H, terrain.w, terrain.h);
  ctx.setTransform(s * dpr, 0, 0, s * dpr, ox * dpr, oy * dpr);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue(
    "--color-line-strong",
  );
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 1.1 / s;
  ctx.lineJoin = "round";
  for (const path of paths) ctx.stroke(path);
}

const VERTEX = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D normals;
uniform vec2 origin;
uniform vec2 extent;
uniform float dpr;
uniform float width;
uniform vec3 light;
uniform float gain;
uniform vec3 page;
uniform vec3 lit;
uniform vec3 shade;
void main() {
  vec2 px = vec2(gl_FragCoord.x, gl_FragCoord.y) / dpr;
  vec2 uv = (px - origin) / extent;
  vec3 n = normalize(texture2D(normals, uv).xyz * 2.0 - 1.0);
  // Calmer behind the card, at the left.
  float calm = mix(0.5, 1.15, smoothstep(0.1, 0.75, px.x / width));
  float t = (dot(n, light) - light.z) * calm * gain;
  vec3 c = t > 0.0 ? mix(page, lit, min(t, 1.0)) : mix(page, shade, min(-t, 1.0));
  gl_FragColor = vec4(c, 1.0);
}`;

/** Draws the relief with WebGL, or null where WebGL is not available. */
function createRelief(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const gl = canvas.getContext("webgl", { antialias: false });
  if (!gl) return null;
  const program = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const p = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(p);
  gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
  const at = (name: string) => gl.getUniformLocation(program, name);

  return (light: [number, number, number], gain: number, narrow: boolean) => {
    const { clientWidth: W, clientHeight: H } = canvas;
    const dpr = sizeCanvas(canvas, W, H);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // gl_FragCoord counts up from the bottom; the image counts down.
    const { s, ox, oy } = cover(W, H, image.width, image.height);
    gl.uniform1f(at("dpr"), dpr);
    // Narrow, the card is above the band, not beside it: no calm side.
    gl.uniform1f(at("width"), narrow ? 1 : W);
    gl.uniform2f(at("origin"), ox, H - oy);
    gl.uniform2f(at("extent"), image.width * s, -image.height * s);
    const page = cssColour("--color-page");
    const text = cssColour("--color-text");
    const mix = (a: number[], b: number[], t: number) =>
      a.map((v, i) => v + (b[i] - v) * t) as [number, number, number];
    // On a light page `text` is dark, so sunlit slopes go towards white
    // instead, and shadow is the text colour, softer.
    const paper = page[0] + page[1] + page[2] > 1.5;
    gl.uniform3f(at("page"), ...page);
    gl.uniform3f(
      at("lit"),
      ...mix(page, paper ? [1, 1, 1] : text, paper ? 0.7 : 0.32),
    );
    gl.uniform3f(
      at("shade"),
      ...mix(page, paper ? text : [0, 0, 0], paper ? 0.28 : 0.45),
    );
    gl.uniform3f(at("light"), ...light);
    gl.uniform1f(at("gain"), gain);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

/** The drainage file's directions, exactly as written (no colour management). */
async function loadFlow(flowUrl: string): Promise<Flow | null> {
  const blob = await (await fetch(flowUrl)).blob();
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const dir = new Uint8Array(bitmap.width * bitmap.height);
  for (let i = 0; i < dir.length; i++) {
    dir[i] = rgba[i * 4];
    if (dir[i] > 7 && dir[i] !== OUTLET) return null;
  }
  const { width: w, height: h } = bitmap;
  return { dir, area: drainage(dir, w, h), w, h };
}

function SignInTerrain({ area }: { area: Area | null }) {
  const [drawn, setDrawn] = useState(false);
  const [now] = useState(() => new Date());
  const narrow = useIsMobile();
  const reliefRef = useRef<HTMLCanvasElement>(null);
  const contourRef = useRef<HTMLCanvasElement>(null);
  const rainRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const contours = contourRef.current;
    const rain = rainRef.current;
    if (!area || !contours || !rain) return;
    const { terrain, normalsUrl, flowUrl } = area;
    const { light, gain } = valleyLight(now, terrain.lat, terrain.lon);
    const paths = terrain.levels.map((level) => new Path2D(level.d));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let relief: ReturnType<typeof createRelief> = null;
    let flow: Flow | null = null;
    let cancelled = false;
    let frame = 0;
    let ink = "";
    const drops: Drop[] = [];

    function paint() {
      drawContours(contours!, terrain, paths);
      relief?.(light, gain, narrow);
      // A drop's path is in the old size's pixels.
      drops.length = 0;
      sizeCanvas(rain!, rain!.clientWidth, rain!.clientHeight);
      ink = getComputedStyle(document.documentElement).getPropertyValue(
        "--color-text",
      );
      setDrawn(true);
    }

    function addDrop(x: number, y: number) {
      if (!flow) return;
      const { s, ox, oy } = cover(
        rain!.clientWidth,
        rain!.clientHeight,
        flow.w,
        flow.h,
      );
      const cells = traceDownhill(
        flow.dir,
        flow.w,
        flow.h,
        Math.floor((x - ox) / s),
        Math.floor((y - oy) / s),
      );
      if (cells.length < 3) return;
      const now = performance.now();
      const age = (d: Drop) => (now - d.born) / 1000;
      const running = drops.filter((d) => age(d) < d.ends - SOAK);
      if (running.length >= MAX_DROPS) running[0].ends = age(running[0]) + SOAK;
      drops.push({
        ...dropPath(flow, cells, s, ox, oy),
        born: now,
        ends: LIFE,
      });
      if (!frame) frame = requestAnimationFrame(step);
    }

    function step(time: number) {
      const ctx = rain!.getContext("2d")!;
      const dpr = window.devicePixelRatio;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, rain!.width, rain!.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = ink;
      ctx.lineJoin = "round";
      const reach = SPEED * TRAIL;
      for (let d = drops.length - 1; d >= 0; d--) {
        const { points, along, width, alpha, born, ends } = drops[d];
        const age = (time - born) / 1000;
        const head = age * SPEED;
        const last = along.length - 1;
        if (age > ends || head - reach > along[last]) {
          drops.splice(d, 1);
          continue;
        }
        const soak = Math.min(1, (ends - age) / SOAK);
        let i = 0;
        while (i < last && along[i + 1] < head - reach) i++;
        for (; i < last && along[i] < head; i += RUN) {
          // A run starting just short of the trail's end is past it.
          const behind = Math.min(1, (head - along[i]) / reach);
          // Fades in over its first few px, out over the trail.
          ctx.globalAlpha =
            alpha[i] * (1 - behind) * Math.min(1, behind * 12) * soak;
          ctx.lineWidth = width[i];
          ctx.beginPath();
          ctx.moveTo(points[i * 2], points[i * 2 + 1]);
          const end = Math.min(i + RUN, last);
          for (let j = i + 1; j <= end && along[j - 1] < head; j++)
            ctx.lineTo(points[j * 2], points[j * 2 + 1]);
          ctx.stroke();
        }
      }
      frame = drops.length ? requestAnimationFrame(step) : 0;
    }

    // Rain falls only where the terrain is what the pointer is over: the card
    // stands above it, and the rain canvas is its top layer.
    let previous: { x: number; y: number } | null = null;
    let travelled = 0;
    function onMove(e: PointerEvent) {
      if (e.target !== rain) {
        previous = null;
        return;
      }
      if (previous)
        travelled += Math.hypot(e.clientX - previous.x, e.clientY - previous.y);
      previous = { x: e.clientX, y: e.clientY };
      if (travelled < DROP_EVERY) return;
      travelled = 0;
      addDrop(e.clientX, e.clientY);
    }
    function onDown(e: PointerEvent) {
      if (e.target === rain) addDrop(e.clientX, e.clientY);
    }

    const image = new Image();
    image.src = normalsUrl;
    image
      .decode()
      .then(() => {
        if (cancelled || !reliefRef.current) return;
        relief = createRelief(reliefRef.current, image);
        paint();
      })
      .catch(() => {
        // No relief: the contours are still drawn.
      });
    // The still version is the relief alone.
    if (!still)
      loadFlow(flowUrl)
        .then((loaded) => {
          if (!cancelled) flow = loaded;
        })
        .catch(() => {
          // No drainage: no rain.
        });
    paint();

    const observer = new ResizeObserver(paint);
    observer.observe(contours);
    window.addEventListener("logjam-theme-change", paint);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("logjam-theme-change", paint);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [area, now, narrow]);

  return (
    <>
      <div
        className={`${classes.terrain} ${drawn ? classes.drawn : ""}`}
        aria-hidden="true"
      >
        <canvas ref={reliefRef} className={classes.layer} />
        <canvas ref={contourRef} className={classes.layer} />
        <canvas ref={rainRef} className={classes.layer} />
      </div>
      {area && (
        <p className={classes.credit}>
          {area.terrain.name}. {NSW_5M.credit}
        </p>
      )}
    </>
  );
}

export default SignInTerrain;
