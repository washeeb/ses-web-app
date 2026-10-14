/* eslint-disable @typescript-eslint/no-unused-vars -- the drawing parts are shared with the KingsView app; not every part is used here. */
// Synclytics starter illustrations: flat vector drawings in the brand navy and teal for slides, service areas and
// store categories. They contain no text, people or real brands (product photos stay real photos).
// Writes the SVG sources to assets/illustrations and web copies (WebP 320/800/1600) plus a manifest to
// assets/starter-images, which `npm run images:starter` installs into the picture library. Slides and store
// categories use the 3D renders in assets/renders (scripts/blender/starter_3d.py) when they exist.
// Usage: npm run images:build    (shared drawing parts with the KingsView app; palette and scenes are Synclytics')
import sharp from "sharp";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const W = 1200;
const H = 800;
// Names kept from the shared drawing code: RED/RED2 are the accent (Synclytics teal), INK the device bodies.
const RED = "#00a6a6";
const RED2 = "#19c3c3";
const INK = "#1b2638";
const INK2 = "#2a3850";
const STEEL = "#4b5a72";
const GREY = "#d3dbe7";
const LIGHT = "#e8eef7";
const WHITE = "#ffffff";
const NAVY = "#0b3a82";
const NAVY2 = "#062c66";
const THEMES = {
  light: { bg: "#f3f6fb", glow: "#d6e2f5", dots: "#dfe6f1", floor: "rgba(6,44,102,0.10)" },
  dark: { bg: "#001a40", glow: "#0b4a8f", dots: "#0a2a58", floor: "rgba(0,0,0,0.40)" },
};

