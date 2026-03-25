import { readFile, writeFile } from "node:fs/promises";

export interface ManifestEntry {
  videoId: string;
  status: "in_progress" | "complete" | "error";
  shareUrl: string | null;
  thumbnailUrl: string | null;
  duration: string | null;
  scriptPreview: string;
  avatar: string;
  provisionedAt: string;
  completedAt: string | null;
}

export type SynthesiaManifest = Record<string, ManifestEntry>;

export async function readManifest(
  manifestPath: string,
): Promise<SynthesiaManifest> {
  try {
    const raw = await readFile(manifestPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function writeManifest(
  manifestPath: string,
  manifest: SynthesiaManifest,
): Promise<void> {
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}
