/**
 * Lists previously generated videos by querying Cloudinary directly —
 * every video this app generates gets uploaded there (see storage.ts),
 * tagged "videogen", so Cloudinary itself acts as the persistent library.
 * No separate database needed, and it survives server restarts, unlike
 * the in-memory job list.
 */
export interface LibraryVideo {
  url: string;
  title: string;
  createdAt: string;
}

export async function listPastVideos(): Promise<LibraryVideo[]> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    return [];
  }

  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/resources/video/tags/videogen?max_results=30&context=true`,
    { headers: { Authorization: `Basic ${auth}` } }
  );

  if (!res.ok) {
    console.error(`Cloudinary list failed: ${res.status} ${await res.text()}`);
    return [];
  }

  const data = await res.json();
  const resources = (data.resources ?? []) as {
    secure_url: string;
    created_at: string;
    context?: { custom?: { title?: string } };
  }[];

  return resources
    .map((r) => ({
      url: r.secure_url,
      title: r.context?.custom?.title || "Untitled",
      createdAt: r.created_at,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
