/**
 * Core stickman frame renderer using @napi-rs/canvas.
 *
 * Draws one complete 1080×1920 frame:
 *   1. Background fill (themed)
 *   2. Bold headline at top
 *   3. Optional subtext
 *   4. One or two stickman characters with pose-driven limb positions
 *
 * All coordinates are for 1080×1920. Scale everything by frame.width/1080
 * for other resolutions (currently unused — always 1080×1920).
 *
 * Animation is driven by `zoomProgress` and `animPhase` — the caller
 * increments these per frame; this function is purely stateless.
 */

import path from "path";
import {
  AnimStyle,
  BgTheme,
  Character,
  CharacterColor,
  StickmanFrameSpec,
  StickmanPose,
} from "./types";

// ─── lazy canvas import ────────────────────────────────────────────────────
// @napi-rs/canvas is a native module — loaded lazily so the rest of the app
// doesn't fail to start if it isn't installed yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let canvasLib: any = null;
let fontsRegistered = false;

async function getCanvas() {
  if (!canvasLib) {
    canvasLib = await import("@napi-rs/canvas");
  }
  if (!fontsRegistered) {
    try {
      const fontPath = path.join(process.cwd(), "assets", "caption-font.ttf");
      canvasLib.GlobalFonts.registerFromPath(fontPath, "StickFont");
    } catch {
      // font registration is best-effort; fall back to system sans-serif
    }
    fontsRegistered = true;
  }
  return canvasLib;
}

// ─── theme palettes ────────────────────────────────────────────────────────

const BG_COLORS: Record<BgTheme, { bg: string; accent: string; text: string }> = {
  minimal:    { bg: "#FFFFFF", accent: "#F0F0F0", text: "#111111" },
  warm:       { bg: "#FFF8E7", accent: "#FFE4A0", text: "#222222" },
  cool:       { bg: "#EFF6FF", accent: "#BFDBFE", text: "#1E3A5F" },
  dark:       { bg: "#1A1A2E", accent: "#16213E", text: "#FFFFFF" },
  "bold-red": { bg: "#FFF0F0", accent: "#FFB3B3", text: "#7B0000" },
  "bold-blue":{ bg: "#EFF6FF", accent: "#93C5FD", text: "#1E3A5F" },
  "bold-green":{ bg: "#F0FFF4", accent: "#86EFAC", text: "#14532D" },
};

const CHAR_COLORS: Record<CharacterColor, { fill: string; outline: string }> = {
  black:  { fill: "#222222", outline: "#000000" },
  blue:   { fill: "#2563EB", outline: "#1D4ED8" },
  red:    { fill: "#DC2626", outline: "#B91C1C" },
  green:  { fill: "#16A34A", outline: "#15803D" },
  purple: { fill: "#7C3AED", outline: "#6D28D9" },
  orange: { fill: "#EA580C", outline: "#C2410C" },
};

// ─── pose math ────────────────────────────────────────────────────────────
// Each pose returns joint angles as [leftArmAngle, rightArmAngle,
// leftLegAngle, rightLegAngle] in radians from vertical.
// animPhase 0..1 drives subtle oscillation on top of the base angles.

const PI = Math.PI;

function poseAngles(
  pose: StickmanPose,
  animPhase: number
): { lArm: number; rArm: number; lLeg: number; rLeg: number } {
  const bounce = Math.sin(animPhase * 2 * PI) * 0.06;

  switch (pose) {
    case "idle":
      return {
        lArm: PI / 4 + bounce,   // ~45° outward-down
        rArm: -(PI / 4 + bounce),
        lLeg: PI / 10,           // slight spread
        rLeg: -(PI / 10),
      };
    case "point-right":
      return {
        lArm: PI / 4,
        rArm: -(PI / 2 + Math.sin(animPhase * 2 * PI) * 0.04), // ~90° outward = horizontal
        lLeg: PI / 10,
        rLeg: -(PI / 10),
      };
    case "point-left":
      return {
        lArm: PI / 2 + Math.sin(animPhase * 2 * PI) * 0.04,
        rArm: -(PI / 4),
        lLeg: PI / 10,
        rLeg: -(PI / 10),
      };
    case "celebrate": {
      const wave = Math.sin(animPhase * 4 * PI) * 0.2;
      return {
        lArm: -(PI / 2) - PI / 6 + wave,  // arms up
        rArm: PI / 2 + PI / 6 - wave,
        lLeg: PI / 8,
        rLeg: -(PI / 8),
      };
    }
    case "question": {
      const q = Math.sin(animPhase * 2 * PI) * 0.1;
      return {
        lArm: (PI / 4) + q,     // arms out/up in shrug
        rArm: -(PI / 4) - q,
        lLeg: PI / 10,
        rLeg: -(PI / 10),
      };
    }
    case "teach": {
      const t = Math.sin(animPhase * 3 * PI) * 0.08;
      return {
        lArm: PI / 4,
        rArm: -(PI / 2) + PI / 6 + t,  // arm raised at ~60°
        lLeg: PI / 10,
        rLeg: -(PI / 10),
      };
    }
    case "walk": {
      const w = Math.sin(animPhase * 4 * PI) * 0.3;
      return {
        lArm: PI / 4 + w,
        rArm: -(PI / 4 - w),
        lLeg: PI / 5 + w,
        rLeg: -(PI / 5 - w),
      };
    }
    case "slump":
      return {
        lArm: PI / 3,     // arms drooping more
        rArm: -(PI / 3),
        lLeg: PI / 10,
        rLeg: -(PI / 10),
      };
  }
}

