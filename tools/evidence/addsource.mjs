/*
 * Write a source record from PubMed metadata.
 *
 *   node tools/evidence/addsource.mjs <pmid> <id> <publicationType> [verification] [notes...]
 *
 * e.g. node tools/evidence/addsource.mjs 41748702 iwanaga-2026 anatomical-study abstract "32 hemifaces"
 *
 * The record cites what PubMed returned (authors, title, journal, volume, pages, year, DOI); `verification` says how
 * much of the paper was read ('abstract' by default, since only the abstract is fetched). Claims that rest on
 * a source must be compared with its text before they are marked `checked` (docs/m2-m5-implementation.md).
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [pmid, id, publicationType, verification = 'abstract', ...notes] = process.argv.slice(2);
if (!pmid || !id || !publicationType) {
  console.error('usage: addsource.mjs <pmid> <id> <publicationType> [verification] [notes...]');
  process.exit(2);
}
const dir = resolve(import.meta.dirname, '../../apps/site/src/content/sources');
const file = join(dir, `${id}.json`);
if (existsSync(file)) {
  console.error(`${file} already exists`);
  process.exit(1);
}
const xml = await (await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`)).text();
const dec = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x([0-9A-F]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const authors = [...xml.matchAll(/<Author [^>]*>([\s\S]*?)<\/Author>/g)]
  .map((m) => {
    const last = /<LastName>([\s\S]*?)<\/LastName>/.exec(m[1])?.[1];
    const ini = /<Initials>([\s\S]*?)<\/Initials>/.exec(m[1])?.[1];
    const coll = /<CollectiveName>([\s\S]*?)<\/CollectiveName>/.exec(m[1])?.[1];
    return coll ? dec(coll) : last ? dec(`${last} ${ini ?? ''}`.trim()) : null;
  })
  .filter(Boolean);
const title = dec(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/.exec(xml)?.[1] ?? '').replace(/\.$/, '');
const container = dec(/<ISOAbbreviation>([\s\S]*?)<\/ISOAbbreviation>/.exec(xml)?.[1] ?? /<Title>([\s\S]*?)<\/Title>/.exec(xml)?.[1] ?? '');
const year = Number(/<PubDate>[\s\S]*?<Year>(\d{4})/.exec(xml)?.[1] ?? /<ArticleDate[\s\S]*?<Year>(\d{4})/.exec(xml)?.[1]);
const volume = /<Volume>([\s\S]*?)<\/Volume>/.exec(xml)?.[1];
const pages = /<MedlinePgn>([\s\S]*?)<\/MedlinePgn>/.exec(xml)?.[1];
const doi = /<ArticleId IdType="doi">([\s\S]*?)<\/ArticleId>/.exec(xml)?.[1];
if (!authors.length || !title) {
  console.error('PubMed returned no usable record for', pmid);
  process.exit(1);
}
const record = {
  id,
  citation: { authors, title, container, ...(year ? { year } : {}), ...(volume ? { volume } : {}), ...(pages ? { pages } : {}) },
  publicationType,
  pmid,
  ...(doi ? { doi } : {}),
  url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  status: 'active',
  verification,
  checkedDate: new Date().toISOString().slice(0, 10),
  ...(notes.length ? { notes: notes.join(' ') } : {}),
};
writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
console.log(`wrote ${file}\n  ${authors.slice(0, 3).join(', ')}${authors.length > 3 ? ' et al.' : ''} (${year}) ${title}`);
