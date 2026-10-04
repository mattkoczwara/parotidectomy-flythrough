/**
 * Plan §10: every substantive sentence resolves to a claim. In a plate body every paragraph must carry a <Claim> or be
 * a <Model> statement (about how the atlas draws things, which makes no medical claim), and the prose left over once
 * those are removed may only be connective (a few words). Notes and insets hold components (framed figures, tables,
 * drawings) whose numbers come from claim records and are checked by the claim validators.
 */
const CONNECTIVE_WORDS = 8;

export function checkAttribution(where: string, body: string): string[] {
  const errors: string[] = [];
  let text = body.replace(/^import .*$/gm, '');
  text = text.replace(/<Note\b[\s\S]*?<\/Note>/g, '').replace(/<Inset\b[\s\S]*?<\/Inset>/g, '');
  for (const block of text.split(/\n\s*\n/)) {
    const b = block.trim();
    if (!b) continue;
    // A block of components only (a framed figure, a table, a drawing) has no prose to attribute.
    if (!b.replace(/<(Framed|PseudocapsuleInset|ChoiceTable|CompareExtents|HealingTimeline)\b[^>]*\/>/g, '').trim()) continue;
    const hasClaim = /<Claim\b/.test(b);
    const hasModel = /<Model>/.test(b);
    if (!hasClaim && !hasModel) {
      errors.push(`${where}: paragraph with neither a claim nor a Model statement: "${b.slice(0, 70).replace(/\s+/g, ' ')}"`);
      continue;
    }
    const left = b
      .replace(/<Claim\b[^>]*>[\s\S]*?<\/Claim>/g, ' ')
      .replace(/<Model>[\s\S]*?<\/Model>/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    const words = left.match(/[A-Za-z]{2,}/g) ?? [];
    if (words.length > CONNECTIVE_WORDS) errors.push(`${where}: unattributed prose (${words.length} words): "${left.trim().slice(0, 80).replace(/\s+/g, ' ')}"`);
  }
  return errors;
}