// ---------- primitives ----------
const rect = (x, y, w, h, fill, rx = 0, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
const circle = (cx, cy, r, fill, extra = "") => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" ${extra}/>`;
const ellipse = (cx, cy, rx, ry, fill) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`;
const path_ = (d, fill, extra = "") => `<path d="${d}" fill="${fill}" ${extra}/>`;
const line = (x1, y1, x2, y2, stroke, w = 4, extra = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" ${extra}/>`;
const at = (x, y, s, ...kids) => `<g transform="translate(${x} ${y}) scale(${s})">${kids.join("")}</g>`;
const rot = (deg, cx, cy, ...kids) => `<g transform="rotate(${deg} ${cx} ${cy})">${kids.join("")}</g>`;
/** Text-like bars (no real text in the pictures). */
const bars = (x, y, widths, fill, h = 10, gap = 18) => widths.map((w, i) => rect(x, y + i * gap, w, h, fill, h / 2)).join("");

// ---------- objects (drawn at their own origin) ----------
function browser(w, h) {
  return [
    rect(10, 14, w, h, "rgba(0,0,0,0.12)", 18),
    rect(0, 0, w, h, WHITE, 18),
    path_(`M18 0 H${w - 18} Q${w} 0 ${w} 18 V46 H0 V18 Q0 0 18 0 Z`, INK),
    circle(26, 23, 7, RED2),
    circle(48, 23, 7, "#8a8a8a"),
    circle(70, 23, 7, "#8a8a8a"),
    rect(100, 13, w - 130, 20, INK2, 10),
    rect(28, 72, w - 56, h * 0.34, "#dcebf5", 12),
    rect(52, 100, w * 0.32, 18, RED, 9),
    bars(52, 132, [w * 0.42, w * 0.36], "#b9c6d6", 10),
    rect(52, 72 + h * 0.34 - 52, 120, 30, RED, 15),
    path_(`M${w - 210} ${72 + h * 0.34} l70 -96 l46 56 l30 -36 l64 76 Z`, "#bfe0e6"),
    circle(w - 96, 112, 18, "#bfe0e6"),
    ...[0, 1, 2].map((i) => {
      const cw = (w - 56 - 40) / 3;
      const x = 28 + i * (cw + 20);
      const y = 92 + h * 0.34;
      return rect(x, y, cw, h - y - 26, LIGHT, 12) + rect(x + 16, y + 16, 34, 34, i === 1 ? RED : INK, 8) + bars(x + 16, y + 66, [cw * 0.7, cw * 0.5], GREY, 9, 16);
    }),
  ].join("");
}

function codePanel(w, h) {
  const rows = [
    [[0, 60, RED2], [70, 90, "#9a9a9a"]],
    [[24, 110, "#e8e8e8"], [144, 40, RED2]],
    [[24, 70, "#9a9a9a"], [104, 120, "#e8e8e8"]],
    [[48, 90, RED2], [148, 60, "#9a9a9a"]],
    [[48, 140, "#e8e8e8"]],
    [[24, 50, "#9a9a9a"], [84, 80, RED2]],
    [[0, 40, "#e8e8e8"]],
  ];
  return [
    rect(10, 14, w, h, "rgba(0,0,0,0.18)", 16),
    rect(0, 0, w, h, INK, 16),
    circle(22, 22, 6, RED2),
    circle(42, 22, 6, "#5c5c5c"),
    circle(62, 22, 6, "#5c5c5c"),
    ...rows.map((segs, i) => segs.map(([x, sw, c]) => rect(26 + x, 54 + i * 26, sw, 10, c, 5)).join("")),
  ].join("");
}

function phone(h, screen = "app") {
  const w = h * 0.5;
  const inner =
    screen === "app"
      ? rect(14, 40, w - 28, h * 0.26, "#dcebf5", 10) + rect(24, 52, w * 0.4, 12, RED, 6) + bars(24, 74, [w * 0.55, w * 0.45], "#b9c6d6", 8, 14) +
        [0, 1, 2].map((i) => rect(14, 50 + h * 0.26 + i * (h * 0.15), w - 28, h * 0.12, LIGHT, 10) + rect(24, 60 + h * 0.26 + i * (h * 0.15), 26, 26, i === 0 ? RED : INK, 7)).join("")
      : screen;
  return [rect(8, 12, w, h, "rgba(0,0,0,0.15)", 26), rect(0, 0, w, h, INK, 26), rect(8, 10, w - 16, h - 20, WHITE, 20), inner, rect(w / 2 - 22, 18, 44, 8, INK, 4)].join("");
}

function laptop(w, screen = "") {
  const h = w * 0.62;
  return [
    ellipse(w / 2, h + 34, w * 0.62, 16, "rgba(0,0,0,0.10)"),
    rect(0, 0, w, h, INK, 16),
    rect(14, 14, w - 28, h - 28, WHITE, 6),
    screen,
    path_(`M${-w * 0.08} ${h} H${w * 1.08} L${w * 1.02} ${h + 26} Q${w} ${h + 32} ${w * 0.96} ${h + 32} H${w * 0.04} Q0 ${h + 32} ${-w * 0.02} ${h + 26} Z`, "#3a3a3a"),
    rect(w * 0.42, h, w * 0.16, 8, "#555", 4),
  ].join("");
}

function dashboardScreen(x, y, w, h) {
  const bw = (w - 70) / 6;
  return [
    rect(x, y, w, h, WHITE),
    rect(x + 16, y + 16, w * 0.3, 12, INK, 6),
    ...[0.45, 0.7, 0.5, 0.9, 0.65, 0.8].map((v, i) => rect(x + 20 + i * (bw + 6), y + h - 20 - (h - 70) * v, bw, (h - 70) * v, i === 3 ? RED : i % 2 ? INK2 : "#bdbdbd", 4)),
  ].join("");
}

function monitor(w, screen) {
  const h = w * 0.6;
  return [
    rect(w / 2 - 14, h, 28, 70, "#3a3a3a"),
    ellipse(w / 2, h + 74, w * 0.24, 12, "#2b2b2b"),
    rect(0, 0, w, h, INK, 14),
    rect(12, 12, w - 24, h - 24, "#0f0f0f", 4),
    screen,
  ].join("");
}

/** 2×2 camera feed grid inside a monitor screen. */
function feeds(x, y, w, h) {
  const cw = (w - 8) / 2;
  const ch = (h - 8) / 2;
  const tile = (tx, ty, i) =>
    rect(tx, ty, cw, ch, ["#3b4148", "#454b43", "#4a4340", "#3e4550"][i]) +
    path_(`M${tx} ${ty + ch} l${cw * 0.3} ${-ch * 0.45} l${cw * 0.2} ${ch * 0.2} l${cw * 0.25} ${-ch * 0.35} l${cw * 0.25} ${ch * 0.6} Z`, "rgba(255,255,255,0.18)") +
    circle(tx + 12, ty + 12, 5, i === 0 ? RED2 : "rgba(255,255,255,0.5)");
  return [tile(x, y, 0), tile(x + cw + 8, y, 1), tile(x, y + ch + 8, 2), tile(x + cw + 8, y + ch + 8, 3)].join("");
}

function bulletCamera(s = 1) {
  return at(0, 0, s, [
    rect(-20, -60, 40, 120, "#cfcac4", 8),
    rect(-6, -14, 70, 26, "#bdb7b0", 8),
    rot(-12, 60, 0,
      rect(40, -48, 230, 96, WHITE, 40),
      rect(40, -48, 230, 30, "#f0eeec", 15),
      path_("M230 -58 H300 Q312 -58 312 -46 V-36 H218 Z", INK2),
      rect(250, -40, 30, 80, INK, 14),
      circle(266, 0, 26, "#111"),
      circle(266, 0, 15, "#2c3e50"),
      circle(260, -6, 5, "rgba(255,255,255,0.7)"),
      circle(110, -24, 6, RED2),
    ),
  ].join(""));
}

function domeCamera(s = 1) {
  return at(0, 0, s, [
    ellipse(0, 6, 110, 22, "#cfcac4"),
    rect(-110, -8, 220, 18, WHITE, 9),
    path_("M-82 10 A82 82 0 0 0 82 10 Z", "#2a2a2a"),
    path_("M-82 10 A82 82 0 0 0 82 10 Z", "rgba(255,255,255,0.08)"),
    circle(0, 46, 28, "#111"),
    circle(0, 46, 16, "#2c3e50"),
    circle(-6, 40, 5, "rgba(255,255,255,0.7)"),
    path_("M-60 22 Q-40 60 -10 74", "none", `stroke="rgba(255,255,255,0.18)" stroke-width="6" stroke-linecap="round"`),
  ].join(""));
}

function router(s = 1) {
  return at(0, 0, s, [
    ellipse(150, 118, 170, 14, "rgba(0,0,0,0.12)"),
    rot(-14, 40, 30, rect(34, -120, 14, 150, INK2, 7)),
    rot(14, 260, 30, rect(252, -120, 14, 150, INK2, 7)),
    rect(150 - 7, -100, 14, 130, INK2, 7),
    path_("M0 40 Q0 20 20 20 H280 Q300 20 300 40 V92 Q300 110 282 110 H18 Q0 110 0 92 Z", INK),
    rect(0, 20, 300, 26, "#2e2e2e", 18),
    ...[0, 1, 2, 3, 4].map((i) => circle(52 + i * 28, 80, 6, i < 3 ? "#3cc46a" : i === 3 ? RED2 : "#555")),
    rect(210, 70, 66, 18, "#2e2e2e", 6),
  ].join(""));
}

function rackSwitch(s = 1, ports = 12) {
  const w = 40 + ports * 30;
  return at(0, 0, s, [
    rect(0, 0, w, 64, INK, 8),
    rect(8, 8, w - 16, 48, "#2a2a2a", 5),
    ...Array.from({ length: ports }, (_, i) => rect(20 + i * 30, 18, 22, 18, "#111", 3) + circle(31 + i * 30, 46, 3, i % 4 === 3 ? RED2 : "#3cc46a")),
  ].join(""));
}

function cable(d, color = RED, w = 10) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
}

function printer(s = 1) {
  return at(0, 0, s, [
    rect(70, -90, 260, 120, WHITE, 6, `stroke="${GREY}" stroke-width="4"`),
    bars(100, -60, [150, 190, 120], "#d8d3ce", 12, 22),
    rect(0, 0, 400, 170, "#2f2f2f", 26),
    rect(0, 0, 400, 60, "#3d3d3d", 26),
    rect(300, 22, 70, 18, "#1a1a1a", 6),
    circle(318, 31, 5, "#3cc46a"),
    circle(338, 31, 5, RED2),
    rect(40, 110, 320, 22, "#1a1a1a", 6),
    rect(60, 120, 280, 120, WHITE, 6),
    rect(84, 140, 96, 70, RED, 6),
    bars(196, 144, [120, 96, 110], "#c9c4bf", 10, 20),
    rect(-20, 160, 440, 20, "#262626", 10),
  ].join(""));
}

