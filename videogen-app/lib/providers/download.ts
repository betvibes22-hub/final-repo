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
 */
export async function downloadToFile(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  if (!res.body) throw new Error(`Download had no response body: ${url}`);
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(outPath));
}
