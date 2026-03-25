import { createHash } from "node:crypto";

export interface SynthesiaVideoConfig {
  scriptText: string;
  avatar: string;
  background: string;
  aspectRatio: string;
}

export function computeVideoHash(config: SynthesiaVideoConfig): string {
  const normalized = JSON.stringify({
    aspectRatio: config.aspectRatio,
    avatar: config.avatar,
    background: config.background,
    scriptText: config.scriptText,
  });
  return createHash("sha256").update(normalized).digest("hex");
}
