import { NextResponse } from "next/server";
import { execSync } from "child_process";

// Temporary diagnostic route — checks whether this Render service has
// Python/pip available at runtime, which decides whether a self-hosted
// Piper TTS integration (reusing Piper's own official CLI/phonemizer
// rather than reimplementing ONNX inference from scratch in Node) is
// viable. Delete once the Piper integration path is confirmed either way.
export async function GET() {
  const results: Record<string, string> = {};
  const checks: Record<string, string> = {
    python3: "python3 --version",
    pip3: "pip3 --version",
    pip: "pip --version",
    which_python3: "which python3",
    node: "node --version",
  };

  for (const [key, cmd] of Object.entries(checks)) {
    try {
      results[key] = execSync(cmd, { timeout: 5000 }).toString().trim();
    } catch (err) {
      results[key] = `ERROR: ${(err as Error).message.split("\n")[0]}`;
    }
  }

  return NextResponse.json(results);
}
