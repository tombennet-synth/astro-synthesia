#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];

if (command !== "provision") {
  console.log("Usage: astro-synthesia provision [options]\n");
  console.log("Options:");
  console.log("  --manifest <path>      Manifest file (default: synthesia-manifest.json)");
  console.log("  --content-dir <path>   Content directory to scan (default: src/content)");
  console.log("  --test                 Create watermarked test videos");
  console.log("  --no-wait              Provision without waiting for completion");
  process.exit(command === undefined || command === "--help" ? 0 : 1);
}

function getFlag(name) {
  const idx = args.indexOf(name);
  return idx !== -1;
}

function getFlagValue(name, defaultVal) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultVal;
}

const ROOT = process.cwd();
const MANIFEST_PATH = resolve(ROOT, getFlagValue("--manifest", "synthesia-manifest.json"));
const CONTENT_DIR = resolve(ROOT, getFlagValue("--content-dir", "src/content"));
const TEST_MODE = getFlag("--test");
const NO_WAIT = getFlag("--no-wait");
const API_BASE = "https://api.synthesia.io/v2";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey() {
  const key = process.env.SYNTHESIA_API_KEY;
  if (!key) throw new Error("SYNTHESIA_API_KEY is not set");
  return key;
}

async function apiRequest(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: getApiKey(),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

function computeHash(config) {
  const normalized = JSON.stringify({
    aspectRatio: config.aspectRatio,
    avatar: config.avatar,
    background: config.background,
    scriptText: config.scriptText,
  });
  return createHash("sha256").update(normalized).digest("hex");
}

async function readManifest() {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeManifestFile(manifest) {
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Scan MDX files
// ---------------------------------------------------------------------------

async function collectMdxFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMdxFiles(full)));
    } else if (entry.name.endsWith(".mdx")) {
      files.push(full);
    }
  }
  return files;
}

function extractVideoUsages(content, filePath) {
  const usages = [];
  const pattern =
    /<SynthesiaVideo\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/SynthesiaVideo>)/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const propsStr = match[1];
    const children = match[2]?.trim() ?? "";

    const propValue = (name) => {
      const re = new RegExp(
        `${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|{[\`"]([^}\`"]*)[}\`"]})`,
      );
      const m = propsStr.match(re);
      return m ? m[1] ?? m[2] ?? m[3] : undefined;
    };

    const scriptText = propValue("scriptText") ?? children;
    const avatar = propValue("avatar");

    if (!scriptText) {
      console.warn(`  WARN: <SynthesiaVideo> in ${filePath} has no scriptText — skipping`);
      continue;
    }
    if (!avatar) {
      console.warn(`  WARN: <SynthesiaVideo> in ${filePath} has no avatar — skipping`);
      continue;
    }

    usages.push({
      scriptText,
      avatar,
      background: propValue("background") ?? "off_white",
      aspectRatio: propValue("aspectRatio") ?? "16:9",
      title: propValue("title"),
      file: filePath,
    });
  }

  return usages;
}

// ---------------------------------------------------------------------------
// Provision and poll
// ---------------------------------------------------------------------------

async function provisionVideo(config) {
  const result = await apiRequest("POST", "/videos", {
    title: config.title ?? "Blog Video",
    visibility: "public",
    test: TEST_MODE,
    aspectRatio: config.aspectRatio,
    input: [
      {
        scriptText: config.scriptText,
        avatar: config.avatar,
        background: config.background,
      },
    ],
  });
  return result.id;
}