function inkDrops(s = 1) {
  const drop = (x, c) => path_(`M${x} 0 C${x + 26} 34 ${x + 34} 52 ${x + 34} 66 A34 34 0 0 1 ${x - 34} 66 C${x - 34} 52 ${x - 26} 34 ${x} 0 Z`, c);
  return at(0, 0, s, [drop(0, "#1fa3c9"), drop(84, "#d6247a"), drop(168, "#f2c230"), drop(252, INK)].join(""));
}

function dslr(s = 1) {
  return at(0, 0, s, [
    ellipse(160, 230, 190, 16, "rgba(0,0,0,0.12)"),
    path_("M20 60 Q20 40 40 40 H96 L116 8 H210 L230 40 H290 Q310 40 310 60 V200 Q310 220 290 220 H40 Q20 220 20 200 Z", INK),
    rect(20, 80, 290, 110, "#2a2a2a"),
    rect(250, 52, 40, 16, "#3a3a3a", 6),
    circle(66, 56, 10, RED2),
    circle(165, 132, 82, "#3a3a3a"),
    circle(165, 132, 64, "#111"),
    circle(165, 132, 44, "#26394a"),
    circle(165, 132, 22, "#0d1620"),
    circle(148, 114, 10, "rgba(255,255,255,0.6)"),
    rect(140, 12, 50, 14, "#3a3a3a", 4),
  ].join(""));
}

function videoCamOnTripod(s = 1) {
  return at(0, 0, s, [
    line(130, 170, 40, 420, INK2, 12),
    line(150, 170, 150, 430, INK2, 12),
    line(170, 170, 260, 420, INK2, 12),
    rect(110, 150, 80, 30, "#3a3a3a", 8),
    rect(40, 40, 200, 110, INK, 18),
    rect(240, 62, 70, 66, "#2a2a2a", 12),
    circle(310, 95, 40, "#3a3a3a"),
    circle(310, 95, 26, "#26394a"),
    circle(302, 87, 7, "rgba(255,255,255,0.55)"),
    rect(60, 10, 120, 34, "#2a2a2a", 10),
    circle(76, 70, 8, RED2),
    rect(70, 96, 120, 30, "#3a3a3a", 6),
  ].join(""));
}

function softbox(s = 1) {
  return at(0, 0, s, [
    line(100, 200, 100, 460, INK2, 10),
    line(100, 440, 40, 500, INK2, 10),
    line(100, 440, 160, 500, INK2, 10),
    path_("M0 0 H200 L170 200 H30 Z", INK2),
    path_("M16 14 H184 L158 186 H42 Z", "#fff6e8"),
    path_("M16 14 H184 L158 186 H42 Z", "url(#warm)"),
  ].join(""));
}

function ream(s = 1) {
  return at(0, 0, s, [
    rect(0, 0, 260, 120, WHITE, 6, `stroke="${GREY}" stroke-width="3"`),
    ...[0, 1, 2, 3, 4].map((i) => line(8, 22 + i * 20, 252, 22 + i * 20, "#e9e6e2", 3)),
    rect(0, 40, 260, 50, RED),
    rect(90, 52, 80, 26, WHITE, 4),
  ].join(""));
}

function binder(s = 1, color = INK) {
  return at(0, 0, s, [
    rect(0, 0, 90, 300, color, 8),
    rect(0, 0, 90, 300, "rgba(255,255,255,0.06)", 8),
    rect(18, 40, 54, 80, WHITE, 4),
    bars(28, 56, [34, 26, 30], GREY, 7, 14),
    circle(45, 240, 14, "rgba(255,255,255,0.85)"),
    circle(45, 240, 7, color),
  ].join(""));
}

function penCup(s = 1) {
  return at(0, 0, s, [
    rot(-14, 50, 0, rect(30, -150, 16, 170, RED, 8), path_("M30 -150 L38 -176 L46 -150 Z", "#f2d2a9")),
    rot(8, 80, 0, rect(70, -170, 16, 190, INK2, 8)),
    rot(20, 110, 0, rect(100, -130, 14, 150, "#f2c230", 7)),
    rect(16, 0, 130, 140, STEEL, 14),
    rect(16, 0, 130, 22, "#5c5c5c", 11),
    rect(30, 40, 16, 84, "rgba(255,255,255,0.12)", 8),
  ].join(""));
}

function stapler(s = 1) {
  return at(0, 0, s, [
    ellipse(130, 92, 140, 10, "rgba(0,0,0,0.10)"),
    rect(0, 64, 260, 24, INK2, 12),
    path_("M10 60 Q10 18 60 14 L250 30 Q262 32 262 44 V58 Q262 66 254 66 H18 Q10 66 10 60 Z", RED),
    rect(20, 26, 230, 10, "rgba(255,255,255,0.18)", 5),
  ].join(""));
}

function notebook(s = 1) {
  return at(0, 0, s, [
    rect(8, 10, 200, 260, "rgba(0,0,0,0.10)", 10),
    rect(0, 0, 200, 260, INK, 10),
    rect(160, 0, 14, 260, RED),
    rect(30, 40, 110, 40, "rgba(255,255,255,0.14)", 6),
  ].join(""));
}

function tshirt(s = 1, color = RED, mark = WHITE) {
  return at(0, 0, s, [
    path_("M80 0 Q130 34 180 0 L260 34 L300 120 L240 146 L224 118 V330 H36 V118 L20 146 L-40 120 L0 34 Z", color),
    path_("M80 0 Q130 34 180 0 L172 -2 Q130 22 88 -2 Z", "rgba(0,0,0,0.25)"),
    path_("M36 118 L20 146 L-40 120 L-30 96 Z", "rgba(0,0,0,0.12)"),
    path_("M224 118 L240 146 L300 120 L290 96 Z", "rgba(0,0,0,0.12)"),
    circle(130, 120, 34, mark),
    circle(130, 120, 16, color),
  ].join(""));
}