// ─── stickman drawing ─────────────────────────────────────────────────────

// Stickman proportions at base scale (px, for 1080w canvas)
const HEAD_R = 78;
const BODY_LEN = 200;
const ARM_LEN = 130;
const LEG_LEN = 160;
const HAND_R = 24;
const FOOT_R = 20;
const LINE_W_BASE = 8; // classic line weight

function drawStickman(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  char: Character,
  style: AnimStyle,
  isDark: boolean
) {
  const animPhase = char.animPhase ?? 0;
  const s = char.scale ?? 1;
  const lineW = LINE_W_BASE * s * (style === "chunky" ? 2 : 1);
  const colors = CHAR_COLORS[char.color];
  const fillColor =
    isDark && char.color === "black" ? "#FFFFFF" : colors.fill;
  const strokeColor =
    isDark && char.color === "black" ? "#DDDDDD" : colors.outline;

  const { cx, headY } = char;
  const angles = poseAngles(char.pose, animPhase);

  // If facing left, mirror the arm/leg angles
  const mirror = char.flipX ? -1 : 1;
  const lArm = char.flipX ? -angles.lArm : angles.lArm;
  const rArm = char.flipX ? -angles.rArm : angles.rArm;
  const lLeg = char.flipX ? -angles.lLeg : angles.lLeg;
  const rLeg = char.flipX ? -angles.rLeg : angles.rLeg;

  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = fillColor;
  ctx.lineWidth = lineW;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // ── Head ──────────────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(cx, headY, HEAD_R * s, 0, 2 * PI);
  ctx.fillStyle = style === "dark" || isDark ? (char.color === "black" ? "#FFFFFF" : fillColor) : fillColor === "#222222" ? "#FFFFFF" : fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.stroke();

  // Eyes
  const eyeR = 7 * s;
  const eyeY = headY - HEAD_R * s * 0.15;
  const eyeOffX = HEAD_R * s * 0.32 * mirror;
  ctx.fillStyle = isDark ? "#FFFFFF" : "#000000";
  ctx.beginPath();
  ctx.arc(cx - eyeOffX, eyeY, eyeR, 0, 2 * PI);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + eyeOffX, eyeY, eyeR, 0, 2 * PI);
  ctx.fill();

  // Smile
  const smileY = headY + HEAD_R * s * 0.25;
  const smileW = HEAD_R * s * 0.45;
  ctx.beginPath();
  ctx.arc(cx, smileY, smileW, 0.1 * PI, 0.9 * PI);
  ctx.strokeStyle = isDark ? "#FFFFFF" : "#000000";
  ctx.lineWidth = lineW * 0.8;
  ctx.stroke();
  ctx.lineWidth = lineW;

  // Slump expression: slight frown
  if (char.pose === "slump") {
    ctx.beginPath();
    ctx.arc(cx, smileY + 30 * s, smileW * 0.7, 1.1 * PI, 1.9 * PI);
    ctx.strokeStyle = isDark ? "#AAAAAA" : "#555555";
    ctx.stroke();
    ctx.strokeStyle = strokeColor;
  }

  // ── Body ──────────────────────────────────────────────────────────────
  const bodyTop = headY + HEAD_R * s;
  const bodyBot = bodyTop + BODY_LEN * s;
  const shoulderY = bodyTop + BODY_LEN * s * 0.28; // arm attach point
  const hipY = bodyBot;

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.moveTo(cx, bodyTop);
  ctx.lineTo(cx, bodyBot);
  ctx.stroke();

  // ── Arms ──────────────────────────────────────────────────────────────
  function drawArm(angle: number) {
    const endX = cx + Math.sin(angle) * ARM_LEN * s;
    const endY = shoulderY + Math.cos(angle) * ARM_LEN * s;
    ctx.beginPath();
    ctx.moveTo(cx, shoulderY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    // mitten hand
    ctx.beginPath();
    ctx.arc(endX, endY, HAND_R * s, 0, 2 * PI);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.stroke();
  }
  drawArm(lArm);
  drawArm(rArm);

  // ── Legs ──────────────────────────────────────────────────────────────
  function drawLeg(angle: number) {
    const endX = cx + Math.sin(angle) * LEG_LEN * s;
    const endY = hipY + Math.cos(angle) * LEG_LEN * s;
    ctx.beginPath();
    ctx.moveTo(cx, hipY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    // foot
    ctx.beginPath();
    ctx.ellipse(endX + Math.sin(angle) * FOOT_R * s * 0.5, endY, FOOT_R * s * 1.3, FOOT_R * s * 0.8, angle, 0, 2 * PI);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.stroke();
  }
  drawLeg(lLeg);
  drawLeg(rLeg);

  // ── Accessories ────────────────────────────────────────────────────────
  if (char.accessory?.hat) {
    const hatW = HEAD_R * s * 1.4;
    const hatH = HEAD_R * s * 0.7;
    const hatBrimY = headY - HEAD_R * s * 0.85;
    // Brim
    ctx.fillStyle = strokeColor;
    ctx.beginPath();
    ctx.rect(cx - hatW / 1.5, hatBrimY, hatW * 1.3, hatH * 0.18);
    ctx.fill();
    // Top
    ctx.beginPath();
    ctx.rect(cx - hatW / 2, hatBrimY - hatH * 0.85, hatW, hatH * 0.85);
    ctx.fill();
  }

  if (char.accessory?.glasses) {
    const gR = HEAD_R * s * 0.2;
    const gY = headY - HEAD_R * s * 0.15;
    const gOffX = HEAD_R * s * 0.3;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineW * 0.7;
    ctx.beginPath();
    ctx.arc(cx - gOffX, gY, gR, 0, 2 * PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + gOffX, gY, gR, 0, 2 * PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - gOffX + gR, gY);
    ctx.lineTo(cx + gOffX - gR, gY);
    ctx.stroke();
    ctx.lineWidth = lineW;
  }

  if (char.accessory?.tie) {
    const tieTopY = bodyTop + 10 * s;
    const tieBotY = bodyTop + BODY_LEN * s * 0.55;
    const tieW = 20 * s;
    ctx.fillStyle = char.color === "black" ? "#CC0000" : "#FFFFFF";
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineW * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, tieTopY);
    ctx.lineTo(cx + tieW, tieTopY + 20 * s);
    ctx.lineTo(cx + tieW * 0.6, tieBotY);
    ctx.lineTo(cx, tieBotY + 10 * s);
    ctx.lineTo(cx - tieW * 0.6, tieBotY);
    ctx.lineTo(cx - tieW, tieTopY + 20 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.lineWidth = lineW;
  }

  // ── Question marks (for question pose) ────────────────────────────────
  if (char.pose === "question") {
    const qAlpha = 0.7 + Math.sin(animPhase * 2 * PI) * 0.3;
    ctx.globalAlpha = qAlpha;
    ctx.fillStyle = isDark ? "#FFFFFF" : strokeColor;
    ctx.font = `bold ${60 * s}px StickFont, Arial Black, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("?", cx - 160 * s, headY - 80 * s);
    ctx.fillText("?", cx + 160 * s, headY - 60 * s);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ─── background & decorations ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawBackground(ctx: any, spec: StickmanFrameSpec) {
  const { width, height, bg, animStyle } = spec;
  const theme = BG_COLORS[bg];

  // Base fill
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);

  if (animStyle === "dark") {
    // Dark: subtle grid lines
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    for (let x = 0; x < width; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return;
  }

  // Accent shape behind text area
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.5;
  // Rounded rect in top area
  const rectX = 60;
  const rectY = 80;
  const rectW = width - 120;
  const rectH = 380;
  const r = 40;
  ctx.beginPath();
  ctx.moveTo(rectX + r, rectY);
  ctx.lineTo(rectX + rectW - r, rectY);
  ctx.quadraticCurveTo(rectX + rectW, rectY, rectX + rectW, rectY + r);
  ctx.lineTo(rectX + rectW, rectY + rectH - r);
  ctx.quadraticCurveTo(rectX + rectW, rectY + rectH, rectX + rectW - r, rectY + rectH);
  ctx.lineTo(rectX + r, rectY + rectH);
  ctx.quadraticCurveTo(rectX, rectY + rectH, rectX, rectY + rectH - r);
  ctx.lineTo(rectX, rectY + r);
  ctx.quadraticCurveTo(rectX, rectY, rectX + r, rectY);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Decorative circles
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  ctx.arc(width * 0.85, height * 0.5, 200, 0, 2 * PI);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width * 0.1, height * 0.65, 140, 0, 2 * PI);
  ctx.fill();
  ctx.globalAlpha = 1;

  const PI = Math.PI;
  void PI;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawText(ctx: any, spec: StickmanFrameSpec) {
  const { width, bg, headline, subtext } = spec;
  const theme = BG_COLORS[bg];
  const textColor = theme.text;

  // Headline: bold, large, centered
  const headlineSize = headline.length > 20 ? 72 : 84;
  ctx.font = `900 ${headlineSize}px StickFont, "Arial Black", Impact, sans-serif`;
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Word wrap for headline
  const maxW = width - 160;
  const words = headline.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxW && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);

  const lineH = headlineSize * 1.15;
  const totalH = lines.length * lineH;
  const startY = 120 + (340 - totalH) / 2;

  lines.forEach((line, i) => {
    // Drop shadow
    ctx.fillStyle = bg === "dark" ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.15)";
    ctx.fillText(line, width / 2 + 3, startY + i * lineH + 3);
    ctx.fillStyle = textColor;
    ctx.fillText(line, width / 2, startY + i * lineH);
  });

  // Subtext (optional)
  if (subtext) {
    const subSize = 44;
    ctx.font = `600 ${subSize}px StickFont, Arial, sans-serif`;
    ctx.fillStyle = textColor;
    ctx.globalAlpha = 0.75;
    // Word wrap for subtext
    const subMax = width - 200;
    const subWords = subtext.split(" ");
    const subLines: string[] = [];
    let subCur = "";
    for (const word of subWords) {
      const test = subCur ? `${subCur} ${word}` : word;
      if (ctx.measureText(test).width > subMax && subCur) {
        subLines.push(subCur);
        subCur = word;
      } else {
        subCur = test;
      }
    }
    if (subCur) subLines.push(subCur);

    const subY = 480;
    subLines.slice(0, 3).forEach((line, i) => {
      ctx.fillText(line, width / 2, subY + i * (subSize * 1.2));
    });
    ctx.globalAlpha = 1;
  }
}

// ─── main render function ─────────────────────────────────────────────────

const PI2 = Math.PI;
void PI2;

/**
 * Renders a single stickman frame to a PNG buffer.
 * Uses @napi-rs/canvas Canvas 2D API.
 */
export async function renderFrame(spec: StickmanFrameSpec): Promise<Buffer> {
  const { width, height, characters, animStyle, bg } = spec;
  const lib = await getCanvas();
  const canvas = lib.createCanvas(width, height);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = canvas.getContext("2d") as any;

  const isDark = bg === "dark" || animStyle === "dark";

  // Apply zoom + entrance pop + pan + slide transforms
  // Zoom:     1.0 → 1.03 Ken Burns scale over clip duration
  // Entrance: pop scale 0.92 → 1.015 → 1 (or slide in from side)
  // Pan:      slow camera drift (panX/panY) from compile.ts
  // Slide:    entrance slide offset (slideX) from compile.ts
  const zoomScale = 1 + (spec.zoomProgress * 0.03);
  const enterScale = spec.entranceProgress < 1
    ? easeOut(spec.entranceProgress) * 0.095 + 0.92
    : 1;
  const totalScale = zoomScale * enterScale;

  const panX = spec.panX ?? 0;
  const panY = spec.panY ?? 0;
  const slideX = spec.slideX ?? 0;
  const needsTransform = totalScale !== 1 || panX !== 0 || panY !== 0 || slideX !== 0;

  if (needsTransform) {
    ctx.save();
    // Anchor zoom to center + pan offset, so camera drift and
    // slide entrance move the entire drawn content naturally.
    ctx.translate(width / 2 + panX + slideX, height / 2 + panY);
    ctx.scale(totalScale, totalScale);
    ctx.translate(-width / 2, -height / 2);
  }

  drawBackground(ctx, spec);
  drawText(ctx, spec);

  for (const char of characters) {
    drawStickman(ctx, char, animStyle, isDark);
  }

  if (needsTransform) {
    ctx.restore();
  }

  return canvas.toBuffer("image/png");
}

function easeOut(t: number): number {
  // Simple ease-out cubic
  return 1 - Math.pow(1 - Math.min(t, 1), 3);
}
