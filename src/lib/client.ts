const API_BASE = "https://api.synthesia.io/v2";

export interface CreateVideoInput {
  scriptText: string;
  avatar: string;
  background?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1" | "4:5" | "5:4";
  title?: string;
  test?: boolean;
}

export interface VideoStatus {
  id: string;
  status: "in_progress" | "complete" | "error" | "rejected";
  download?: string;
  duration?: string;
  thumbnail?: {
    image: string | null;
    gif: string | null;
  };
}

async function apiRequest<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Synthesia API ${method} ${path} failed (${res.status}): ${text}`,
    );
  }

  return res.json() as Promise<T>;
}

export async function createVideo(
  apiKey: string,
  input: CreateVideoInput,
): Promise<{ id: string }> {
  return apiRequest<{ id: string }>(apiKey, "POST", "/videos", {
    title: input.title ?? "Blog Video",
    visibility: "public",
    test: input.test ?? false,
    aspectRatio: input.aspectRatio ?? "16:9",
    input: [
      {
        scriptText: input.scriptText,
        avatar: input.avatar,
        background: input.background ?? "off_white",
      },
    ],
  });
}

export async function getVideo(
  apiKey: string,
  id: string,
): Promise<VideoStatus> {
  return apiRequest<VideoStatus>(apiKey, "GET", `/videos/${id}`);
}

export async function pollUntilComplete(
  apiKey: string,
  id: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<VideoStatus> {
  const timeout = opts?.timeoutMs ?? 30 * 60 * 1000;
  const interval = opts?.intervalMs ?? 30_000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const video = await getVideo(apiKey, id);

    if (video.status === "complete") return video;
    if (video.status === "error" || video.status === "rejected") {
      throw new Error(`Video ${id} ended with status: ${video.status}`);
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`    ... still processing (${elapsed}s elapsed)`);
    await new Promise((r) => setTimeout(r, interval));
  }

  return getVideo(apiKey, id);
}
