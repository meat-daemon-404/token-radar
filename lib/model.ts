// Radar-2: the scoring model behind Token Radar.
//
// What counts as a launch worth farming? A protocol the snapshot records
// with no token at all — no market cap, no CoinGecko id, no ticker — and
// which is not a receipt for a token that already trades. A wrapped coin,
// a staking receipt, a bridge token and a centralised exchange are all
// somebody else's product with a different name on it; a name ending in a
// version number is a release of a protocol that already exists. None of
// those is a protocol still waiting for its own launch, so none of them
// reaches the board. That rule is the same one the snapshot's watchlist
// was built with, applied here to every protocol in the file, including
// the ones below the watchlist's size floor. The board is therefore a
// floor the house drew, not a ceiling: it holds every genuine candidate
// the snapshot knows, watchlist or not.
//
// Nothing in the ranking names a protocol. The score comes only from the
// snapshot's own numbers:
//
//   score = TVL x base
//             x growth
//             x maturity
//             x chains
//             x category
//             x breakout
//
//   growth    1 + clamp(change_7d, -60, +120) / 100 x 0.5
//             A protocol whose TVL is climbing is worth more than one
//             whose TVL is sliding.
//   maturity  0.6 + min(age, 1095) / 1095 x 0.4
//             A protocol that has run for years without a token has a
//             longer runway behind it than one listed last month. When
//             the snapshot gives no listing date, the age is read as
//             365 days.
//   chains    1 + 0.04 x min(chains - 1, 5), never below 1
//             A footprint across several chains is a wider surface
//             to farm.
//   category  1.10 for the fee-earning categories whose tokens have
//             historically been the airdrops (Dexs, Lending,
//             Derivatives, Yield, Yield Aggregator); 0.90 for RWA and
//             Stablecoins, which are regulated or pegged and less
//             likely to run a retail airdrop; 1.00 for the rest.
//   breakout  1.10 when the protocol is younger than 180 days and its
//             seven-day TVL change is above 20%: a young protocol
//             growing fast is the early signal this radar exists to
//             catch. Otherwise 1.00.
//
// The dashboard recomputes every row from the same tuning, and its
// sandbox lets a reader try different base and growth values and watch
// the ranking move. board.json is the submitted ranking; the sandbox
// changes only the page in front of the reader.

import { createHash as hashOf } from 'node:crypto';
import { readFileSync } from 'node:fs';

// One protocol as the sealed snapshot records it: exactly the ten
// fields the snapshot carries, and no others.
export interface ProtocolEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

// The whole sealed snapshot.
export interface Universe {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolEntry[];
  watchlist: string[];
}

// The model's tuning. The dashboard prints these numbers and its
// sandbox lets a reader change the first two and watch the board move.
export interface Tuning {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
  breakout_age_days: number;
  breakout_growth_pct: number;
  breakout_multiplier: number;
}

export const TUNING: Tuning = {
  base_multiple: 1 / 4,
  growth_weight: 1 / 2,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 3 / 5,
  maturity_range: 2 / 5,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 1 / 25,
  chain_cap: 5,
  breakout_age_days: 180,
  breakout_growth_pct: 20,
  breakout_multiplier: 11 / 10,
};

// The model's name, printed on the dashboard.
export const VERSION_LABEL = 'radar-2';

// How many live-token protocols the dashboard's live tab carries.
export const LIVE_COUNT = 24;

// Fee-earning categories, whose tokens have historically been the airdrops.
const FEE_EARNING = new Set(['Dexs', 'Lending', 'Derivatives', 'Yield', 'Yield Aggregator']);
// Regulated or pegged categories, less likely to run a retail airdrop.
const PEGGED_OR_REGULATED = new Set(['RWA', 'Stablecoins']);
// Categories that are never a standalone launch of their own.
const NOT_A_LAUNCH = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
// A name that opens with an exchange's name is that exchange's product.
const EXCHANGE_PREFIXES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];
// A name carrying one of these whole words is a receipt, not a launch.
const RECEIPT_WORD = /\b(wrapped|staked|staking)\b/i;
// A name ending in a version marker is a release of another protocol.
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// One row's factor breakdown, kept so the dashboard can show its work.
export interface ScoreParts {
  growth_pct: number;
  growth_mult: number;
  maturity_mult: number;
  chain_mult: number;
  category_mult: number;
  breakout_mult: number;
  age_days: number | null;
}

// One ranked row of the board.
export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  rank: number;
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_pct: number;
  growth_mult: number;
  maturity_mult: number;
  chain_mult: number;
  category_mult: number;
  breakout_mult: number;
  farm_steps: string[];
  on_watchlist: boolean;
}

