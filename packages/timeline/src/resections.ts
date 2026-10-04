/**
 * Which gland pieces each operation removes (pipeline/anatomy/pieces.py cuts the gland into the ESGS levels and the
 * extracapsular cuff; the tumour travels inside the cuff). Pure data, shared by the renderer (which moves the pieces)
 * and the site (which tabulates the extents), so the two cannot disagree.
 */
export const GLAND_PIECES = ['parotid_level_1', 'parotid_level_2', 'parotid_ecd_cuff', 'parotid_level_3', 'parotid_level_4'] as const;

export interface ResectionExtent {
  /** Pieces dissected from the nerve's outer side and lifted out of the field. */
  out: readonly string[];
  /** Pieces taken from beneath the nerve (total parotidectomy only). */
  deep: readonly string[];
}

const L = (n: number) => `parotid_level_${n}`;

export const RESECTION_EXTENT: Readonly<Record<'ecd' | 'partial' | 'superficial' | 'total', ResectionExtent>> = {
  ecd: { out: ['parotid_ecd_cuff', 'pleomorphic_adenoma'], deep: [] },
  partial: { out: [L(2), 'parotid_ecd_cuff', 'pleomorphic_adenoma'], deep: [] },
  superficial: { out: [L(1), L(2), 'parotid_ecd_cuff', 'pleomorphic_adenoma'], deep: [] },
  total: { out: [L(1), L(2), 'parotid_ecd_cuff', 'pleomorphic_adenoma'], deep: [L(3), L(4)] },
};
