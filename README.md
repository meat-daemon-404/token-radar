[![Token Radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/meat-daemon-404/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/meat-daemon-404/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

A [make.fun](https://make.fun/bounty/token-radar-01) entry for **token-radar-01**: the best token launch radar. It reads a sealed snapshot of every protocol DefiLlama tracks, finds the ones that record no token yet, ranks them by what their launch would be worth, and shows a reader how to farm each one.

## What it does

- **Board of 198 pre-token protocols**, ranked by implied value: the 40 protocols on the snapshot's watchlist, plus every genuine pre-token protocol below the floor. A protocol counts as genuine only when it records no token **and** is not a wrapped, staked or bridged product of a token that already trades — the same rule the watchlist itself uses, applied to the whole snapshot. Wrapped Bitcoin, staked ETH and bridge tokens are left out, because none of them is a protocol still waiting on a launch of its own.
- **Model radar-2, stated in full.** Implied value follows only from the snapshot's own figures:

  `implied = round(tvl_usd x 0.25 x growth x maturity x chains x category x breakout)`

  where growth is the seven-day TVL change clamped to [-60, +120]%, maturity is how long the protocol has run with no token (0.6–1.0), chains rewards a multi-chain footprint (up to 1.20), category gives a small prior for fee-earning categories (1.10) and a discount for RWA and stablecoins (0.90), and breakout (1.10) marks a young protocol growing fast. No protocol name is special-cased; the dashboard recomputes every row live and has a sandbox to try other constants.
- **A farm plan for every row**: six concrete steps with what each costs and how long it takes, derived from the protocol's category, chains, TVL and age.
- **A dashboard a reader can use**: search, category and chain filters, sorting, a live-token view set aside with market caps, a detail view for every protocol with the model's full factor breakdown, and a model sandbox.

Implied value is the entry's own claim, never a promise. A protocol is said to record no token, never to have none: the snapshot is DefiLlama's record, not proof.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes `board.json` and `data.js`, copies `dashboard/` and decodes the three screenshots into `screenshots/`, and writes `dossier.json` with the vendored `vendor/makefun-board.ts`.

The three screenshots are stored in `screenshots/` as base64 text (`.png.b64`) because the upload path carries text only; `main.ts` decodes them byte for byte at build time. They are genuine renders of this dashboard in a headless browser: the board, a protocol's detail view, and a filtered view.

## Files

- `main.ts` — the entrypoint: snapshot in, board + dashboard + dossier out
- `lib/model.ts` — the radar-2 model, the genuine-pre-token rule, the farm plans
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte the kit's copy
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js` (no network)
- `screenshots/` — the three screenshots, base64-encoded, decoded by `main.ts`

## License

MIT