function mug(s = 1, color = WHITE, band = RED) {
  return at(0, 0, s, [
    ellipse(80, 182, 100, 12, "rgba(0,0,0,0.12)"),
    path_("M150 40 Q214 40 214 96 Q214 150 150 150", "none", `stroke="${color === WHITE ? "#e2ded9" : color}" stroke-width="22"`),
    rect(0, 0, 160, 180, color, 16, color === WHITE ? `stroke="${GREY}" stroke-width="3"` : ""),
    rect(0, 64, 160, 54, band),
    circle(80, 91, 16, WHITE),
    ellipse(80, 4, 80, 10, "#2a2a2a"),
  ].join(""));
}

function cap(s = 1) {
  return at(0, 0, s, [
    path_("M10 120 Q10 0 130 0 Q250 0 250 120 Z", INK),
    path_("M130 0 Q160 60 160 120 H140 Q140 60 130 0 Z", "rgba(255,255,255,0.08)"),
    path_("M200 108 Q300 104 340 128 Q300 146 220 140 Z", "#111"),
    circle(130, 2, 10, RED),
    circle(80, 70, 22, RED),
    rect(10, 110, 240, 14, "#111", 7),
  ].join(""));
}

function tote(s = 1) {
  return at(0, 0, s, [
    path_("M50 70 Q50 0 100 0 Q150 0 150 70", "none", `stroke="#cbbfae" stroke-width="12"`),
    rect(0, 60, 200, 230, "#efe6d8", 6),
    circle(100, 170, 40, RED),
    circle(100, 170, 18, "#efe6d8"),
  ].join(""));
}

function swatches(s = 1) {
  const sw = (deg, c) => rot(deg, 30, 260, rect(0, 0, 60, 260, WHITE, 10, `stroke="${GREY}" stroke-width="3"`), rect(6, 6, 48, 160, c, 6), circle(30, 230, 9, GREY));
  return at(0, 0, s, [sw(-40, INK), sw(-20, "#7a7a7a"), sw(0, RED2), sw(20, RED)].join(""));
}

function megaphone(s = 1) {
  return at(0, 0, s, [
    path_("M40 70 L230 0 V200 L40 130 Z", RED),
    path_("M40 70 L230 0 V40 L40 92 Z", "rgba(255,255,255,0.15)"),
    rect(0, 64, 60, 72, INK, 12),
    rect(222, -6, 30, 212, INK, 14),
    path_("M70 132 L110 146 L96 210 Q92 222 80 220 L64 216 Q54 212 56 200 Z", INK2),
    ...[0, 1, 2].map((i) => path_(`M${280 + i * 34} ${40 - i * 20} Q${310 + i * 40} 100 ${280 + i * 34} ${160 + i * 20}`, "none", `stroke="${i === 1 ? RED2 : INK2}" stroke-width="10" stroke-linecap="round"`)),
  ].join(""));
}

function penTool(s = 1) {
  return at(0, 0, s, [
    path_("M0 200 C120 -40 280 -40 400 200", "none", `stroke="${INK}" stroke-width="6"`),
    line(0, 200, 120, 60, "#9a958f", 3, `stroke-dasharray="8 8"`),
    line(400, 200, 280, 60, "#9a958f", 3, `stroke-dasharray="8 8"`),
    rect(-12, 188, 24, 24, WHITE, 3, `stroke="${INK}" stroke-width="5"`),
    rect(388, 188, 24, 24, WHITE, 3, `stroke="${INK}" stroke-width="5"`),
    circle(120, 60, 11, RED),
    circle(280, 60, 11, RED),
  ].join(""));
}

function businessCard(s = 1, dark = false) {
  return at(0, 0, s, [
    rect(8, 10, 300, 170, "rgba(0,0,0,0.12)", 12),
    rect(0, 0, 300, 170, dark ? INK : WHITE, 12),
    circle(60, 62, 30, RED),
    circle(60, 62, 13, dark ? INK : WHITE),
    bars(110, 46, [140, 100], dark ? "#5a5a5a" : GREY, 12, 24),
    bars(30, 120, [180, 130], dark ? "#3c3c3c" : LIGHT, 9, 18),
  ].join(""));
}

function screenBoard(s = 1) {
  return at(0, 0, s, [
    rect(0, 0, 460, 300, WHITE, 10, `stroke="${GREY}" stroke-width="4"`),
    rect(0, 0, 460, 24, INK, 10),
    rect(36, 60, 150, 14, INK, 7),
    bars(36, 92, [130, 110, 140], GREY, 10, 22),
    ...[0.4, 0.6, 0.5, 0.85].map((v, i) => rect(240 + i * 46, 250 - 180 * v, 32, 180 * v, i === 3 ? RED : i % 2 ? INK2 : "#bdbdbd", 5)),
    path_("M36 250 Q90 200 130 220 T 200 160", "none", `stroke="${RED}" stroke-width="6" stroke-linecap="round"`),
    line(230, 300, 200, 420, INK2, 10),
    line(230, 300, 260, 420, INK2, 10),
  ].join(""));
}

function chair(s = 1) {
  return at(0, 0, s, [
    rect(10, 0, 100, 90, INK2, 16),
    rect(0, 96, 120, 26, INK, 13),
    line(60, 122, 60, 170, "#555", 10),
    line(20, 180, 100, 180, "#555", 10),
  ].join(""));
}

function mouse(s = 1) {
  return at(0, 0, s, [rect(0, 0, 70, 110, INK2, 35), line(35, 8, 35, 40, "#555", 4), rect(30, 16, 10, 18, RED2, 5)].join(""));
}

function keyboard(s = 1) {
  return at(0, 0, s, [
    rect(0, 0, 380, 110, INK, 14),
    ...Array.from({ length: 3 }, (_, r) => Array.from({ length: 12 }, (_, c) => rect(14 + c * 30, 14 + r * 28, 24, 22, "#333", 4)).join("")),
    rect(90, 98 - 14, 200, 14, "#333", 4),
  ].join(""));
}