// One live-token protocol, shown with the market's own value.
export interface LiveEntry {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

// Everything the dashboard needs: the board, the live set, the tuning.
export interface RadarPayload {
  snapshot_date: string;
  model_version: string;
  model: Tuning;
  rows: BoardRow[];
  live: LiveEntry[];
}

// Read the sealed snapshot and say, in one line, what it holds.
export function loadUniverse(path: string): Universe {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as Universe;
  const fingerprint = hashOf('sha256').update(raw, 'utf8').digest('hex');
  const noToken = parsed.protocols.filter(hasNoToken).length;
  // eslint-disable-next-line no-console
  console.log(
    `snapshot ${fingerprint} ${parsed.protocols.length} protocols, ${parsed.watchlist.length} on the watchlist, ${noToken} recording no token`,
  );
  return parsed;
}

export function universeSummary(universe: Universe): {
  asOf: string;
  count: number;
  watchlist: number;
  preToken: number;
} {
  return {
    asOf: universe.as_of,
    count: universe.protocols.length,
    watchlist: universe.watchlist.length,
    preToken: universe.protocols.filter(hasNoToken).length,
  };
}

// Whole days from the protocol's listing date to the snapshot's date;
// null when the snapshot gives no listing date.
export function daysListed(universe: Universe, entry: ProtocolEntry): number | null {
  if (entry.listed_at === null) return null;
  const from = Date.parse(entry.listed_at);
  const to = Date.parse(universe.as_of);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

// The snapshot records no token for this protocol.
export function hasNoToken(entry: ProtocolEntry): boolean {
  return entry.mcap_usd === null && entry.gecko_id === null && entry.symbol === null;
}

// A genuine launch candidate: no token, and none of the marks of a
// receipt, an exchange product, or a version of another protocol.
export function isLaunchCandidate(entry: ProtocolEntry): boolean {
  if (!hasNoToken(entry)) return false;
  if (NOT_A_LAUNCH.has(entry.category ?? '')) return false;
  if (VERSION_TAIL.test(entry.name)) return false;
  if (RECEIPT_WORD.test(entry.name)) return false;
  const lowered = entry.name.toLowerCase();
  if (EXCHANGE_PREFIXES.some((prefix) => lowered.startsWith(prefix))) return false;
  return true;
}

// The category factor: 11/10, 9/10, or 1.
export function categoryFactor(category: string | null): number {
  if (category !== null && FEE_EARNING.has(category)) return 11 / 10;
  if (category !== null && PEGGED_OR_REGULATED.has(category)) return 9 / 10;
  return 1;
}

// One protocol's implied value and the factors behind it.
export function scoreProtocol(
  universe: Universe,
  entry: ProtocolEntry,
  tuning: Tuning = TUNING,
): { implied: number; parts: ScoreParts } {
  const age = daysListed(universe, entry);
  const ageForMaturity = age === null ? tuning.unknown_age_days : age;
  const growth = Math.min(tuning.growth_cap, Math.max(tuning.growth_floor, entry.change_7d ?? 0));
  const growthMult = 1 + (growth / 100) * tuning.growth_weight;
  const maturityMult =
    tuning.maturity_floor +
    (Math.min(Math.max(ageForMaturity, 0), tuning.maturity_days) / tuning.maturity_days) * tuning.maturity_range;
  const chainMult =
    1 + tuning.chain_step * Math.min(Math.max(entry.chains.length - 1, 0), tuning.chain_cap);
  const categoryMult = categoryFactor(entry.category);
  const breakoutMult =
    age !== null && age < tuning.breakout_age_days && growth > tuning.breakout_growth_pct
      ? tuning.breakout_multiplier
      : 1.0;
  const implied = Math.max(
    1,
    Math.round(
      entry.tvl_usd *
        tuning.base_multiple *
        growthMult *
        maturityMult *
        chainMult *
        categoryMult *
        breakoutMult,
    ),
  );
  return {
    implied,
    parts: {
      growth_pct: growth,
      growth_mult: growthMult,
      maturity_mult: maturityMult,
      chain_mult: chainMult,
      category_mult: categoryMult,
      breakout_mult: breakoutMult,
      age_days: age,
    },
  };
}

// How much capital one farm position takes, from the protocol's own TVL.
function stakeFor(entry: ProtocolEntry): string {
  if (entry.tvl_usd < 10_000_000) return '$25';
  if (entry.tvl_usd < 100_000_000) return '$100';
  if (entry.tvl_usd < 1_000_000_000) return '$250';
  return '$500';
}

// How long to stay in, from the protocol's age: the younger it is, the
// longer the qualifying window.
function stayDays(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 540) return 60;
  return 30;
}

// The one action that fits the protocol's category, in words a farmer
// can follow without guessing.
function categoryMove(entry: ProtocolEntry, stake: string, chain: string): string {
  const name = entry.name;
  switch (entry.category) {
    case 'Dexs':
      return `Put ${stake} of liquidity into the deepest pool on ${name} (${chain}) and leave it working for the whole stay.`;
    case 'Lending':
      return `Lend ${stake} of USDC on ${name} (${chain}) and borrow a little of a stablecoin against it, so the wallet touches both sides of the market.`;
    case 'Yield':
    case 'Yield Aggregator':
      return `Place ${stake} of USDC in the biggest vault ${name} runs on ${chain} and keep the vault shares until the stay ends.`;
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return `Put ${stake} of USDC into a vault ${name} looks after on ${chain}, and note down which curator and vault you chose.`;
    case 'Derivatives':
      return `Post ${stake} of USDC as margin on ${name} (${chain}), open a single small position, and close it within the week.`;
    case 'CDP':
    case 'CDP Manager':
      return `Open a vault on ${name} (${chain}), lock ${stake} of ETH in it as collateral, and mint a small amount of its stable asset.`;
    case 'RWA':
      return `Buy ${stake} of the yield-bearing asset ${name} issues on ${chain} and keep the receipt token.`;
    case 'Prediction Market':
      return `Fund ${stake} on ${name} (${chain}) and take one position in a market that is still running.`;
    case 'Insurance':
      return `Buy ${stake} of cover from ${name} on ${chain} and keep the policy live for the whole stay.`;
    case 'Stablecoins':
      return `Mint or deposit ${stake} of the stable asset through ${name} on ${chain} and hold it.`;
    case 'Bridge':
    case 'Canonical Bridge':
      return `Bridge ${stake} of USDC through ${name} to ${chain} and back once, keeping the receipt.`;
    case 'Liquid Staking':
    case 'Liquid Restaking':
      return `Stake ${stake} of ETH through ${name} on ${chain} and keep the receipt token.`;
    default:
      return `Deposit ${stake} of USDC into ${name} on ${chain} and leave it in place for the whole stay.`;
  }
}

// Six steps, each with what it costs and how long it takes. The plan
// follows the protocol's category, its chains, its TVL and its age, so
// a two-chain DEX gets a different plan from a single-chain lending
// market.
export function planFarm(universe: Universe, entry: ProtocolEntry): string[] {
  const stake = stakeFor(entry);
  const chain = entry.chains[0] ?? 'Ethereum';
  const age = daysListed(universe, entry);
  const stay = stayDays(age);
  const plan: string[] = [];
  plan.push(
    `Make a fresh wallet for this farm alone and write its seed phrase on paper, kept offline; never farm from a wallet that holds anything else. Cost: $0. Time: 10 minutes.`,
  );
  plan.push(
    `${categoryMove(entry, stake, chain)} Cost: ${stake} plus about $2 in network fees. Time: 20 minutes.`,
  );
  if (entry.chains.length > 1) {
    plan.push(
      `Do one qualifying action on a second chain ${entry.name} runs on (${entry.chains[1]}) so the activity is not on one chain only. Cost: $10 plus about $2 in network fees. Time: 15 minutes.`,
    );
  } else {
    plan.push(
      `Do one qualifying action on ${entry.name} every week for the whole stay, so the wallet reads as active instead of a one-off deposit. Cost: about $2 in network fees a week. Time: 10 minutes a week.`,
    );
  }
  plan.push(
    `Open ${entry.name}'s own app and look for a points, rewards or quest page; join it with the same wallet and finish any free task it lists. Cost: $0. Time: 15 minutes.`,
  );
  plan.push(
    `Leave the position open for at least ${stay} days; do not pull out early, because airdrop snapshots usually reward time in the protocol. Cost: $0. Time: ${stay} days.`,
  );
  plan.push(
    `When a claim opens, use only the link ${entry.name} publishes on its own site or official account, and write the wallet, the dates and every transaction in a farm log. Cost: $0. Time: 20 minutes.`,
  );
  return plan;
}

// The live-token protocols, largest market cap first, for the
// dashboard's live tab. These already trade, so the board shows the
// market's own value for them, never a model's.
function liveEntries(universe: Universe): LiveEntry[] {
  return universe.protocols
    .filter((entry) => !hasNoToken(entry) && entry.mcap_usd !== null && entry.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, LIVE_COUNT)
    .map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      category: entry.category ?? 'Unknown',
      chains: entry.chains,
      tvl_usd: entry.tvl_usd,
      mcap_usd: entry.mcap_usd as number,
      change_7d: entry.change_7d,
    }));
}

