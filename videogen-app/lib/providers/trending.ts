/**
 * Pulls currently trending YouTube Shorts using the official YouTube
 * Data API v3 — genuinely free, no card, 10,000 quota units/day.
 *
 * Uses the "mostPopular" chart (1 quota unit per call — very cheap)
 * rather than search.list (100 units/call), then filters client-side
 * for videos 60 seconds or under to isolate Shorts.
 *
 * Note: YouTube's API has no "faceless content" category — that's not
 * a real filter it offers. This shows genuinely trending Shorts across
 * YouTube; there's no reliable way to auto-detect "faceless" channels
 * without a hand-maintained list.
 */
export interface TrendingVideo {
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  viewCount: number;
  url: string;
  publishedAt: string;
}

function parseIsoDurationToSeconds(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2] ?? "0", 10);
  const seconds = parseInt(match[3] ?? "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

export async function getTrendingShorts(): Promise<TrendingVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return [];
  }

  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&chart=mostPopular&maxResults=50&regionCode=US&key=${apiKey}`
  );

  if (!res.ok) {
    console.error(`YouTube trending fetch failed: ${res.status} ${await res.text()}`);
    return [];
  }

  const data = await res.json();
  const items = (data.items ?? []) as {
    snippet: { title: string; channelTitle: string; thumbnails: { medium?: { url: string }; high?: { url: string } }; publishedAt: string };
    contentDetails: { duration: string };
    statistics: { viewCount: string };
    id: string;
  }[];

  return items
    .filter((v) => parseIsoDurationToSeconds(v.contentDetails.duration) <= 60)
    .map((v) => ({
      title: v.snippet.title,
      channelTitle: v.snippet.channelTitle,
      thumbnailUrl: v.snippet.thumbnails.high?.url || v.snippet.thumbnails.medium?.url || "",
      viewCount: parseInt(v.statistics.viewCount ?? "0", 10),
      url: `https://www.youtube.com/watch?v=${v.id}`,
      publishedAt: v.snippet.publishedAt,
    }))
    .sort((a, b) => b.viewCount - a.viewCount);
}
