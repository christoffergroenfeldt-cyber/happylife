// Happy Life – price check helper for .github/workflows/price-check.yml
//   node scripts/price-check.mjs jobs  -> prints work=yes|no, writes work/jobs.json
//   node scripts/price-check.mjs save  -> saves work/offers.json via price_save()
// Uses the public anon key + the server key (HL_SCHOOL_KEY); the database
// checks every offer again. The repo is public: the log shows counts only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const js = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const URL_ = js.match(/SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const ANON = js.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/)[1];
const KEY = (process.env.HL_SCHOOL_KEY || '').trim();
const WORK = new URL('../work/', import.meta.url);

async function rpc(name, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: 'POST', body: JSON.stringify(args),
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return text ? JSON.parse(text) : null;
}

async function jobs() {
  if (!KEY || !process.env.HAS_CLAUDE) {
    console.log('work=no');
    console.error(!KEY ? 'HL_SCHOOL_KEY is not set' : 'CLAUDE_CODE_OAUTH_TOKEN is not set – see README, Price watch');
    return;
  }
  let res;
  try { res = await rpc('price_jobs', { p_key: KEY }); } catch (e) {
    console.log('work=no'); console.error(`check failed: ${e.message}`); return;
  }
  mkdirSync(WORK, { recursive: true });
  writeFileSync(new URL('jobs.json', WORK), JSON.stringify(res.watches, null, 1));
  console.log(`work=${res.due ? 'yes' : 'no'}`);
  console.error(`products due: ${res.watches.length} (${res.watches.filter((w) => w.queued).length} asked for now)`);
}

async function save() {
  const watches = JSON.parse(readFileSync(new URL('jobs.json', WORK), 'utf8'));
  let results = [];
  const file = new URL('offers.json', WORK);
  if (existsSync(file)) {
    try { results = JSON.parse(readFileSync(file, 'utf8')).results || []; } catch { console.error('offers.json is not valid JSON'); }
  } else console.error('no offers.json – the price search did not finish');
  let saved = 0, offers = 0;
  for (const w of watches) {
    const r = results.find((x) => x && x.id === w.id);
    try {
      offers += await rpc('price_save', {
        p_key: KEY, p_id: w.id, p_offers: Array.isArray(r?.offers) ? r.offers : [],
        p_sources: Array.isArray(r?.sources) ? r.sources : [],
        p_advice: typeof r?.advice === 'string' ? r.advice : null,
        p_note: r ? (typeof r.note === 'string' ? r.note : null) : 'Kunne ikke tjekkes denne gang – prøver igen næste morgen',
      });
      saved += 1;
    } catch (e) { console.error(`save failed: ${e.message}`); }
  }
  console.error(`saved ${saved}/${watches.length} products, ${offers} offers`);
}

await ({ jobs, save }[process.argv[2]] || (() => { throw new Error('use: jobs | save'); }))();