// Score every genuine candidate and rank the board, strongest first.
// Ties keep the snapshot's own order (its protocols are sorted by slug).
export function buildPayload(universe: Universe, tuning: Tuning = TUNING): RadarPayload {
  const watchlist = new Set(universe.watchlist);
  const scored = universe.protocols
    .filter(isLaunchCandidate)
    .map((entry) => {
      const { implied, parts } = scoreProtocol(universe, entry, tuning);
      return { entry, implied, parts, listed: watchlist.has(entry.slug) };
    })
    .sort((a, b) => b.implied - a.implied);
  const rows: BoardRow[] = scored.map((item, index) => {
    const entry = item.entry;
    const parts = item.parts;
    return {
      slug: entry.slug,
      name: entry.name,
      category: entry.category ?? 'Unknown',
      chains: entry.chains,
      rank: index + 1,
      tvl_usd: entry.tvl_usd,
      change_7d: entry.change_7d,
      age_days: parts.age_days,
      implied_value_usd: item.implied,
      growth_pct: parts.growth_pct,
      growth_mult: parts.growth_mult,
      maturity_mult: parts.maturity_mult,
      chain_mult: parts.chain_mult,
      category_mult: parts.category_mult,
      breakout_mult: parts.breakout_mult,
      farm_steps: planFarm(universe, entry),
      on_watchlist: item.listed,
    };
  });
  return {
    snapshot_date: universe.as_of.slice(0, 10),
    model_version: VERSION_LABEL,
    model: tuning,
    rows,
    live: liveEntries(universe),
  };
}

