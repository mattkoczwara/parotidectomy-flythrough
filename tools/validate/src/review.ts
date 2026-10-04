/**
 * Clinical review packet (plan §10, §13 risk 2): regenerated from the content, the QC checks and the self-review
 * checklist, so a correction after review is a data edit, not a rebuild.
 *
 *   npm run review        -> docs/review/index.html (open locally; relative links to figures and QC evidence)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '../../..');
const content = join(root, 'apps/site/src/content');
const outDir = join(root, 'docs/review');
const rel = (p: string) => `../../${p}`; // from docs/review/ to the repository root

const readDir = <T>(name: string): T[] =>
  readdirSync(join(content, name))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(content, name, f), 'utf8')) as T);

interface Claim {
  id: string;
  statement: { essentials: string; anatomy?: string; clinical?: string };
  evidenceClass: string;
  sources: { sourceId: string; locator?: string; support: string }[];
  numbers: { label: string; value?: number; unit: string; ci?: [number, number]; range?: [number, number]; n?: string; population: string; design: string; sourceId: string }[];
  limitations?: string;
  disagreement?: string;
  verification: string;
  clinicalReview: { status: string };
}
interface Source {
  id: string;
  citation: { authors: string[]; title?: string; container: string; year?: number };
  publicationType: string;
  pmid?: string;
  doi?: string;
  url?: string;
  status: string;
}
interface Check {
  id: string;
  plates: string[];
  area: string;
  statement: string;
  reference: string;
  evidence: string[];
  self: { status: string; note: string };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const claims = new Map(readDir<Claim>('claims').map((c) => [c.id, c]));
const sources = new Map(readDir<Source>('sources').map((s) => [s.id, s]));
const checklist = (JSON.parse(readFileSync(join(outDir, 'checklist.json'), 'utf8')) as { items: Check[] }).items;
const checks = JSON.parse(readFileSync(join(root, 'docs/qc/m1-anatomy/checks.json'), 'utf8')) as Record<string, { pass?: boolean; summary?: string }>;
const chapters = new Map(readDir<{ id: string; title: string; order: number }>('chapters').map((c) => [c.id, c]));

const steps = readdirSync(join(content, 'steps'))
  .filter((f) => f.endsWith('.mdx'))
  .sort()
  .map((f) => {
    const text = readFileSync(join(content, 'steps', f), 'utf8').replace(/\r\n/g, '\n');
    const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)!;
    const front = parse(m[1]!) as { id: string; title: string; chapter: string; order: number; sceneDescription: string; claims?: string[] };
    const cited: string[] = [];
    const body = m[2]!
      .split('\n')
      .filter((l) => !l.startsWith('import '))
      .join('\n')
      .trim()
      .replace(/<Claim id="([^"]+)">([\s\S]*?)<\/Claim>/g, (_, id: string, t: string) => {
        cited.push(id);
        return `${t} <sup class="ref">[${id}]</sup>`;
      });
    return { ...front, body, cited: [...new Set([...cited, ...(front.claims ?? [])])] };
  })
  .sort((a, b) => a.order - b.order);

const missing: string[] = [];
const evidenceLink = (p: string) => {
  if (!existsSync(join(root, p))) missing.push(p);
  return `<a href="${esc(rel(p))}">${esc(p)}</a>`;
};
const source = (id: string, support: string, locator?: string) => {
  const s = sources.get(id);
  if (!s) return `<li>${esc(id)} (missing source)</li>`;
  const c = s.citation;
  const link = s.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/` : s.doi ? `https://doi.org/${s.doi}` : s.url;
  return `<li>${esc(c.authors.slice(0, 3).join(', '))}${c.authors.length > 3 ? ' et al.' : ''} ${esc(c.year ?? '')}. ${esc(c.title ?? '')}. <i>${esc(c.container)}</i>. ${esc(s.publicationType)}${s.status !== 'current' ? ` <b>[${esc(s.status)}]</b>` : ''}${support === 'indirect' ? ' (indirect)' : ''}${locator ? `, ${esc(locator)}` : ''}${link ? ` <a href="${esc(link)}">link</a>` : ''}</li>`;
};
const claimBlock = (id: string) => {
  const c = claims.get(id);
  if (!c) return `<div class="claim missing">${esc(id)}: missing claim</div>`;
  return `<div class="claim" id="claim-${esc(id)}">
    <h4>${esc(id)} <span class="tag">${esc(c.evidenceClass)}</span> <span class="tag ${c.verification === 'checked' ? 'ok' : 'todo'}">sources ${c.verification === 'checked' ? 'checked' : 'to verify'}</span> <span class="tag todo">clinical review: ${esc(c.clinicalReview.status)}</span></h4>
    <p><b>Essentials:</b> ${esc(c.statement.essentials)}</p>
    ${c.statement.anatomy ? `<p><b>Anatomy:</b> ${esc(c.statement.anatomy)}</p>` : ''}
    ${c.statement.clinical ? `<p><b>Clinical:</b> ${esc(c.statement.clinical)}</p>` : ''}
    ${c.numbers.map((n) => `<p class="num">${esc(n.label)}: <b>${n.value !== undefined ? `${esc(n.value)} ` : ''}${esc(n.unit)}</b>${n.ci ? ` (95% CI ${n.ci.join('–')})` : ''}${n.range ? ` (range ${n.range.join('–')})` : ''}; ${esc(n.population)}${n.n ? `, ${esc(n.n)}` : ''}; ${esc(n.design)}</p>`).join('')}
    ${c.disagreement ? `<p class="caveat">Disagreement: ${esc(c.disagreement)}</p>` : ''}
    ${c.limitations ? `<p class="caveat">Limitations: ${esc(c.limitations)}</p>` : ''}
    <ol class="sources">${c.sources.map((s) => source(s.sourceId, s.support, s.locator)).join('')}</ol>
  </div>`;
};
const checklistRow = (c: Check) => `<tr><td>${esc(c.area)}</td><td>${esc(c.statement)}</td><td>${esc(c.reference)}</td><td>${c.evidence.map(evidenceLink).join('<br>')}</td><td class="st-${esc(c.self.status)}">${esc(c.self.status)}: ${esc(c.self.note)}</td><td>pending</td></tr>`;

const plates = steps
  .map((s, i) => {
    const fig = `apps/site/public/plates/${s.id}.png`;
    const items = checklist.filter((c) => c.plates.includes(s.id));
    return `<section class="plate" id="${esc(s.id)}">
      <h2>${i + 1}. ${esc(s.title)} <span class="chapter">${esc(chapters.get(s.chapter)?.title ?? s.chapter)}</span></h2>
      ${existsSync(join(root, fig)) ? `<img src="${esc(rel(fig))}" alt="">` : '<p class="caveat">No captured figure (run npm run capture).</p>'}
      <div class="text">${s.body
        .split(/\n\n+/)
        .map((p) => `<p>${p}</p>`)
        .join('')}</div>
      <p class="scene"><b>Scene description (screen readers, static figure):</b> ${esc(s.sceneDescription)}</p>
      ${items.length ? `<h3>Checklist items</h3><table><tr><th>Area</th><th>Statement</th><th>Compared against</th><th>Evidence</th><th>Self-review</th><th>Clinical</th></tr>${items.map(checklistRow).join('')}</table>` : ''}
      <h3>Claims</h3>${s.cited.map(claimBlock).join('')}
    </section>`;
  })
  .join('\n');

const checkRows = Object.entries(checks)
  .filter(([, v]) => v && typeof v === 'object' && 'summary' in v)
  .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="${v.pass ? 'st-pass' : 'st-open'}">${v.pass ? 'pass' : 'FAIL'}</td><td>${esc(v.summary)}</td></tr>`)
  .join('');
const all = [...claims.values()];
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parotid Atlas review packet</title>
<style>
body{font:15px/1.5 Georgia,serif;max-width:980px;margin:2rem auto;padding:0 1rem;color:#1d1d1d;background:#fbfaf7}
h1,h2,h3,h4{font-family:system-ui,sans-serif;font-weight:600}h2{border-top:2px solid #ccc;padding-top:1rem;margin-top:3rem}
.chapter{font-weight:400;color:#777;font-size:.8em}img{max-width:100%;border:1px solid #ccc}
table{border-collapse:collapse;width:100%;font:13px/1.4 system-ui,sans-serif;margin:.5rem 0}td,th{border:1px solid #ddd;padding:.3rem .45rem;vertical-align:top;text-align:left}
.claim{border-left:3px solid #bbb;padding:.2rem .8rem;margin:.8rem 0;font-size:14px}.claim h4{margin:.2rem 0}
.tag{font:500 11px system-ui,sans-serif;background:#eee;padding:.05rem .35rem;border-radius:2px;margin-left:.3rem}.tag.todo{background:#f6e7c8}.tag.ok{background:#d9eed9}
.caveat{color:#7a5a12}.num{font-family:system-ui,sans-serif;font-size:13px}.ref{color:#666;font-size:.7em}.scene{font-size:14px;color:#333}
.st-pass{background:#eef7ee}.st-limit{background:#fbf3e2}.st-open{background:#fbe6e2}.missing{color:#a00}
</style></head><body>
<h1>Parotid Atlas: clinical review packet</h1>
<p>Generated ${esc(new Date().toISOString().slice(0, 10))} from the content, the QC checks and the self-review checklist (<code>npm run review</code>). Clinical review happens after implementation (owner decision); nothing here is clinically signed off. Limits and open items are recorded in <a href="${rel('docs/qc/QC_LOG.md')}">docs/qc/QC_LOG.md</a> and <a href="${rel('docs/STATUS.md')}">docs/STATUS.md</a>.</p>
<p><b>${steps.length} plates, ${all.length} claims</b>: ${all.filter((c) => c.verification === 'checked').length} checked against sources, ${all.filter((c) => c.verification !== 'checked').length} still to verify; ${all.filter((c) => c.clinicalReview.status !== 'approved').length} awaiting clinical review.</p>
<h2>Anatomy checks (automated)</h2><table><tr><th>Check</th><th>Result</th><th>Summary</th></tr>${checkRows}</table>
<h2>Self-review checklist</h2><table><tr><th>Area</th><th>Statement</th><th>Compared against</th><th>Evidence</th><th>Self-review</th><th>Clinical</th></tr>${checklist.map(checklistRow).join('')}</table>
${plates}
</body></html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
if (missing.length) {
  console.error(`review: missing evidence files:\n  ${[...new Set(missing)].join('\n  ')}`);
  process.exit(1);
}
console.log(`review: ${steps.length} plates, ${all.length} claims, ${checklist.length} checklist items -> docs/review/index.html`);
