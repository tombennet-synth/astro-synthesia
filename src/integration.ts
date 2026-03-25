import type { AstroIntegration } from "astro";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface SynthesiaOptions {
  /** Path to the manifest file, relative to project root. Default: "synthesia-manifest.json" */
  manifest?: string;
}

export default function synthesia(
  options: SynthesiaOptions = {},
): AstroIntegration {
  const manifestFile = options.manifest ?? "synthesia-manifest.json";

  return {
    name: "astro-synthesia",
    hooks: {
      "astro:config:setup": ({ updateConfig, config, logger }) => {
        const root = config.root
          ? fileURLToPath(config.root)
          : process.cwd();
        const manifestPath = resolve(root, manifestFile);

        updateConfig({
          vite: {
            plugins: [
              {
                name: "astro-synthesia-virtual",
                resolveId(id) {
                  if (id === "virtual:astro-synthesia/manifest") {
                    return "\0virtual:astro-synthesia/manifest";
                  }
                },
                load(id) {
                  if (id === "\0virtual:astro-synthesia/manifest") {
                    try {
                      const content = readFileSync(manifestPath, "utf-8");
                      return `export default ${content};`;
                    } catch {
                      return "export default {};";
                    }
                  }
                },
              },
            ],
          },
        });

        logger.info(`Manifest: ${manifestPath}`);
      },
    },
  };
}
