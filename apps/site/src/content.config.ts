import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { chapter, collections as schemas, step } from '@atlas/schema';

// Data collections share their zod schemas with tools/validate; one JSON record per file.
const data = (name: keyof typeof schemas) =>
  defineCollection({
    loader: glob({ pattern: '*.json', base: `./src/content/${name}` }),
    schema: schemas[name],
  });

export const collections = {
  sources: data('sources'),
  claims: data('claims'),
  structures: data('structures'),
  assets: data('assets'),
  glossary: data('glossary'),
  chapters: defineCollection({ loader: glob({ pattern: '*.json', base: './src/content/chapters' }), schema: chapter }),
  // Plates: MDX bodies with the authored scene delta in frontmatter (validated here at build time).
  steps: defineCollection({ loader: glob({ pattern: '*.mdx', base: './src/content/steps' }), schema: step }),
};
