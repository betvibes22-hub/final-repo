import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync, execSync } from "child_process";
import { downloadToFile } from "./download";

/**
 * Self-hosted, open-source TTS via Piper (MIT license) — chosen after
 * hitting real caps on every free hosted TTS API tried so far
 * (ElevenLabs blocked free API voice access entirely; VoiceRSS only
 * actually has 5 English voices). Piper runs locally via Python/ONNX,
 * so there's no request quota, no per-voice gating, and no risk of a
 * "free tier" turning out to be a trial — it's just local compute.
 *
 * Confirmed viable on this Render service: python3 3.11 and pip3 are
 * both present (see instrumentation.ts's boot diagnostic). piper-tts
 * and its model files are installed/downloaded lazily on first use and
 * cached for the life of the running instance, the same pattern
 * already used for stock footage and fonts elsewhere in this app.
 */

export type VoiceGender = "female" | "male";
export type VoicePace = "slower" | "normal" | "faster";

interface PiperVoiceDef {
  key: string; // Piper's own voice key, e.g. "en_US-amy-medium"
  gender: VoiceGender;
  displayName: string; // shown in the picker
  hfLang: string; // "en_US" | "en_GB" — path segment on Hugging Face
  hfName: string; // e.g. "amy" — path segment
  hfQuality: string; // "low" | "medium" | "high" — path segment
}

// Confirmed directly against rhasspy/piper-voices' official voices.json
// (Hugging Face) — genders cross-checked against Piper's own model
// cards / project docs, not guessed from names alone.
const VOICES: PiperVoiceDef[] = [
  // Female
  { key: "en_US-amy-medium", gender: "female", displayName: "Amy", hfLang: "en_US", hfName: "amy", hfQuality: "medium" },
  { key: "en_US-kathleen-low", gender: "female", displayName: "Kathleen", hfLang: "en_US", hfName: "kathleen", hfQuality: "low" },
  { key: "en_US-kristin-medium", gender: "female", displayName: "Kristin", hfLang: "en_US", hfName: "kristin", hfQuality: "medium" },
  { key: "en_US-hfc_female-medium", gender: "female", displayName: "Hannah", hfLang: "en_US", hfName: "hfc_female", hfQuality: "medium" },
  { key: "en_US-ljspeech-medium", gender: "female", displayName: "Lucy", hfLang: "en_US", hfName: "ljspeech", hfQuality: "medium" },
  { key: "en_US-lessac-medium", gender: "female", displayName: "Lessac", hfLang: "en_US", hfName: "lessac", hfQuality: "medium" },
  { key: "en_GB-jenny_dioco-medium", gender: "female", displayName: "Jenny (British)", hfLang: "en_GB", hfName: "jenny_dioco", hfQuality: "medium" },
  { key: "en_GB-southern_english_female-low", gender: "female", displayName: "Southern (British)", hfLang: "en_GB", hfName: "southern_english_female", hfQuality: "low" },
  { key: "en_GB-alba-medium", gender: "female", displayName: "Alba (Scottish)", hfLang: "en_GB", hfName: "alba", hfQuality: "medium" },
  { key: "en_GB-cori-medium", gender: "female", displayName: "Cori (British)", hfLang: "en_GB", hfName: "cori", hfQuality: "medium" },
  // Male
  { key: "en_US-danny-low", gender: "male", displayName: "Danny", hfLang: "en_US", hfName: "danny", hfQuality: "low" },
  { key: "en_US-joe-medium", gender: "male", displayName: "Joe", hfLang: "en_US", hfName: "joe", hfQuality: "medium" },
  { key: "en_US-john-medium", gender: "male", displayName: "John", hfLang: "en_US", hfName: "john", hfQuality: "medium" },
  { key: "en_US-ryan-medium", gender: "male", displayName: "Ryan", hfLang: "en_US", hfName: "ryan", hfQuality: "medium" },
  { key: "en_US-norman-medium", gender: "male", displayName: "Norman", hfLang: "en_US", hfName: "norman", hfQuality: "medium" },
  { key: "en_US-hfc_male-medium", gender: "male", displayName: "Marcus", hfLang: "en_US", hfName: "hfc_male", hfQuality: "medium" },
  { key: "en_US-bryce-medium", gender: "male", displayName: "Bryce", hfLang: "en_US", hfName: "bryce", hfQuality: "medium" },
  { key: "en_US-reza_ibrahim-medium", gender: "male", displayName: "Reza", hfLang: "en_US", hfName: "reza_ibrahim", hfQuality: "medium" },
  { key: "en_GB-alan-medium", gender: "male", displayName: "Alan (British)", hfLang: "en_GB", hfName: "alan", hfQuality: "medium" },
  { key: "en_GB-northern_english_male-medium", gender: "male", displayName: "Northern (British)", hfLang: "en_GB", hfName: "northern_english_male", hfQuality: "medium" },
];