// The board as the gate reads it: slug, rank, implied value, farm steps.
export function boardForGate(payload: RadarPayload): Record<string, unknown>[] {
  return payload.rows.map((row) => ({
    slug: row.slug,
    rank: row.rank,
    implied_value_usd: row.implied_value_usd,
    farm_steps: row.farm_steps,
  }));
}

// Why the gate would refuse this board, or null when it passes: size,
// one slug once, ranks exactly 1 to N, the whole watchlist covered,
// every row a genuine candidate, implied values non-increasing and in
// range, and farm steps in count and in length.
export function boardProblem(board: Record<string, unknown>[], universe: Universe): string | null {
  const slugs = board.map((row) => row.slug as string);
  const count = board.length;
  if (count < 100 || count > 4000) return `board has ${count} rows, outside 100 to 4000`;
  if (new Set(slugs).size !== count) return 'board has a repeated slug';
  const ranks = new Set(board.map((row) => row.rank as number));
  if (
    ranks.size !== count ||
    board.some((row) => (row.rank as number) < 1 || (row.rank as number) > count)
  ) {
    return 'board ranks are not exactly 1 to N';
  }
  for (const slug of universe.watchlist) {
    if (!slugs.includes(slug)) return `board misses a watchlist protocol: ${slug}`;
  }
  const genuine = new Set(universe.protocols.filter(isLaunchCandidate).map((entry) => entry.slug));
  for (const slug of slugs) {
    if (!genuine.has(slug)) return `board holds a protocol that is not a genuine pre-token launch: ${slug}`;
  }
  if (genuine.size !== count) return `board covers ${count} of ${genuine.size} genuine pre-token protocols`;
  const values = board.map((row) => row.implied_value_usd as number);
  for (let i = 1; i < values.length; i += 1) {
    if (values[i]! > values[i - 1]!) return `board implied value rises from rank ${i} to rank ${i + 1}`;
  }
  if (values.some((value) => !Number.isInteger(value) || value <= 0 || value > 1e14)) {
    return 'board has an implied value that is not a positive integer at most 1e14';
  }
  for (const row of board) {
    const steps = row.farm_steps as string[];
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) {
      return `board row ${row.slug} has ${Array.isArray(steps) ? steps.length : 'no'} farm steps`;
    }
    for (const step of steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `board row ${row.slug} has a farm step outside 20 to 600 characters`;
      }
    }
  }
  return null;
}

// The dashboard's data file: the payload as one script, no fetch.
export function payloadScript(payload: RadarPayload): string {
  return `window.RADAR = ${JSON.stringify(payload)};\n`;
}