function cloud(x, y, s, fill) {
  return at(x, y, s, path_("M40 100 Q0 100 0 66 Q0 34 34 30 Q44 0 84 0 Q122 0 132 32 Q170 30 176 64 Q180 100 140 100 Z", fill));
}

/** Little "connection" nodes for network scenes. */
function nodes(points, color) {
  const lines = points.slice(1).map(([x, y]) => line(points[0][0], points[0][1], x, y, color, 4, `stroke-dasharray="2 12"`)).join("");
  return lines + points.map(([x, y], i) => circle(x, y, i === 0 ? 14 : 10, i === 0 ? RED : color)).join("");
}

// ---------- Synclytics objects ----------
function serverRack(s = 1, units = 7) {
  const h = 40 + units * 44;
  return at(0, 0, s, [
    ellipse(80, h + 8, 100, 10, "rgba(0,0,0,0.12)"),
    rect(0, 0, 160, h, INK, 10, `stroke="#4a6390" stroke-width="3"`),
    rect(10, 10, 140, h - 20, "#111a2b", 6),
    ...Array.from({ length: units }, (_, i) => {
      const y = 20 + i * 44;
      return rect(18, y, 124, 34, "#24324a", 4) + circle(32, y + 17, 4, i % 3 === 0 ? RED2 : "#3cc46a") + circle(46, y + 17, 4, "#3cc46a") + rect(60, y + 13, 70, 8, "#37496a", 4);
    }),
  ].join(""));
}

function shield(s = 1, fill = NAVY, mark = "check") {
  const inner = mark === "check" ? path_("M70 120 l34 34 l66 -72", "none", `stroke="${WHITE}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"`) : at(66, 50, 0.9, padlock(1, WHITE, fill));
  return at(0, 0, s, [
    path_("M120 0 L240 40 V130 C240 210 180 260 120 290 C60 260 0 210 0 130 V40 Z", "rgba(0,0,0,0.12)", `transform="translate(10 12)"`),
    path_("M120 0 L240 40 V130 C240 210 180 260 120 290 C60 260 0 210 0 130 V40 Z", fill),
    path_("M120 0 L240 40 V130 C240 210 180 260 120 290 Z", "rgba(255,255,255,0.08)"),
    inner,
  ].join(""));
}

function padlock(s = 1, body = RED, hole = INK) {
  return at(0, 0, s, [
    path_("M20 70 V44 A40 40 0 0 1 100 44 V70", "none", `stroke="${body === WHITE ? "#e3e9f2" : STEEL}" stroke-width="14"`),
    rect(0, 64, 120, 100, body, 14),
    circle(60, 104, 13, hole),
    rect(55, 108, 10, 30, hole, 5),
  ].join(""));
}

function database(s = 1, color = NAVY) {
  const disk = (y) => ellipse(90, y, 90, 26, color) + rect(0, y, 180, 50, color) + ellipse(90, y + 50, 90, 26, "rgba(0,0,0,0.18)");
  return at(0, 0, s, [
    ellipse(90, 200, 110, 14, "rgba(0,0,0,0.12)"),
    disk(120), disk(70), disk(20),
    ellipse(90, 20, 90, 26, "#3b6cb3"),
    circle(150, 95, 6, "#3cc46a"), circle(150, 145, 6, RED2),
  ].join(""));
}

function tower(s = 1, steel = INK2) {
  return at(0, 0, s, [
    path_("M90 0 L40 420 M90 0 L140 420", "none", `stroke="${steel}" stroke-width="10"`),
    ...[90, 180, 270, 360].map((y) => line(90 - (y / 420) * 50, y, 90 + (y / 420) * 50, y, steel, 6)),
    ...[90, 180, 270].map((y) => line(90 - (y / 420) * 50, y, 90 + ((y + 90) / 420) * 50, y + 90, steel, 4)),
    rect(76, 30, 28, 60, STEEL, 6),
    ...[0, 1, 2].map((i) => path_(`M${130 + i * 26} ${-10 - i * 14} Q${160 + i * 34} 50 ${130 + i * 26} ${110 + i * 14}`, "none", `stroke="${i === 1 ? RED : RED2}" stroke-width="8" stroke-linecap="round"`)),
    ...[0, 1, 2].map((i) => path_(`M${50 - i * 26} ${-10 - i * 14} Q${20 - i * 34} 50 ${50 - i * 26} ${110 + i * 14}`, "none", `stroke="${i === 1 ? RED : RED2}" stroke-width="8" stroke-linecap="round"`)),
  ].join(""));
}

function clipboard(s = 1) {
  return at(0, 0, s, [
    rect(10, 14, 240, 320, "rgba(0,0,0,0.12)", 16),
    rect(0, 0, 240, 320, NAVY2, 16),
    rect(16, 30, 208, 276, WHITE, 8),
    rect(80, -14, 80, 40, STEEL, 10),
    ...[0, 1, 2, 3].map((i) => {
      const y = 64 + i * 60;
      const done = i < 3;
      return rect(36, y, 30, 30, done ? RED : LIGHT, 6) + (done ? path_(`M43 ${y + 15} l7 7 l12 -14`, "none", `stroke="${WHITE}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`) : "") + bars(80, y + 4, [120, 80], GREY, 9, 15);
    }),
  ].join(""));
}

function magnifier(s = 1) {
  return at(0, 0, s, [
    line(110, 110, 190, 190, INK, 26),
    circle(70, 70, 70, INK),
    circle(70, 70, 52, "#dff3f3"),
    path_("M40 60 A34 34 0 0 1 70 36", "none", `stroke="${WHITE}" stroke-width="8" stroke-linecap="round"`),
  ].join(""));
}

function posTerminal(s = 1) {
  return at(0, 0, s, [
    rect(8, 12, 170, 290, "rgba(0,0,0,0.12)", 22),
    rect(0, 0, 170, 290, INK, 22),
    rect(16, 18, 138, 96, "#dff3f3", 8),
    rect(30, 34, 70, 12, NAVY, 6),
    rect(30, 60, 100, 22, RED, 6),
    ...Array.from({ length: 9 }, (_, i) => rect(22 + (i % 3) * 44, 130 + Math.floor(i / 3) * 40, 36, 30, "#2a3850", 6)),
    rect(22, 252, 124, 26, RED, 8),
  ].join(""));
}

