import type { z } from 'zod';

/**
 * Content collections validated by tools/validate, keyed by directory name under
 * apps/site/src/content/. Real schemas (steps, claims, sources, structures, assets,
 * glossary) are defined in M0; a content directory without an entry here fails validation.
 */
export const collections: Readonly<Record<string, z.ZodType>> = {};
