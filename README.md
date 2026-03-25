# astro-synthesia

Astro integration for embedding [Synthesia](https://www.synthesia.io/) AI-generated videos in your MDX content.

Write a script in your MDX, run a provisioning command, and the component renders a Synthesia video player wherever you placed it.

## Install

```bash
npm install astro-synthesia
```

## Setup

Add the integration to your Astro config:

```js
// astro.config.mjs
import mdx from '@astrojs/mdx';
import synthesia from 'astro-synthesia';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [mdx(), synthesia()],
});
```

### Options

```js
synthesia({
  // Path to the manifest file, relative to project root.
  // Default: "synthesia-manifest.json"
  manifest: 'synthesia-manifest.json',
})
```

## Usage

Import the component in any MDX file:

```mdx
import SynthesiaVideo from 'astro-synthesia/SynthesiaVideo.astro';

<SynthesiaVideo
  avatar="anna_costume1_cameraA"
  scriptText="Welcome to our blog. Today we discuss Astro."
  title="Intro to Astro"
/>
```

### Props

| Prop | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `scriptText` | `string` | Yes | — | The text the avatar will speak |
| `avatar` | `string` | Yes | — | Synthesia [avatar ID](https://docs.synthesia.io/reference/avatars)\* |
| `background` | `string` | No | `"off_white"` | Background name, asset ID, or URL |
| `aspectRatio` | `string` | No | `"16:9"` | `"16:9"`, `"9:16"`, `"1:1"`, `"4:5"`, `"5:4"` |
| `title` | `string` | No | `"Video"` | Accessible title for the video player |

\*Please note that at present, Express-2 avatars and personal avatars are not supported.

See the [Synthesia video creation API reference](https://docs.synthesia.io/reference/create-video) for the full set of supported options.

## Provisioning videos

Synthesia videos take a few minutes to generate. The provisioning step is separate from your site build — run it when you add or change a `<SynthesiaVideo>`, then commit the manifest.

```bash
# Set your API key
export SYNTHESIA_API_KEY=your-api-key

# Provision all videos found in your MDX content
npx astro-synthesia provision

# Use --test for watermarked test videos (free)
npx astro-synthesia provision --test

# Don't wait for completion (fire and forget)
npx astro-synthesia provision --no-wait
```

### CLI options

| Flag | Default | Description |
|------|---------|-------------|
| `--manifest <path>` | `synthesia-manifest.json` | Path to manifest file |
| `--content-dir <path>` | `src/content` | Directory to scan for MDX files |
| `--test` | — | Create watermarked test videos |
| `--no-wait` | — | Provision without waiting for completion |

## How it works

1. You write `<SynthesiaVideo>` components in your MDX with a script and avatar
2. `npx astro-synthesia provision` scans your MDX files, calls the Synthesia API to create videos, waits for them to finish, and writes a `synthesia-manifest.json` mapping content hashes to video IDs
3. At build time, the Astro integration loads the manifest and the component renders a Synthesia embed iframe for completed videos
4. The manifest is deterministic — if the script text and avatar haven't changed, the video won't be re-provisioned

### What gets rendered

- **Video complete**: A responsive Synthesia video player (iframe embed)
- **Video in progress**: A placeholder with "Video is being generated" message
- **Not provisioned**: A development placeholder showing the script text

### Manifest

The `synthesia-manifest.json` file should be committed to your repository. It maps content hashes to Synthesia video metadata and ensures videos aren't re-created on every provision run.

## Requirements

- Node.js >= 22
- Astro 5 or 6
- `@astrojs/mdx` integration
- A [Synthesia API key](https://docs.synthesia.io/reference/synthesia-api-quickstart)

## License

MIT