function paymentCard(s = 1, color = NAVY) {
  return at(0, 0, s, [
    rect(8, 10, 300, 186, "rgba(0,0,0,0.14)", 18),
    rect(0, 0, 300, 186, color, 18),
    rect(0, 40, 300, 30, "rgba(0,0,0,0.25)"),
    rect(26, 96, 46, 34, "#e8c56a", 6),
    bars(26, 148, [180], "rgba(255,255,255,0.55)", 12),
    circle(244, 150, 20, RED2), circle(266, 150, 20, "rgba(255,255,255,0.6)"),
  ].join(""));
}

/** A phone showing a confirmed mobile money payment (no text, just shapes). */
function momoScreen(h) {
  const w = h * 0.5;
  return [rect(14, 40, w - 28, h * 0.3, "#dff3f3", 10), circle(w / 2, 40 + h * 0.15, h * 0.08, RED), path_(`M${w / 2 - h * 0.04} ${40 + h * 0.15} l${h * 0.03} ${h * 0.03} l${h * 0.05} -${h * 0.06}`, "none", `stroke="${WHITE}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"`), bars(24, 60 + h * 0.32, [w * 0.6, w * 0.4], GREY, 9, 18), rect(24, h - 90, w - 48, 34, NAVY, 10)].join("");
}

function monitorWall(s = 1) {
  const screen = (x, y, kind) => {
    const base = rect(x, y, 220, 140, INK, 10) + rect(x + 8, y + 8, 204, 124, "#0d1a2e", 4);
    if (kind === "chart") return base + [0.4, 0.7, 0.5, 0.9, 0.6].map((v, i) => rect(x + 24 + i * 36, y + 120 - 90 * v, 22, 90 * v, i === 3 ? RED : "#37496a", 3)).join("");
    if (kind === "map") return base + path_(`M${x + 20} ${y + 100} l40 -40 l40 20 l40 -50 l60 60`, "none", `stroke="${RED}" stroke-width="5"`) + circle(x + 160, y + 50, 8, RED2);
    if (kind === "alert") return base + circle(x + 110, y + 70, 34, RED) + rect(x + 105, y + 48, 10, 30, WHITE, 5) + circle(x + 110, y + 90, 6, WHITE);
    return base + bars(x + 24, y + 30, [150, 120, 160, 100], "#37496a", 10, 22);
  };
  return at(0, 0, s, [screen(0, 0, "chart"), screen(236, 0, "alert"), screen(0, 156, "log"), screen(236, 156, "map"), rect(200, 296, 56, 60, STEEL), rect(150, 352, 156, 14, INK2, 7)].join(""));
}

function documents(s = 1) {
  const sheet = (x, y, rotDeg) => rot(rotDeg, x + 100, y + 130, rect(x + 6, y + 8, 200, 260, "rgba(0,0,0,0.10)", 8), rect(x, y, 200, 260, WHITE, 8, `stroke="${GREY}" stroke-width="3"`), rect(x + 24, y + 28, 90, 14, NAVY, 7), bars(x + 24, y + 62, [150, 130, 150, 110, 140, 90], GREY, 9, 22));
  return at(0, 0, s, [sheet(0, 10, -8), sheet(50, 0, 4)].join(""));
}

function licenseKey(s = 1) {
  return at(0, 0, s, [
    rect(8, 10, 280, 170, "rgba(0,0,0,0.12)", 14),
    rect(0, 0, 280, 170, WHITE, 14, `stroke="${GREY}" stroke-width="3"`),
    rect(0, 0, 280, 44, NAVY, 14), rect(0, 26, 280, 18, NAVY),
    ...[0, 1, 2, 3].map((i) => rect(20 + i * 64, 76, 52, 26, LIGHT, 6)),
    circle(60, 140, 16, "none", `stroke="${RED}" stroke-width="8"`), line(76, 140, 150, 140, RED, 8), line(130, 140, 130, 156, RED, 8),
  ].join(""));
}

function refreshArrows(s = 1, color = RED) {
  return at(0, 0, s, [
    path_("M110 30 A80 80 0 0 1 180 110", "none", `stroke="${color}" stroke-width="16" stroke-linecap="round"`),
    path_("M196 92 L180 128 L156 98 Z", color),
    path_("M70 190 A80 80 0 0 1 30 110", "none", `stroke="${color}" stroke-width="16" stroke-linecap="round"`),
    path_("M14 128 L30 92 L54 122 Z", color),
  ].join(""));
}

/** Connected hexagons for APIs / integration. */
function apiMesh(s = 1, color = RED, ends = NAVY) {
  const hex = (x, y, f) => path_(`M${x} ${y - 40} L${x + 35} ${y - 20} L${x + 35} ${y + 20} L${x} ${y + 40} L${x - 35} ${y + 20} L${x - 35} ${y - 20} Z`, f);
  const pts = [[0, 0], [110, -60], [110, 60], [220, 0]];
  return at(0, 0, s, [
    ...[[0, 1], [0, 2], [1, 3], [2, 3], [1, 2]].map(([a, b]) => line(pts[a][0], pts[a][1], pts[b][0], pts[b][1], "#9fb1cc", 5, `stroke-dasharray="2 10"`)),
    ...pts.map(([x, y], i) => hex(x, y, i === 0 || i === 3 ? ends : color)),
    ...pts.map(([x, y]) => circle(x, y, 10, WHITE)),
  ].join(""));
}

