/**
 * Quick integration test for the CrossRef + OpenAlex citation verification.
 * Run with: node scripts/test-citations.mjs
 *
 * Reads OPENALEX_API_KEY from .env if dotenv is available, otherwise set it manually below.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually (no dotenv dependency needed)
try {
  const envPath = resolve(__dirname, '../.env');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
} catch {
  // No .env file — rely on shell env
}

const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY ?? null;

const TEST_CITATIONS = [
  // Should be FOUND
  'Vaswani et al. (2017). Attention is all you need. NeurIPS.',
  'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436–444.',
  'Brown et al. (2020). Language models are few-shot learners. NeurIPS.',
  // Should be UNVERIFIED (fake)
  'Smith, J. (2099). Quantum telepathy in distributed systems. Journal of Imaginary Science, 1(1), 1–10.',
  'Doe, A. (2023). Thesis supervision using blockchain and crystals. Unpublished manuscript.',
];

async function checkCrossRef(encodedQuery) {
  const res = await fetch(
    `https://api.crossref.org/works?query=${encodedQuery}&rows=1&select=DOI`,
    { headers: { 'User-Agent': 'SuperviseAI/1.0 (mailto:support@superviseai.app)' } },
  );
  if (!res.ok) return { found: false, error: `HTTP ${res.status}` };
  const data = await res.json();
  return { found: (data.message?.items?.length ?? 0) > 0 };
}

async function checkOpenAlex(encodedQuery) {
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', encodedQuery);
  url.searchParams.set('per-page', '1');
  if (OPENALEX_API_KEY) {
    url.searchParams.set('api_key', OPENALEX_API_KEY);
  } else {
    url.searchParams.set('mailto', 'support@superviseai.app');
  }

  const res = await fetch(url.toString());
  if (!res.ok) return { found: false, error: `HTTP ${res.status}` };
  const data = await res.json();
  return { found: (data.results?.length ?? 0) > 0 };
}

async function checkOneCitation(citation) {
  const query = citation
    .replace(/[()[\]]/g, '')
    .slice(0, 150)
    .trim();
  const encoded = encodeURIComponent(query);

  const [crossRef, openAlex] = await Promise.allSettled([
    checkCrossRef(encoded),
    checkOpenAlex(encoded),
  ]);

  const crFound = crossRef.status === 'fulfilled' && crossRef.value.found;
  const oaFound = openAlex.status === 'fulfilled' && openAlex.value.found;

  return {
    citation,
    verified: crFound || oaFound,
    crossRef:
      crossRef.status === 'fulfilled' ? crossRef.value : { found: false, error: crossRef.reason },
    openAlex:
      openAlex.status === 'fulfilled' ? openAlex.value : { found: false, error: openAlex.reason },
  };
}

console.log('─'.repeat(60));
console.log('Citation Verification — CrossRef + OpenAlex');
console.log(`OpenAlex key: ${OPENALEX_API_KEY ? '✓ loaded from .env' : '✗ not set (polite pool)'}`);
console.log('─'.repeat(60));

const start = Date.now();
const results = await Promise.all(TEST_CITATIONS.map(checkOneCitation));
const elapsed = ((Date.now() - start) / 1000).toFixed(2);

for (const r of results) {
  const status = r.verified ? '✓ VERIFIED  ' : '✗ UNVERIFIED';
  const cr = r.crossRef.found ? 'CrossRef ✓' : 'CrossRef ✗';
  const oa = r.openAlex.found ? 'OpenAlex ✓' : 'OpenAlex ✗';
  console.log(`\n${status} | ${cr} | ${oa}`);
  console.log(`  "${r.citation.slice(0, 80)}${r.citation.length > 80 ? '…' : ''}"`);
}

console.log('\n' + '─'.repeat(60));
console.log(`Checked ${results.length} citations in ${elapsed}s (all parallel)`);
console.log(
  `Verified: ${results.filter((r) => r.verified).length} | Unverified: ${results.filter((r) => !r.verified).length}`,
);