// Piper's own speed knob (< 1 faster, > 1 slower) — real parameter,
// not a fake label, applied per voice per request.
const PACE_LENGTH_SCALE: Record<VoicePace, string> = {
  slower: "1.25",
  normal: "",
  faster: "0.8",
};

export interface VoiceOptions {
  gender?: VoiceGender;
  voiceName?: string; // a Piper voice `key` from VOICES; falls back to the first of that gender
  pace?: VoicePace;
}

export function listAvailableVoices() {
  const byGender: Record<VoiceGender, { key: string; displayName: string }[]> = { female: [], male: [] };
  for (const v of VOICES) byGender[v.gender].push({ key: v.key, displayName: v.displayName });
  return byGender;
}

const VOICE_CACHE_DIR = path.join(os.tmpdir(), "piper-voices");
let pipInstallEnsured = false;

function ensurePiperInstalled() {
  if (pipInstallEnsured) return;
  execSync("pip3 install --break-system-packages --user --quiet piper-tts numpy", {
    timeout: 120_000,
  });
  pipInstallEnsured = true;
}

async function ensureVoiceModel(def: PiperVoiceDef): Promise<string> {
  fs.mkdirSync(VOICE_CACHE_DIR, { recursive: true });
  const onnxPath = path.join(VOICE_CACHE_DIR, `${def.key}.onnx`);
  const jsonPath = path.join(VOICE_CACHE_DIR, `${def.key}.onnx.json`);

  if (fs.existsSync(onnxPath) && fs.existsSync(jsonPath)) {
    return onnxPath;
  }

  const base = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${def.hfLang.slice(0, 2)}/${def.hfLang}/${def.hfName}/${def.hfQuality}`;
  const onnxUrl = `${base}/${def.key}.onnx`;
  const jsonUrl = `${base}/${def.key}.onnx.json`;

  // Download to .tmp then rename into place — these files (the onnx model
  // is 25-65MB) are checked into a persistent cache dir and reused across
  // requests, so a connection that drops mid-download (as happened once
  // in production) must never leave a partial file sitting at the real
  // path, or every future request would treat it as a valid cached model
  // and fail synthesis on a truncated file.
  const onnxTmp = `${onnxPath}.tmp`;
  const jsonTmp = `${jsonPath}.tmp`;
  try {
    await Promise.all([downloadToFile(onnxUrl, onnxTmp), downloadToFile(jsonUrl, jsonTmp)]);
    fs.renameSync(onnxTmp, onnxPath);
    fs.renameSync(jsonTmp, jsonPath);
  } catch (err) {
    for (const tmp of [onnxTmp, jsonTmp]) {
      if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    }
    throw err;
  }

  return onnxPath;
}

export async function generateVoiceoverPiper(
  text: string,
  outDir: string,
  options: VoiceOptions = {},
  onLog?: (text: string) => void
): Promise<string> {
  const gender = options.gender ?? "female";
  const candidates = VOICES.filter((v) => v.gender === gender);
  const def = candidates.find((v) => v.key === options.voiceName) ?? candidates[0];

  onLog?.(`Piper: preparing local TTS engine (voice: ${def.displayName})`);
  ensurePiperInstalled();

  const modelCached = fs.existsSync(path.join(VOICE_CACHE_DIR, `${def.key}.onnx`));
  onLog?.(
    modelCached
      ? `Piper: using cached voice model for ${def.displayName}`
      : `Piper: downloading voice model for ${def.displayName} from Hugging Face`
  );
  const onnxPath = await ensureVoiceModel(def);

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "voiceover.wav");
  const lengthScale = PACE_LENGTH_SCALE[options.pace ?? "normal"];

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  onLog?.(`Piper: synthesizing narration (${wordCount} words, ${options.pace ?? "normal"} pace)`);

  const scriptPath = path.join(process.cwd(), "scripts", "piper_synth.py");
  const args = [scriptPath, onnxPath, outPath];
  if (lengthScale) args.push(lengthScale);

  execFileSync("python3", args, {
    input: text,
    timeout: 120_000,
    maxBuffer: 1024 * 1024 * 50,
  });

  if (!fs.existsSync(outPath)) {
    throw new Error("Piper synthesis did not produce an output file");
  }

  onLog?.(`Piper: narration ready`);
  return outPath;
}
