import { Script, Scene, GenerateRequest } from "../types";

/**
 * Turns a user-pasted script into the same Script shape the AI path
 * produces — no LLM involved. Splits the text into sentence-based chunks
 * and spreads them evenly across the target length.
 */
export function buildScriptFromCustomText(
  text: string,
  req: GenerateRequest
): Script {
  const cleaned = text.trim();
  if (!cleaned) throw new Error("Custom script text is empty.");

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const sceneCount = Math.max(1, Math.min(sentences.length, Math.round(req.targetLengthSeconds / 15)));
  const perScene = Math.ceil(sentences.length / sceneCount);

  const scenes: Scene[] = [];
  const perSceneSeconds = req.targetLengthSeconds / sceneCount;

  for (let i = 0; i < sceneCount; i++) {
    const chunk = sentences.slice(i * perScene, (i + 1) * perScene).join(" ");
    if (!chunk) continue;
    scenes.push({
      index: scenes.length,
      text: chunk,
      startSeconds: Math.round(scenes.length * perSceneSeconds),
      durationSeconds: Math.round(perSceneSeconds),
      // No AI here, so the visual search just uses the scene's own words —
      // still matches reasonably well since Pexels search is keyword-based.
      visualPrompt: chunk.slice(0, 60),
    });
  }

  return {
    title: req.topic || "Untitled",
    scenes,
    fullNarrationText: cleaned,
  };
}