// ---------- scenes ----------
function frame(theme, body, { glowX = 600, glowY = 400, floorY = 640, floorW = 420 } = {}) {
  const t = THEMES[theme];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
<radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${t.glow}" stop-opacity="1"/><stop offset="1" stop-color="${t.glow}" stop-opacity="0"/></radialGradient>
<linearGradient id="warm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf7" stop-opacity="0.9"/><stop offset="1" stop-color="#ffe2b0" stop-opacity="0.6"/></linearGradient>
<pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="2" fill="${t.dots}"/></pattern>
</defs>
${rect(0, 0, W, H, t.bg)}
${rect(0, 0, W, H, "url(#dots)")}
${circle(glowX, glowY, 420, "url(#glow)")}
${ellipse(600, floorY, floorW, 26, t.floor)}
${body}
</svg>`;
}

const cloudFill = (theme) => (theme === "dark" ? "#1d4580" : WHITE);
// On the navy slide background, navy parts switch to lighter blues so they stay visible.
const navyOn = (theme) => (theme === "dark" ? "#2f6fc4" : NAVY);
const SCENES = {
  enterprise: (theme) =>
    frame(theme, [at(240, 170, 1, browser(560, 400)), at(820, 330, 0.9, database(1)), at(160, 360, 1, phone(270))].join("")),
  integration: (theme) =>
    frame(theme, [at(140, 220, 1, codePanel(300, 230)), at(760, 220, 1, codePanel(300, 230)), at(490, 340, 1, apiMesh(1, RED, navyOn(theme)))].join("")),
  infrastructure: (theme) =>
    frame(theme, [cloud(500, 120, 1.2, cloudFill(theme)), nodes([[608, 250], [330, 330], [880, 330]], theme === "dark" ? "#3a5a8a" : "#9fb1cc"), at(250, 300, 1, serverRack(1, 7)), at(800, 300, 1, serverRack(1, 7)), at(470, 330, 0.9, database(1, navyOn(theme)))].join(""), { floorY: 660 }),
  telecoms: (theme) =>
    frame(theme, [at(240, 150, 1, tower(1, theme === "dark" ? "#7d9bd0" : INK2)), at(560, 410, 1, router(1)), cable("M600 520 C560 600 760 600 840 540"), at(820, 380, 1, laptop(240, dashboardScreen(14, 14, 212, 121)))].join(""), { floorY: 600 }),
  security: (theme) =>
    frame(theme, [at(470, 170, 1.05, shield(1, theme === "dark" ? RED : NAVY)), at(210, 300, 1, serverRack(1, 6)), at(850, 330, 0.9, database(1, navyOn(theme))), at(800, 200, 0.6, refreshArrows(1))].join(""), { floorY: 640 }),
  hardware: (theme) =>
    frame(theme, [at(180, 250, 1, laptop(380, dashboardScreen(14, 14, 352, 208))), at(700, 230, 1, serverRack(1, 7)), at(880, 470, 0.8, licenseKey(1))].join(""), { floorY: 640 }),
  data: (theme) =>
    frame(theme, [at(190, 170, 1, monitor(460, dashboardScreen(12, 12, 436, 252))), at(760, 300, 1, database(1)), at(900, 180, 0.8, magnifier(1))].join(""), { floorY: 640 }),
  assessment: (theme) =>
    frame(theme, [at(360, 200, 1.05, clipboard(1)), at(620, 330, 1.1, magnifier(1)), at(800, 240, 0.9, serverRack(1, 6))].join(""), { floorY: 640 }),
  soc: (theme) =>
    frame(theme, [at(300, 170, 1.05, monitorWall(1)), at(860, 260, 0.75, shield(1, RED))].join(""), { floorY: 640 }),
  protection: (theme) =>
    frame(theme, [at(250, 200, 1, documents(1)), at(640, 180, 1, shield(1, NAVY, "lock")), at(560, 430, 0.8, padlock(1))].join(""), { floorY: 650 }),
  payments: (theme) =>
    frame(theme, [at(250, 170, 1, phone(380, momoScreen(380))), at(560, 230, 1, posTerminal(1)), at(800, 330, 1, paymentCard(1))].join(""), { floorY: 620 }),
  daas: (theme) =>
    frame(theme, [at(170, 290, 1, laptop(300, dashboardScreen(14, 14, 272, 158))), at(560, 300, 0.9, laptop(300, dashboardScreen(14, 14, 272, 158))), at(900, 280, 1, phone(250)), at(470, 120, 0.8, refreshArrows(1))].join(""), { floorY: 640 }),
  networkingCat: (theme) =>
    frame(theme, [at(420, 300, 1.2, router(1)), at(330, 520, 1, rackSwitch(1, 14)), cable("M380 440 C300 480 300 560 350 560"), cable("M820 440 C900 480 900 560 820 560", INK2)].join(""), { floorY: 640 }),
  computingCat: (theme) =>
    frame(theme, [at(230, 250, 1, laptop(400, dashboardScreen(14, 14, 372, 220))), at(780, 220, 1, serverRack(1, 7))].join(""), { floorY: 640 }),
  softwareCat: (theme) =>
    frame(theme, [at(200, 170, 1, browser(520, 380)), at(760, 380, 1, licenseKey(1))].join(""), { floorY: 640 }),
  managedCat: (theme) =>
    frame(theme, [at(330, 200, 1, monitorWall(1)), at(880, 160, 0.6, refreshArrows(1))].join(""), { floorY: 640 }),
  professionalCat: (theme) =>
    frame(theme, [at(260, 200, 1, clipboard(1)), at(600, 330, 1, laptop(340, dashboardScreen(14, 14, 312, 182)))].join(""), { floorY: 650 }),
  securityCat: (theme) =>
    frame(theme, [at(300, 180, 1, shield(1, NAVY)), at(700, 300, 1.1, domeCamera(1)), at(660, 420, 0.8, padlock(1))].join(""), { floorY: 650 }),
  hero: (theme) =>
    frame(theme, [cloud(470, 90, 1, cloudFill(theme)), at(180, 300, 0.85, serverRack(1, 6)), at(400, 260, 0.9, laptop(330, dashboardScreen(14, 14, 302, 177))), at(820, 230, 0.7, shield(1, RED)), at(700, 480, 0.8, router(1))].join(""), { floorY: 660, floorW: 520 }),
};

// ---------- what goes where ----------
const SERVICE_ALT = {
  "enterprise-software": ["enterprise", "Illustration of a business system on screen, a phone app and a database"],
  "software-integration": ["integration", "Illustration of two code panels connected through APIs"],
  infrastructure: ["infrastructure", "Illustration of server racks, a database and a cloud connection"],
  "telecoms-networks": ["telecoms", "Illustration of a telecom mast, a router, cabling and a laptop"],
  "security-continuity": ["security", "Illustration of a security shield, a server rack and backups"],
  "hardware-licensing": ["hardware", "Illustration of a laptop, a server rack and a software licence"],
  "data-intelligence": ["data", "Illustration of a dashboard with charts, a database and a magnifying glass"],
  "readiness-assessments": ["assessment", "Illustration of a checklist, a magnifying glass and a server rack"],
  "managed-soc": ["soc", "Illustration of monitoring screens with an alert and a security shield"],
  "data-protection": ["protection", "Illustration of documents protected by a shield and a padlock"],
  "payments-integration": ["payments", "Illustration of a mobile money payment on a phone, a card terminal and a card"],
  "device-as-a-service": ["daas", "Illustration of laptops and a phone with a refresh cycle"],
};
const CATEGORY_ALT = {
  networking: ["networkingCat", "Illustration of a router and a network switch"],
  computing: ["computingCat", "Illustration of a laptop and a server rack"],
  software: ["softwareCat", "Illustration of a business application and a software licence"],
  "managed-services": ["managedCat", "Illustration of monitoring screens"],
  "professional-services": ["professionalCat", "Illustration of a checklist and a laptop"],
  security: ["securityCat", "Illustration of a security shield, a camera and a padlock"],
};
/** Store categories pictured by a 3D render (assets/renders/<name>.webp). */
const CATEGORY_3D = { networking: "networking-light", computing: "computing-light", software: "software-light", "managed-services": "managed-light", "professional-services": "professional-light", security: "security-light" };
/** Starter slides (available services only): wording is a draft for Synclytics to edit in operations. */
const SLIDES = [
  { key: "hero", headline: "Technology that keeps your business connected, secure and running.", body: "Enterprise software, systems integration, cloud and networks, cybersecurity, hardware and data, delivered as one accountable partner.", ctaLabel: "Request a consultation", ctaHref: "/contact", alt: "Illustration of servers, a laptop dashboard, a security shield and a router" },
  { key: "integration", headline: "Your systems, finally talking to each other", body: "Custom software, APIs and systems integration that connect the applications you already run.", ctaLabel: "Software & integration", ctaHref: "/services#software-integration", alt: "Illustration of two code panels connected through APIs" },
  { key: "security", headline: "Cybersecurity and continuity you can rely on", body: "Protection, backup and recovery planned around how your business actually works.", ctaLabel: "Cybersecurity & continuity", ctaHref: "/services#security-continuity", alt: "Illustration of a security shield, a server rack and backups" },
  { key: "telecoms", headline: "Networks that reach every office and branch", body: "Telecommunications and networks delivered with our telecom and ISP partners.", ctaLabel: "Telecoms & networks", ctaHref: "/services#telecoms-networks", alt: "Illustration of a telecom mast, a router, cabling and a laptop" },
  { key: "hardware", headline: "Hardware and licences, supplied and supported", body: "Equipment and software licences priced in GHS, ordered online or through a quotation.", ctaLabel: "Browse the store", ctaHref: "/store", alt: "Illustration of a laptop, a server rack and a software licence" },
];

// ---------- build ----------
const SRC_DIR = "assets/illustrations";
const OUT_DIR = "assets/starter-images";
// Fingerprints of every earlier starter picture, so the installer may replace them (and only them) later.
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const replaceable = new Set();
if (existsSync(path.join(OUT_DIR, "manifest.json"))) {
  for (const h of JSON.parse(readFileSync(path.join(OUT_DIR, "manifest.json"), "utf8")).replaceable ?? []) replaceable.add(h);
  for (const d of readdirSync(OUT_DIR)) if (existsSync(path.join(OUT_DIR, d, "1600.webp"))) replaceable.add(sha(path.join(OUT_DIR, d, "1600.webp")));
}
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(SRC_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const rendered = new Map();
async function render(scene, theme) {
  const name = `${scene}-${theme}`;
  if (rendered.has(name)) return name;
  const svg = SCENES[scene](theme);
  writeFileSync(path.join(SRC_DIR, `${name}.svg`), svg);
  const dir = path.join(OUT_DIR, name);
  mkdirSync(dir, { recursive: true });
  for (const width of [320, 800, 1600]) {
    await sharp(Buffer.from(svg), { density: (72 * width) / W })
      .resize({ width })
      .webp({ quality: width === 320 ? 72 : 80, effort: 6 })
      .toFile(path.join(dir, `${width}.webp`));
  }
  rendered.set(name, true);
  return name;
}

/**
 * A 3D render converted to the web copies, or null when there is none. Blender writes assets/renders/<name>.png
 * (not committed: too large); it is kept as a high-quality <name>.webp, which is what the repository stores.
 */
async function render3d(name) {
  const png = path.join("assets/renders", `${name}.png`);
  const src = path.join("assets/renders", `${name}.webp`);
  if (existsSync(png)) await sharp(png).webp({ quality: 95, effort: 6 }).toFile(src);
  if (!existsSync(src)) return null;
  const out = `3d-${name}`;
  if (rendered.has(out)) return out;
  const dir = path.join(OUT_DIR, out);
  mkdirSync(dir, { recursive: true });
  for (const width of [320, 800, 1600]) {
    await sharp(src).resize({ width }).webp({ quality: width === 320 ? 72 : 82, effort: 6 }).toFile(path.join(dir, `${width}.webp`));
  }
  rendered.set(out, true);
  return out;
}

const manifest = { services: [], categories: [], slides: [] };
for (const [slug, [scene, alt]] of Object.entries(SERVICE_ALT)) manifest.services.push({ slug, image: await render(scene, "light"), alt });
for (const [slug, [scene, alt]] of Object.entries(CATEGORY_ALT)) {
  const r = CATEGORY_3D[slug] && (await render3d(CATEGORY_3D[slug]));
  manifest.categories.push({ slug, image: r ?? (await render(scene, "light")), alt: r ? alt.replace("Illustration", "3D illustration") : alt });
}
for (const s of SLIDES) {
  const r = await render3d(`${s.key}-dark`);
  manifest.slides.push({ ...s, image: r ?? (await render(s.key, "dark")), alt: r ? s.alt.replace("Illustration", "3D illustration") : s.alt });
}
manifest.replaceable = [...replaceable].sort();
writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${rendered.size} illustrations to ${SRC_DIR} and ${OUT_DIR}`);
