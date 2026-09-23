import fs from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

/**
 * Streams a URL straight to disk instead of buffering the whole response
 * in memory first. The old pattern everywhere else in this codebase was
 * `Buffer.from(await res.arrayBuffer())` then `writeFileSync` — fine for
 * small files, but for a ~25-60MB Piper voice model or a multi-MB Pixabay
 * video clip it holds the entire file in the Node heap at once, which is
 * real pressure on a 512MB free-tier container. Streaming keeps memory
 * use roughly constant regardless of file size.
 *
 * A 60-second AbortController timeout is applied to every fetch so a
 * stalled connection (Pollinations occasionally hangs with no bytes,
 * Hugging Face CDN sometimes goes quiet mid-download) cannot tie up a
 * pipeline worker indefinitely. 60s is generous enough for the largest
 * voice model (~65MB at real Render network speeds) while still
 * cutting off genuinely stuck downloads within a reasonable window.
 */
export async function downloadToFile(url: string, outPath: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
    if (!res.body) throw new Error(`Download had no response body: ${url}`);
    await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(outPath));
  } finally {
    clearTimeout(timeout);
  }
}
