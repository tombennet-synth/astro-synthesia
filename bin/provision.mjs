#!/usr/bin/env node

import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];

const COMMANDS = ["provision", "poll", "status"];

if (!COMMANDS.includes(command)) {
  console.log("Usage: astro-synthesia <command> [options]\n");
  console.log("Commands:");
  console.log("  provision   Scan MDX files and create new videos via the Synthesia API");
  console.log("  poll        Wait for in-progress videos to complete");
  console.log("  status      Show the current state of all videos\n");
  console.log("Options:");
  console.log("  --manifest <path>      Manifest file (default: synthesia-manifest.json)");
  console.log("  --content-dir <path>   Content directory to scan (default: src/content)");
  console.log("  --test                 Create watermarked test videos");
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
// Poll a single video until terminal state
// ---------------------------------------------------------------------------

async function pollVideoUntilDone(hash, entry, manifest) {
  const TIMEOUT = 30 * 60 * 1000;
  const INTERVAL = 30_000;
  const start = Date.now();
  const preview = entry.scriptPreview?.slice(0, 60) ?? entry.videoId;

  while (Date.now() - start < TIMEOUT) {
    const video = await apiRequest("GET", `/videos/${entry.videoId}`);

    if (video.status === "complete") {
      manifest[hash] = {
        ...entry,
        status: "complete",
        shareUrl: `https://share.synthesia.io/${entry.videoId}`,
        thumbnailUrl: video.thumbnail?.image ?? null,
        duration: video.duration ?? null,
        completedAt: new Date().toISOString(),
      };
      console.log(`  DONE: "${preview}..." (${entry.videoId})`);
      return "complete";
    }

    if (video.status === "error" || video.status === "rejected") {
      manifest[hash] = { ...entry, status: "error" };
      console.error(`  FAILED: "${preview}..." — ${video.status}`);
      return "error";
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`  WAIT: "${preview}..." (${elapsed}s elapsed)`);
    await new Promise((r) => setTimeout(r, INTERVAL));
  }

  console.warn(`  TIMEOUT: "${preview}..." — still in_progress after 30m`);
  return "timeout";
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdProvision() {
  console.log("astro-synthesia provision");
  console.log(`  Manifest: ${MANIFEST_PATH}`);
  console.log(`  Content:  ${CONTENT_DIR}`);
  console.log(`  Mode:     ${TEST_MODE ? "test (watermarked)" : "production"}\n`);

  // Scan
  const mdxFiles = await collectMdxFiles(CONTENT_DIR);
  console.log(`Found ${mdxFiles.length} MDX file(s)`);

  const allUsages = [];
  for (const file of mdxFiles) {
    const content = await readFile(file, "utf-8");
    allUsages.push(...extractVideoUsages(content, file));
  }

  if (allUsages.length === 0) {
    console.log("No <SynthesiaVideo> usages found. Nothing to provision.\n");
    return;
  }

  console.log(`Found ${allUsages.length} <SynthesiaVideo> usage(s)\n`);
  getApiKey();

  // Diff against manifest and provision new videos
  const manifest = await readManifest();
  let skipped = 0;
  let created = 0;
  let failed = 0;

  const toProvision = [];

  for (const usage of allUsages) {
    const hash = computeHash(usage);
    const existing = manifest[hash];
    const preview = usage.scriptText.slice(0, 60);

    if (existing?.status === "complete") {
      console.log(`  SKIP: "${preview}..." (already complete)`);
      skipped++;
      continue;
    }

    if (existing?.status === "in_progress") {
      console.log(`  SKIP: "${preview}..." (already in progress — run 'poll' to wait)`);
      skipped++;
      continue;
    }

    toProvision.push({ hash, usage, preview });
  }

  // Provision all new videos concurrently
  if (toProvision.length > 0) {
    console.log(`\nProvisioning ${toProvision.length} video(s)...`);

    const results = await Promise.allSettled(
      toProvision.map(async ({ hash, usage, preview }) => {
        const result = await apiRequest("POST", "/videos", {
          title: usage.title ?? "Blog Video",
          visibility: "public",
          test: TEST_MODE,
          aspectRatio: usage.aspectRatio,
          input: [
            {
              scriptText: usage.scriptText,
              avatar: usage.avatar,
              background: usage.background,
            },
          ],
        });

        manifest[hash] = {
          videoId: result.id,
          status: "in_progress",
          shareUrl: null,
          thumbnailUrl: null,
          duration: null,
          scriptPreview: usage.scriptText.slice(0, 100),
          avatar: usage.avatar,
          provisionedAt: new Date().toISOString(),
          completedAt: null,
        };

        console.log(`  CREATED: "${preview}..." (${result.id})`);
        return result.id;
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") created++;
      else {
        console.error(`  ERROR: ${r.reason.message}`);
        failed++;
      }
    }
  }

  await writeManifestFile(manifest);

  console.log(`\nSummary: ${skipped} skipped, ${created} created, ${failed} failed`);

  if (created > 0) {
    console.log("\nVideos are now processing. Run 'astro-synthesia poll' to wait for completion.");
  }

  if (failed > 0) process.exit(1);
}

async function cmdPoll() {
  console.log("astro-synthesia poll");
  console.log(`  Manifest: ${MANIFEST_PATH}\n`);
  getApiKey();

  const manifest = await readManifest();
  const pending = Object.entries(manifest).filter(
    ([, entry]) => entry.status === "in_progress",
  );

  if (pending.length === 0) {
    console.log("No in-progress videos to poll.\n");
    return;
  }

  console.log(`Polling ${pending.length} in-progress video(s)...\n`);

  // Poll all concurrently
  const results = await Promise.allSettled(
    pending.map(([hash, entry]) => pollVideoUntilDone(hash, entry, manifest)),
  );

  await writeManifestFile(manifest);

  const completed = results.filter(
    (r) => r.status === "fulfilled" && r.value === "complete",
  ).length;
  const errored = results.filter(
    (r) => r.status === "fulfilled" && r.value === "error",
  ).length;
  const timedOut = results.filter(
    (r) => r.status === "fulfilled" && r.value === "timeout",
  ).length;

  console.log(`\nSummary: ${completed} complete, ${errored} failed, ${timedOut} timed out`);

  if (errored > 0) process.exit(1);
}

async function cmdStatus() {
  console.log("astro-synthesia status");
  console.log(`  Manifest: ${MANIFEST_PATH}\n`);

  const manifest = await readManifest();
  const entries = Object.entries(manifest);

  if (entries.length === 0) {
    console.log("Manifest is empty. Run 'astro-synthesia provision' first.\n");
    return;
  }

  const counts = { complete: 0, in_progress: 0, error: 0 };

  for (const [, entry] of entries) {
    const preview = entry.scriptPreview?.slice(0, 60) ?? "—";
    const status = entry.status.toUpperCase().padEnd(12);
    console.log(`  ${status} "${preview}..." (${entry.videoId})`);
    counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  }

  console.log(
    `\n${entries.length} video(s): ${counts.complete} complete, ${counts.in_progress} in progress, ${counts.error} errored`,
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const commands = { provision: cmdProvision, poll: cmdPoll, status: cmdStatus };
commands[command]().catch((err) => {
  console.error(`\nFatal: ${err.message}`);
  process.exit(1);
});
