/**
 * Core stickman frame renderer using @napi-rs/canvas.
 *
 * Draws one complete 1080×1920 frame:
 *   1. Background fill (themed)
 *   2. Rich scene environment (outdoor / city / indoor / night / tech / beach)
 *   3. Bold headline in the top card
 *   4. One or two stickman characters with pose-driven limb positions
 *   5. Narration caption bar at the bottom
 *
 * Canvas zones (Y coordinates):
 *   0   – 460  : headline card
 *   460 – 1700 : scene environment (sky, buildings, trees, etc.)
 *   1700– 1920 : ground strip + narration caption overlay
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
  BgScene,
  BgTheme,
  Character,
  CharacterColor,
  StickmanFrameSpec,
  StickmanPose,
} from "./types";

// ─── lazy canvas import ────────────────────────────────────────────────────
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

// ─── scene zone constants ──────────────────────────────────────────────────

const SCENE_TOP = 460;   // Y where headline card ends and scene begins
const GROUND_Y  = 1700;  // Y of the ground line (where stickmen stand)
const PI = Math.PI;

// ─── pose math ────────────────────────────────────────────────────────────

function poseAngles(
  pose: StickmanPose,
  animPhase: number
): { lArm: number; rArm: number; lLeg: number; rLeg: number } {
  const bounce = Math.sin(animPhase * 2 * PI) * 0.06;

  switch (pose) {
    case "idle":
      return { lArm: PI / 4 + bounce, rArm: -(PI / 4 + bounce), lLeg: PI / 10, rLeg: -(PI / 10) };
    case "point-right":
      return { lArm: PI / 4, rArm: -(PI / 2 + Math.sin(animPhase * 2 * PI) * 0.04), lLeg: PI / 10, rLeg: -(PI / 10) };
    case "point-left":
      return { lArm: PI / 2 + Math.sin(animPhase * 2 * PI) * 0.04, rArm: -(PI / 4), lLeg: PI / 10, rLeg: -(PI / 10) };
    case "celebrate": {
      const wave = Math.sin(animPhase * 4 * PI) * 0.2;
      return { lArm: -(PI / 2) - PI / 6 + wave, rArm: PI / 2 + PI / 6 - wave, lLeg: PI / 8, rLeg: -(PI / 8) };
    }
    case "question": {
      const q = Math.sin(animPhase * 2 * PI) * 0.1;
      return { lArm: PI / 4 + q, rArm: -(PI / 4) - q, lLeg: PI / 10, rLeg: -(PI / 10) };
    }
    case "teach": {
      const t = Math.sin(animPhase * 3 * PI) * 0.08;
      return { lArm: PI / 4, rArm: -(PI / 2) + PI / 6 + t, lLeg: PI / 10, rLeg: -(PI / 10) };
    }
    case "walk": {
      const w = Math.sin(animPhase * 4 * PI) * 0.3;
      return { lArm: PI / 4 + w, rArm: -(PI / 4 - w), lLeg: PI / 5 + w, rLeg: -(PI / 5 - w) };
    }
    case "slump":
      return { lArm: PI / 3, rArm: -(PI / 3), lLeg: PI / 10, rLeg: -(PI / 10) };
  }
}

// ─── stickman drawing ─────────────────────────────────────────────────────

const HEAD_R    = 78;
const BODY_LEN  = 200;
const ARM_LEN   = 130;
const LEG_LEN   = 160;
const HAND_R    = 24;
const FOOT_R    = 20;
const LINE_W_BASE = 8;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawStickman(ctx: any, char: Character, style: AnimStyle, isDark: boolean) {
  const animPhase = char.animPhase ?? 0;
  const s = char.scale ?? 1;
  const lineW = LINE_W_BASE * s * (style === "chunky" ? 2 : 1);
  const colors = CHAR_COLORS[char.color];
  const fillColor   = isDark && char.color === "black" ? "#FFFFFF" : colors.fill;
  const strokeColor = isDark && char.color === "black" ? "#DDDDDD" : colors.outline;

  const { cx, headY } = char;
  const angles = poseAngles(char.pose, animPhase);
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

  // Head
  ctx.beginPath();
  ctx.arc(cx, headY, HEAD_R * s, 0, 2 * PI);
  ctx.fillStyle = style === "dark" || isDark
    ? (char.color === "black" ? "#FFFFFF" : fillColor)
    : fillColor === "#222222" ? "#FFFFFF" : fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.stroke();

  // Eyes
  const eyeR  = 7 * s;
  const eyeY  = headY - HEAD_R * s * 0.15;
  const eyeOffX = HEAD_R * s * 0.32 * mirror;
  ctx.fillStyle = isDark ? "#FFFFFF" : "#000000";
  ctx.beginPath(); ctx.arc(cx - eyeOffX, eyeY, eyeR, 0, 2 * PI); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + eyeOffX, eyeY, eyeR, 0, 2 * PI); ctx.fill();

  // Smile
  const smileY = headY + HEAD_R * s * 0.25;
  const smileW = HEAD_R * s * 0.45;
  ctx.beginPath();
  ctx.arc(cx, smileY, smileW, 0.1 * PI, 0.9 * PI);
  ctx.strokeStyle = isDark ? "#FFFFFF" : "#000000";
  ctx.lineWidth = lineW * 0.8;
  ctx.stroke();
  ctx.lineWidth = lineW;

  if (char.pose === "slump") {
    ctx.beginPath();
    ctx.arc(cx, smileY + 30 * s, smileW * 0.7, 1.1 * PI, 1.9 * PI);
    ctx.strokeStyle = isDark ? "#AAAAAA" : "#555555";
    ctx.stroke();
    ctx.strokeStyle = strokeColor;
  }

  // Body
  const bodyTop  = headY + HEAD_R * s;
  const bodyBot  = bodyTop + BODY_LEN * s;
  const shoulderY = bodyTop + BODY_LEN * s * 0.28;
  const hipY     = bodyBot;

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineW;
  ctx.beginPath(); ctx.moveTo(cx, bodyTop); ctx.lineTo(cx, bodyBot); ctx.stroke();

  // Arms
  function drawArm(angle: number) {
    const endX = cx + Math.sin(angle) * ARM_LEN * s;
    const endY = shoulderY + Math.cos(angle) * ARM_LEN * s;
    ctx.beginPath(); ctx.moveTo(cx, shoulderY); ctx.lineTo(endX, endY); ctx.stroke();
    ctx.beginPath(); ctx.arc(endX, endY, HAND_R * s, 0, 2 * PI);
    ctx.fillStyle = fillColor; ctx.fill(); ctx.stroke();
  }
  drawArm(lArm);
  drawArm(rArm);

  // Legs
  function drawLeg(angle: number) {
    const endX = cx + Math.sin(angle) * LEG_LEN * s;
    const endY = hipY + Math.cos(angle) * LEG_LEN * s;
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(endX, endY); ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(endX + Math.sin(angle) * FOOT_R * s * 0.5, endY, FOOT_R * s * 1.3, FOOT_R * s * 0.8, angle, 0, 2 * PI);
    ctx.fillStyle = fillColor; ctx.fill(); ctx.stroke();
  }
  drawLeg(lLeg);
  drawLeg(rLeg);

  // Accessories — hat
  if (char.accessory?.hat) {
    const hatW  = HEAD_R * s * 1.4;
    const hatH  = HEAD_R * s * 0.7;
    const hatBrimY = headY - HEAD_R * s * 0.85;
    ctx.fillStyle = strokeColor;
    ctx.beginPath(); ctx.rect(cx - hatW / 1.5, hatBrimY, hatW * 1.3, hatH * 0.18); ctx.fill();
    ctx.beginPath(); ctx.rect(cx - hatW / 2, hatBrimY - hatH * 0.85, hatW, hatH * 0.85); ctx.fill();
  }

  // Accessories — glasses
  if (char.accessory?.glasses) {
    const gR    = HEAD_R * s * 0.2;
    const gY    = headY - HEAD_R * s * 0.15;
    const gOffX = HEAD_R * s * 0.3;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineW * 0.7;
    ctx.beginPath(); ctx.arc(cx - gOffX, gY, gR, 0, 2 * PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + gOffX, gY, gR, 0, 2 * PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - gOffX + gR, gY); ctx.lineTo(cx + gOffX - gR, gY); ctx.stroke();
    ctx.lineWidth = lineW;
  }

  // Accessories — tie
  if (char.accessory?.tie) {
    const tieTopY = bodyTop + 10 * s;
    const tieBotY = bodyTop + BODY_LEN * s * 0.55;
    const tieW    = 20 * s;
    ctx.fillStyle = char.color === "black" ? "#CC0000" : "#FFFFFF";
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineW * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, tieTopY);
    ctx.lineTo(cx + tieW,       tieTopY + 20 * s);
    ctx.lineTo(cx + tieW * 0.6, tieBotY);
    ctx.lineTo(cx,               tieBotY + 10 * s);
    ctx.lineTo(cx - tieW * 0.6, tieBotY);
    ctx.lineTo(cx - tieW,       tieTopY + 20 * s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = lineW;
  }

  // Question marks for question pose
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

// ─── scene environment drawing ────────────────────────────────────────────
// Each helper fills the zone from SCENE_TOP to the canvas bottom (1920).
// The ground strip is always drawn at GROUND_Y.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawCloud(ctx: any, x: number, y: number, s: number) {
  ctx.fillStyle = "#FFFFFF";
  ctx.globalAlpha = 0.88;
  const puffs: [number, number, number][] = [
    [x,          y,           70 * s],
    [x + 80 * s, y - 30 * s, 55 * s],
    [x - 80 * s, y - 20 * s, 50 * s],
    [x + 150 * s, y + 10 * s, 42 * s],
    [x - 140 * s, y + 10 * s, 38 * s],
  ];
  for (const [cx, cy, r] of puffs) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * PI); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawTree(ctx: any, x: number, groundY: number, s: number) {
  // Trunk
  ctx.fillStyle = "#6B4423";
  const trunkW = 28 * s;
  const trunkH = 110 * s;
  ctx.fillRect(x - trunkW / 2, groundY - trunkH, trunkW, trunkH);
  // Layered canopy
  const layers: [string, number][] = [
    ["#2D6A1F", 100 * s],
    ["#3B8A2A", 72 * s],
    ["#4CAF3F", 46 * s],
  ];
  layers.forEach(([color, r], i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, groundY - trunkH - 70 * s - i * 44 * s, r, 0, 2 * PI);
    ctx.fill();
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawTreeSilhouette(ctx: any, x: number, groundY: number, s: number) {
  const trunkH = 70 * s;
  ctx.fillRect(x - 12 * s, groundY - trunkH, 24 * s, trunkH);
  const triLayers = [
    [260 * s, 80 * s],
    [200 * s, 160 * s],
    [140 * s, 240 * s],
  ];
  for (const [width, upH] of triLayers) {
    ctx.beginPath();
    ctx.moveTo(x,              groundY - trunkH - upH);
    ctx.lineTo(x - width / 2, groundY - trunkH - upH + 120 * s);
    ctx.lineTo(x + width / 2, groundY - trunkH - upH + 120 * s);
    ctx.closePath();
    ctx.fill();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawOutdoorScene(ctx: any, width: number) {
  const sceneH = GROUND_Y - SCENE_TOP;

  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, SCENE_TOP, 0, GROUND_Y);
  skyGrad.addColorStop(0, "#5BAED4");
  skyGrad.addColorStop(0.6, "#A8D8EA");
  skyGrad.addColorStop(1, "#C8E9C0");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, SCENE_TOP, width, sceneH);

  // Sun
  ctx.fillStyle = "#FFD700";
  ctx.globalAlpha = 0.92;
  ctx.beginPath(); ctx.arc(860, 590, 85, 0, 2 * PI); ctx.fill();
  // Sun rays
  ctx.strokeStyle = "#FFD700";
  ctx.lineWidth = 10;
  ctx.globalAlpha = 0.45;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * PI;
    ctx.beginPath();
    ctx.moveTo(860 + Math.cos(a) * 105, 590 + Math.sin(a) * 105);
    ctx.lineTo(860 + Math.cos(a) * 148, 590 + Math.sin(a) * 148);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Clouds
  drawCloud(ctx, 200, 570, 1.1);
  drawCloud(ctx, 650, 520, 0.85);
  drawCloud(ctx, 500, 680, 0.65);

  // Background trees (shorter, lighter)
  ctx.globalAlpha = 0.55;
  drawTree(ctx, 130, GROUND_Y, 0.7);
  drawTree(ctx, 310, GROUND_Y, 0.6);
  drawTree(ctx, 760, GROUND_Y, 0.65);
  drawTree(ctx, 940, GROUND_Y, 0.72);
  ctx.globalAlpha = 1;

  // Foreground trees (taller, fully opaque, on sides)
  drawTree(ctx, 55, GROUND_Y, 0.95);
  drawTree(ctx, 185, GROUND_Y, 0.8);
  drawTree(ctx, 895, GROUND_Y, 0.88);
  drawTree(ctx, 1025, GROUND_Y, 1.0);

  // Green ground strip
  const groundGrad = ctx.createLinearGradient(0, GROUND_Y - 30, 0, 1920);
  groundGrad.addColorStop(0, "#5D8F3C");
  groundGrad.addColorStop(0.4, "#4A7730");
  groundGrad.addColorStop(1, "#3D6528");
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, GROUND_Y - 30, width, 1920 - GROUND_Y + 30);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawCityScene(ctx: any, width: number) {
  const sceneH = GROUND_Y - SCENE_TOP;

  // Hazy city sky
  const skyGrad = ctx.createLinearGradient(0, SCENE_TOP, 0, GROUND_Y);
  skyGrad.addColorStop(0, "#9FB4CC");
  skyGrad.addColorStop(0.7, "#C8D8E8");
  skyGrad.addColorStop(1, "#DDE8F0");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, SCENE_TOP, width, sceneH);

  // Building silhouettes (taller = further back = darker)
  const buildings = [
    { x: -10, w: 190, h: 620, color: "#3A4B60" },
    { x: 165, w: 150, h: 460, color: "#4A5C72" },
    { x: 295, w: 210, h: 730, color: "#323F52" },
    { x: 485, w: 130, h: 370, color: "#5A6B80" },
    { x: 595, w: 170, h: 570, color: "#3A4B60" },
    { x: 740, w: 190, h: 840, color: "#323F52" },
    { x: 905, w: 150, h: 500, color: "#4A5C72" },
    { x: 1030,w: 200, h: 650, color: "#3A4B60" },
  ];

  for (const b of buildings) {
    const bTop = GROUND_Y - b.h;
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, bTop, b.w, b.h);

    // Lit windows — deterministic pattern, no Math.random()
    ctx.fillStyle = "#FFE57A";
    ctx.globalAlpha = 0.75;
    const winRows = Math.floor(b.h / 65);
    const winCols = Math.max(1, Math.floor(b.w / 48));
    for (let r = 1; r < winRows - 1; r++) {
      for (let c = 0; c < winCols; c++) {
        if ((r * 3 + c * 2) % 5 !== 0) {
          ctx.fillRect(b.x + 10 + c * 48, bTop + r * 65 + 12, 22, 30);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // Sidewalk
  ctx.fillStyle = "#5C6470";
  ctx.fillRect(0, GROUND_Y - 20, width, 1920 - GROUND_Y + 20);
  ctx.fillStyle = "#7A8490";
  ctx.fillRect(0, GROUND_Y - 8, width, 16);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawIndoorScene(ctx: any, width: number) {
  // Wall
  ctx.fillStyle = "#F5E9D5";
  ctx.fillRect(0, SCENE_TOP, width, GROUND_Y - SCENE_TOP);

  // Wainscoting strip
  ctx.fillStyle = "#DDD0B0";
  ctx.fillRect(0, GROUND_Y - 90, width, 35);

  // Window (right side)
  const winX = 660, winY = 620, winW = 310, winH = 370;
  // Outer frame
  ctx.fillStyle = "#8B7045";
  ctx.fillRect(winX - 22, winY - 22, winW + 44, winH + 44);
  // Sky through glass
  const skyGrad = ctx.createLinearGradient(winX, winY, winX, winY + winH);
  skyGrad.addColorStop(0, "#87CEEB");
  skyGrad.addColorStop(1, "#BEE3F8");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(winX, winY, winW, winH);
  // Cross
  ctx.fillStyle = "#8B7045";
  ctx.fillRect(winX - 10, winY + winH / 2 - 9, winW + 20, 18);
  ctx.fillRect(winX + winW / 2 - 9, winY - 10, 18, winH + 20);
  // Sill
  ctx.fillStyle = "#A08B60";
  ctx.fillRect(winX - 28, winY + winH + 22, winW + 56, 28);
  // Outside sun glow
  ctx.fillStyle = "#FFD700";
  ctx.globalAlpha = 0.18;
  ctx.beginPath(); ctx.arc(winX + winW * 0.7, winY + winH * 0.25, 90, 0, 2 * PI); ctx.fill();
  ctx.globalAlpha = 1;

  // Bookshelf (left side)
  const shX = 55, shY = 660;
  ctx.fillStyle = "#8B6A14";
  // Sides + shelves
  ctx.fillRect(shX - 12, shY, 12, 320);
  ctx.fillRect(shX + 200, shY, 12, 320);
  ctx.fillRect(shX - 12, shY, 224, 12);
  ctx.fillRect(shX - 12, shY + 155, 224, 12);
  ctx.fillRect(shX - 12, shY + 310, 224, 12);
  // Books row 1
  const bookCols = ["#CC2222", "#2244CC", "#22AA44", "#AA6622", "#664488", "#116688"];
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = bookCols[i % bookCols.length];
    ctx.fillRect(shX + 5 + i * 38, shY + 12, 30, 130);
    // Lighter spine highlight
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(shX + 5 + i * 38, shY + 12, 8, 130);
  }
  // Books row 2
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = bookCols[(i + 2) % bookCols.length];
    ctx.fillRect(shX + 8 + i * 46, shY + 167, 36, 128);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(shX + 8 + i * 46, shY + 167, 10, 128);
  }

  // Wooden floor
  const floorGrad = ctx.createLinearGradient(0, GROUND_Y - 20, 0, 1920);
  floorGrad.addColorStop(0, "#C9A877");
  floorGrad.addColorStop(1, "#A88D5E");
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, GROUND_Y - 20, width, 1920 - GROUND_Y + 20);
  // Plank lines
  ctx.strokeStyle = "#B09060";
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.5;
  for (let x = 0; x < width; x += 185) {
    ctx.beginPath(); ctx.moveTo(x, GROUND_Y - 20); ctx.lineTo(x, 1920); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawNightScene(ctx: any, width: number) {
  // Night sky gradient
  const skyGrad = ctx.createLinearGradient(0, SCENE_TOP, 0, GROUND_Y);
  skyGrad.addColorStop(0, "#0A1528");
  skyGrad.addColorStop(0.55, "#18273E");
  skyGrad.addColorStop(1, "#28384E");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, SCENE_TOP, width, GROUND_Y - SCENE_TOP);

  // Stars (deterministic positions)
  const starData: [number, number, number][] = [
    [110, 510, 3],[240, 475, 4],[365, 505, 3],[485, 488, 5],[600, 515, 3],
    [730, 482, 4],[845, 508, 3],[965, 487, 4],[155, 595, 3],[315, 575, 4],
    [455, 608, 5],[590, 585, 3],[690, 618, 4],[820, 595, 3],[95,  648, 4],
    [270, 665, 3],[415, 638, 4],[550, 658, 5],[665, 625, 3],[790, 648, 4],
    [895, 678, 3],[995, 618, 4],[185, 715, 3],[345, 698, 4],[495, 726, 5],
    [635, 708, 3],[755, 738, 4],[915, 718, 3],[50, 755, 4],[1055, 762, 3],
    [280, 790, 5],[490, 775, 3],[700, 800, 4],[920, 780, 3],[150, 840, 4],
  ];
  ctx.fillStyle = "#FFFFFF";
  for (const [sx, sy, r] of starData) {
    ctx.globalAlpha = 0.55 + (r % 3) * 0.15;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, 2 * PI); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Moon crescent (circle with cutout)
  ctx.fillStyle = "#FFFCE0";
  ctx.beginPath(); ctx.arc(820, 600, 72, 0, 2 * PI); ctx.fill();
  ctx.fillStyle = "#18273E"; // match sky
  ctx.beginPath(); ctx.arc(858, 578, 66, 0, 2 * PI); ctx.fill();

  // Dark ground
  const groundGrad = ctx.createLinearGradient(0, GROUND_Y - 20, 0, 1920);
  groundGrad.addColorStop(0, "#1A2E1A");
  groundGrad.addColorStop(1, "#0E1C0E");
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, GROUND_Y - 20, width, 1920 - GROUND_Y + 20);

  // Silhouette trees
  ctx.fillStyle = "#0C1A0C";
  for (const [tx, ts] of [[80, 1.0],[210, 0.82],[890, 0.9],[1010, 1.05]] as [number, number][]) {
    drawTreeSilhouette(ctx, tx, GROUND_Y, ts);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawTechScene(ctx: any, width: number) {
  // Dark tech background
  const bgGrad = ctx.createLinearGradient(0, SCENE_TOP, 0, GROUND_Y);
  bgGrad.addColorStop(0, "#091520");
  bgGrad.addColorStop(1, "#172840");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, SCENE_TOP, width, GROUND_Y - SCENE_TOP);

  // Grid lines
  ctx.strokeStyle = "#00C8FF";
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.18;
  for (const y of [580, 700, 820, 940, 1060, 1180, 1300, 1420, 1560]) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  for (const x of [120, 270, 420, 540, 660, 810, 960]) {
    ctx.beginPath(); ctx.moveTo(x, SCENE_TOP); ctx.lineTo(x, GROUND_Y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Circuit nodes
  ctx.fillStyle = "#00D4FF";
  ctx.globalAlpha = 0.7;
  for (const [nx, ny] of [[270, 700],[540, 580],[810, 820],[420, 940],[660, 1060]] as [number, number][]) {
    ctx.beginPath(); ctx.arc(nx, ny, 13, 0, 2 * PI); ctx.fill();
    // Glow ring
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.arc(nx, ny, 26, 0, 2 * PI); ctx.fill();
    ctx.globalAlpha = 0.7;
  }
  ctx.globalAlpha = 1;

  // Monitor / screen
  const scrX = 275, scrY = 660, scrW = 530, scrH = 330;
  ctx.fillStyle = "#0E2A45";
  ctx.strokeStyle = "#00D4FF";
  ctx.lineWidth = 7;
  ctx.fillRect(scrX, scrY, scrW, scrH);
  ctx.strokeRect(scrX, scrY, scrW, scrH);
  // Screen content lines
  ctx.fillStyle = "#00D4FF";
  ctx.globalAlpha = 0.7;
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "left";
  ctx.fillText("> INITIALIZING...", scrX + 22, scrY + 50);
  ctx.fillText("[ DATA LOADED ✓ ]", scrX + 22, scrY + 105);
  ctx.fillText("■■■■■■■■░░  82%", scrX + 22, scrY + 160);
  ctx.fillText("STATUS: ONLINE", scrX + 22, scrY + 215);
  ctx.globalAlpha = 1;
  // Monitor stand
  ctx.fillStyle = "#3A4A5C";
  ctx.fillRect(scrX + scrW / 2 - 22, scrY + scrH, 44, 68);
  ctx.fillRect(scrX + scrW / 2 - 80, scrY + scrH + 68, 160, 22);

  // Dark reflective floor
  ctx.fillStyle = "#0A1520";
  ctx.fillRect(0, GROUND_Y - 20, width, 1920 - GROUND_Y + 20);
  // Perspective reflection lines
  ctx.strokeStyle = "#00C8FF";
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.08;
  for (let x = 0; x <= width; x += 120) {
    ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.lineTo(width / 2, 1920); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawBeachScene(ctx: any, width: number) {
  const waterStart = GROUND_Y - 220;

  // Sky
  const skyGrad = ctx.createLinearGradient(0, SCENE_TOP, 0, waterStart);
  skyGrad.addColorStop(0, "#42A8D8");
  skyGrad.addColorStop(1, "#8BD4F5");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, SCENE_TOP, width, waterStart - SCENE_TOP);

  // Sun
  ctx.fillStyle = "#FFD700";
  ctx.globalAlpha = 0.92;
  ctx.beginPath(); ctx.arc(200, 590, 92, 0, 2 * PI); ctx.fill();
  ctx.globalAlpha = 1;

  // Clouds
  drawCloud(ctx, 580, 535, 1.0);
  drawCloud(ctx, 880, 578, 0.72);

  // Ocean
  const waterGrad = ctx.createLinearGradient(0, waterStart, 0, GROUND_Y);
  waterGrad.addColorStop(0, "#1C8EE8");
  waterGrad.addColorStop(0.5, "#3A72D8");
  waterGrad.addColorStop(1, "#2068C8");
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, waterStart, width, GROUND_Y - waterStart);
  // Waves
  ctx.strokeStyle = "#68C4FF";
  ctx.lineWidth = 5;
  ctx.globalAlpha = 0.5;
  for (const waveY of [waterStart + 45, waterStart + 110, waterStart + 175]) {
    ctx.beginPath(); ctx.moveTo(0, waveY);
    for (let x = 0; x < width; x += 90) {
      ctx.quadraticCurveTo(x + 45, waveY - 22, x + 90, waveY);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Sand
  const sandGrad = ctx.createLinearGradient(0, GROUND_Y - 35, 0, 1920);
  sandGrad.addColorStop(0, "#F2D08A");
  sandGrad.addColorStop(1, "#D4B060");
  ctx.fillStyle = sandGrad;
  ctx.fillRect(0, GROUND_Y - 35, width, 1920 - GROUND_Y + 35);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawDefaultDecor(ctx: any, width: number, height: number, theme: { accent: string }) {
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.18;
  ctx.beginPath(); ctx.arc(width * 0.85, height * 0.5, 220, 0, 2 * PI); ctx.fill();
  ctx.beginPath(); ctx.arc(width * 0.1,  height * 0.65, 155, 0, 2 * PI); ctx.fill();
  ctx.beginPath(); ctx.arc(width * 0.5,  height * 0.72, 110, 0, 2 * PI); ctx.fill();
  ctx.globalAlpha = 1;
}

// ─── background dispatcher ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawBackground(ctx: any, spec: StickmanFrameSpec) {
  const { width, height, bg, animStyle, bgScene } = spec;
  const theme = BG_COLORS[bg];

  // Base fill (always first)
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);

  if (animStyle === "dark") {
    // Subtle grid for dark style
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    for (let x = 0; x < width; x += 80) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += 80) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return;
  }

  // Top card backdrop (always drawn — provides text area contrast)
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.7;
  const rectX = 60, rectY = 80, rectW = width - 120, rectH = 380;
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

  // Scene environment below the headline card
  switch (bgScene) {
    case "outdoor": drawOutdoorScene(ctx, width); break;
    case "city":    drawCityScene(ctx, width);    break;
    case "indoor":  drawIndoorScene(ctx, width);  break;
    case "night":   drawNightScene(ctx, width);   break;
    case "tech":    drawTechScene(ctx, width);    break;
    case "beach":   drawBeachScene(ctx, width);   break;
    default:        drawDefaultDecor(ctx, width, height, theme); break;
  }
}

// ─── text rendering ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawText(ctx: any, spec: StickmanFrameSpec) {
  const { width, bg, headline, subtext } = spec;
  const theme = BG_COLORS[bg];
  const textColor = theme.text;

  // ── Headline in the top card ───────────────────────────────────────────
  const headlineSize = headline.length > 20 ? 72 : 84;
  ctx.font = `900 ${headlineSize}px StickFont, "Arial Black", Impact, sans-serif`;
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Word wrap
  const maxW = width - 160;
  const words = headline.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxW && current) {
      lines.push(current); current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);

  const lineH  = headlineSize * 1.15;
  const totalH = lines.length * lineH;
  const startY = 120 + (340 - totalH) / 2;

  lines.forEach((line, i) => {
    ctx.fillStyle = bg === "dark" ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.15)";
    ctx.fillText(line, width / 2 + 3, startY + i * lineH + 3);
    ctx.fillStyle = textColor;
    ctx.fillText(line, width / 2, startY + i * lineH);
  });

  // ── Narration caption bar at the bottom ────────────────────────────────
  // Overlaid on the ground strip, below character feet (~y=1700+)
  if (subtext) {
    const capY = 1728;
    const capH = 175;

    // Semi-transparent dark backdrop
    ctx.fillStyle = "rgba(0,0,0,0.68)";
    ctx.fillRect(0, capY, width, capH);

    const subSize = 40;
    ctx.font = `500 ${subSize}px StickFont, Arial, sans-serif`;
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.globalAlpha = 0.95;

    // Word wrap
    const subMax = width - 100;
    const subWords = subtext.split(" ");
    const subLines: string[] = [];
    let subCur = "";
    for (const word of subWords) {
      const test = subCur ? `${subCur} ${word}` : word;
      if (ctx.measureText(test).width > subMax && subCur) {
        subLines.push(subCur); subCur = word;
      } else {
        subCur = test;
      }
    }
    if (subCur) subLines.push(subCur);

    const sLineH   = subSize * 1.35;
    const sTotal   = Math.min(subLines.length, 3) * sLineH;
    const textSY   = capY + (capH - sTotal) / 2;

    subLines.slice(0, 3).forEach((line, i) => {
      ctx.fillText(line, width / 2, textSY + i * sLineH);
    });
    ctx.globalAlpha = 1;
  }
}

// ─── main render function ─────────────────────────────────────────────────

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

  const zoomScale  = 1 + (spec.zoomProgress * 0.03);
  const enterScale = spec.entranceProgress < 1
    ? easeOut(spec.entranceProgress) * 0.095 + 0.92
    : 1;
  const totalScale = zoomScale * enterScale;

  const panX   = spec.panX ?? 0;
  const panY   = spec.panY ?? 0;
  const slideX = spec.slideX ?? 0;
  const needsTransform = totalScale !== 1 || panX !== 0 || panY !== 0 || slideX !== 0;

  if (needsTransform) {
    ctx.save();
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
  return 1 - Math.pow(1 - Math.min(t, 1), 3);
}
