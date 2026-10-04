// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  integrations: [mdx()],
  // Typefaces (SIL OFL 1.1), fetched at build time and self-hosted: Newsreader for narrative and Latin terms,
  // Atkinson Hyperlegible Next for labels, UI and figures (plan §5).
  fonts: [
    {
      provider: fontProviders.google(),
      name: 'Newsreader',
      cssVariable: '--font-serif',
      weights: ['400', '500', '600'],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['Georgia', 'serif'],
    },
    {
      provider: fontProviders.google(),
      name: 'Atkinson Hyperlegible Next',
      cssVariable: '--font-sans',
      weights: ['400', '500', '600'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['system-ui', 'sans-serif'],
    },
  ],
  vite: {
    // three.js WebGPU build uses top-level await in examples; target modern browsers.
    build: { target: 'es2023' },
    // File edits made by other tools (the plate generators, the pipeline) are not always seen by native watchers on
    // Windows; polling keeps the dev server's content in step.
    server: { watch: { usePolling: true, interval: 400 } },
  },
});