async function pollVideo(id) {
  const TIMEOUT = 30 * 60 * 1000;
  const INTERVAL = 30_000;
  const start = Date.now();

  while (Date.now() - start < TIMEOUT) {
    const video = await apiRequest("GET", `/videos/${id}`);
    if (video.status === "complete") return video;
    if (video.status === "error" || video.status === "rejected") {
      throw new Error(`Video ${id} ended with status: ${video.status}`);
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`    ... still processing (${elapsed}s elapsed)`);
    await new Promise((r) => setTimeout(r, INTERVAL));
  }

  return apiRequest("GET", `/videos/${id}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("astro-synthesia provision");
  console.log(`  Manifest: ${MANIFEST_PATH}`);
  console.log(`  Content:  ${CONTENT_DIR}`);
  console.log(`  Mode:     ${TEST_MODE ? "test (watermarked)" : "production"}`);
  console.log(`  Wait:     ${NO_WAIT ? "no" : "yes"}\n`);

  const mdxFiles = await collectMdxFiles(CONTENT_DIR);
  console.log(`Found ${mdxFiles.length} MDX file(s)`);

  const allUsages = [];
  for (const file of mdxFiles) {
    const content = await readFile(file, "utf-8");
    const usages = extractVideoUsages(content, file);
    allUsages.push(...usages);
  }

  if (allUsages.length === 0) {
    console.log("No <SynthesiaVideo> usages found. Nothing to provision.\n");
    return;
  }

  console.log(`Found ${allUsages.length} <SynthesiaVideo> usage(s)\n`);
  getApiKey();

  const manifest = await readManifest();
  let alreadyComplete = 0;
  let newlyProvisioned = 0;
  let polled = 0;
  let failed = 0;

  for (const usage of allUsages) {
    const hash = computeHash(usage);
    const existing = manifest[hash];
    const preview = usage.scriptText.slice(0, 80);

    if (existing?.status === "complete") {
      console.log(`  SKIP (complete): "${preview}..."`);
      alreadyComplete++;
      continue;
    }

    if (existing?.status === "in_progress") {
      console.log(`  POLL (in_progress): "${preview}..."`);
      if (!NO_WAIT) {
        try {
          const video = await pollVideo(existing.videoId);
          manifest[hash] = {
            ...existing,
            status: video.status,
            shareUrl:
              video.status === "complete"
                ? `https://share.synthesia.io/${existing.videoId}`
                : existing.shareUrl,
            thumbnailUrl: video.thumbnail?.image ?? existing.thumbnailUrl,
            duration: video.duration ?? existing.duration,
            completedAt:
              video.status === "complete" ? new Date().toISOString() : null,
          };
          polled++;
        } catch (err) {
          console.error(`  ERROR polling ${existing.videoId}: ${err.message}`);
          manifest[hash] = { ...existing, status: "error" };
          failed++;
        }
      }
      continue;
    }

    console.log(`  PROVISION: "${preview}..."`);
    try {
      const videoId = await provisionVideo(usage);
      console.log(`    Created video ${videoId}`);

      manifest[hash] = {
        videoId,
        status: "in_progress",
        shareUrl: null,
        thumbnailUrl: null,
        duration: null,
        scriptPreview: usage.scriptText.slice(0, 100),
        avatar: usage.avatar,
        provisionedAt: new Date().toISOString(),
        completedAt: null,
      };
      newlyProvisioned++;

      if (!NO_WAIT) {
        try {
          const video = await pollVideo(videoId);
          manifest[hash].status = video.status;
          if (video.status === "complete") {
            manifest[hash].shareUrl = `https://share.synthesia.io/${videoId}`;
            manifest[hash].thumbnailUrl = video.thumbnail?.image ?? null;
            manifest[hash].duration = video.duration ?? null;
            manifest[hash].completedAt = new Date().toISOString();
          }
        } catch (err) {
          console.error(`  ERROR polling ${videoId}: ${err.message}`);
          manifest[hash].status = "error";
          failed++;
        }
      }
    } catch (err) {
      console.error(`  ERROR provisioning: ${err.message}`);
      failed++;
    }
  }

  await writeManifestFile(manifest);

  console.log("\nSummary:");
  console.log(`  Already complete: ${alreadyComplete}`);
  console.log(`  Newly provisioned: ${newlyProvisioned}`);
  console.log(`  Polled to completion: ${polled}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    console.error("\nSome videos failed. Check errors above.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
