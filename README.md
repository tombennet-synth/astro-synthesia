# astro-synthesia

Astro integration for embedding [Synthesia](https://www.synthesia.io/) AI-generated videos in MDX content.

## Setup

```bash
npm install astro-synthesia
```

```js
// astro.config.mjs
import mdx from '@astrojs/mdx';
import synthesia from 'astro-synthesia';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [mdx(), synthesia()],
});
```

## Usage

```mdx
import SynthesiaVideo from 'astro-synthesia/SynthesiaVideo.astro';

<SynthesiaVideo
  avatar="anna_costume1_cameraA"
  scriptText="Welcome to our blog. Today we discuss Astro."
  title="Intro to Astro"
/>
```

| Prop | Required | Default | Description |
|------|----------|---------|-------------|
| `scriptText` | Yes | — | The text the avatar will speak |
| `avatar` | Yes | — | Synthesia [avatar ID](https://docs.synthesia.io/reference/avatars)\* |
| `background` | No | `"off_white"` | Background name, asset ID, or URL |
| `aspectRatio` | No | `"16:9"` | `"16:9"`, `"9:16"`, `"1:1"`, `"4:5"`, `"5:4"` |
| `title` | No | `"Video"` | Accessible title for the video player |

\*Express-2 avatars and personal avatars are not currently supported. See the [video creation API reference](https://docs.synthesia.io/reference/create-video) for all options.

## CLI

Videos take a few minutes to generate, so provisioning is separate from your build:

```bash
export SYNTHESIA_API_KEY=your-api-key

npx astro-synthesia provision   # scan MDX, create new videos (returns immediately)
npx astro-synthesia poll        # wait for in-progress videos to complete
npx astro-synthesia status      # check the state of all videos
```

Then commit `synthesia-manifest.json` — it maps content hashes to video IDs so unchanged videos aren't re-provisioned. The `--test` flag creates watermarked videos for free.

## Requirements

- Node.js >= 22, Astro 5+, `@astrojs/mdx`
- A [Synthesia API key](https://docs.synthesia.io/reference/synthesia-api-quickstart)

## License

MIT
