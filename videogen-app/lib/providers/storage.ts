import fs from "fs";
import crypto from "crypto";

/**
 * Uploads a finished video to Cloudinary (free tier, no card) and returns
 * its permanent, reliable URL. This replaces serving videos out of
 * Next.js's public/ folder at runtime, which is fragile and was causing
 * silent playback failures — writing files into public/ after the server
 * has already started isn't a fully reliable pattern for user-generated
 * content in Next.js.
 *
 * As a bonus, this also gives us a persistent video library for free —
 * see library.ts, which lists everything uploaded here.
 */
export async function uploadVideo(localPath: string, title: string): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary env vars missing (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET). See .env.example."
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const context = `title=${title.replace(/[|=]/g, " ").slice(0, 100)}`;

  // Cloudinary signed uploads: sign every param except file/cloud_name/
  // resource_type/api_key/signature, sorted alphabetically, + api_secret.
  const paramsToSign = `context=${context}&folder=videogen&tags=videogen&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash("sha1").update(paramsToSign).digest("hex");

  const fileBuffer = fs.readFileSync(localPath);
  const form = new FormData();
  form.append("file", new Blob([fileBuffer]), "video.mp4");
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("folder", "videogen");
  form.append("tags", "videogen");
  form.append("context", context);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/video/upload`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Cloudinary upload failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.secure_url as string;
}
