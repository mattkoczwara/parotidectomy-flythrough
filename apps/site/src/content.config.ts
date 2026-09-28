import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { collections as schemas } from '@atlas/schema';

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
};
