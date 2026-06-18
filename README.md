# AlgoLore

Three opening-range-breakout strategies trade the same watchlist on the same Alpaca paper account — but they disagree about *when* to enter a breakout, and each one keeps its own version-controlled memory of what it tried and why.

The idea came out of a problem I kept hitting with strategy research: a backtest gives you a number, but it forgets the reasoning the moment the notebook restarts. You end up with a folder of un-versioned experiments and a trade journal nobody updates. AlgoLore puts each strategy's reasoning on a [MemForks](https://github.com/memforks-dev/memforks) branch instead — so changes of conviction fork rather than overwrite, and at the end of a session only the strategy that actually performed gets its lesson merged into the shared playbook. The ones that lost stay around, isolated, so you can go back and read what they were thinking.

---

## The three strategies

They all watch the same opening-range breakout. The only thing they disagree on is the trigger.

- **orb-immediate** — buys as soon as price clears the opening-range high (after the first 6 minutes). Bets that strong names just go.
- **orb-retest** — waits for the break, a pullback toward the OR high, then a reclaim. Bets the pullback shakes out weak hands and gives a tighter stop.
- **orb-shakeout** — only enters after price breaks, flushes *below* the OR low, and reclaims it. Bets that the flush clears out stops before the real move.

Sizing, bracket orders, scaling, and exits are identical across all three. Only the entry timing and the written thesis differ — which is the whole point. When orb-immediate is already long and orb-shakeout is still flat waiting for a flush, you've got two strategies taking different sides of the same setup, both on the record, both with real paper fills behind them.

---

## Why MemForks and not just a database

MemForks is version control for agent memory — branches, commits, recall, merge, anchored on Sui. A flat key-value store (or MemWal on its own) would let you log everything, but you'd lose the thing that makes this useful: a *boundary*.

With branches you get three properties that matter here:

- Two strategies can hold contradictory views on the same ticker at the same time, each on its own branch, without stepping on each other.
- A conviction reversal mid-trade forks a new branch off the current thesis instead of rewriting it, so the history of *why* a strategy changed its mind survives.
- At session close, you merge only the winner's lesson into `strategy/main`. The losers are never merged — but their branches are still there to query later.

Without that boundary the strategies' reasoning blends into one soup, or a losing strategy's bad habits leak into shared memory because there's nothing stopping them. The branch is what stops them.

---

## How the pieces fit

The split I cared most about: **the model never places an order.** It writes the entry thesis and the postmortem. Everything that moves money is mechanical, ported from a trading system I'd already run in real conditions.

- **Sizing** is R-based. `R = entry − OR low`. Shares = `floor((risk_dollars / R) × conviction_mult)`, capped at a dollar limit. Risk per trade is the smaller of a fixed cap and a percent of equity.
- **Entries** are bracket orders — market in, take-profit out, stop-loss at the OR low. The stop is live at the broker the moment you fill.
- **Management** sells half at the 1R target and trails the rest.
- **Exits** are hard-coded: stop at OR low, flat by 15:55 ET, and a daily-loss limit that halts new entries.
- **P&L is in R**, so a +2R win and a −1R loss compare cleanly across strategies regardless of share count.

The LLM work goes through `@memfork/vercel-ai`, which recalls the branch's recent lessons before the model writes a thesis and commits the postmortem after. Each strategy's loop is a LangGraph graph checkpointed to its branch via `@memfork/langgraph`. Branch and merge plumbing is `@memfork/core`.

```
shared/      types, env config, market-clock helpers
strategies/  the 3 variant definitions + seeded house rules
trading/     broker/alpaca.ts · sizing.ts · lifecycle.ts · metrics.ts
scanner/     gap-scanner.ts (watchlist gates) · orb-watcher.ts (tick state machine)
memory/      client · topology · rules · merge
agents/      state · nodes · graph · session · disagreements
app/api/     admin/init · session/{start,close} · positions · strategies/disagreements
```

---

## The loop

One graph per strategy, one branch per graph:

```
observe → risk_gate → decide → trade → manage → exit → postmortem
```

- **observe** — look for an entry signal matching this strategy's rule (skips the first 6 minutes).
- **risk_gate** — past EOD? daily loss hit? already in this name? bail if so.
- **decide** — recall the branch's prior lessons + house rules, write a short thesis.
- **trade** — size it, send the bracket, commit the thesis (forking if it's a reversal).
- **manage** — scale half at 1R, arm the trailing stop.
- **exit** — flat at EOD, or pick up a broker-side stop fill.
- **postmortem** — write what was surprising and the rule to remember; commit it.

---

## Session close

`POST /api/session/close` is where the strategies actually get judged:

1. Compute R-based metrics per strategy from its closed trades: avg R, win rate, profit factor, expectancy. (Annualized Sharpe on a handful of intraday trades is noise — expectancy is the number worth ranking on.)
2. Rank by expectancy. A steady +0.4R over 8 trades beats one lucky +3R.
3. Only merge if the winner cleared at least 3 trades with positive expectancy — otherwise it's not signal yet.
4. Pull the winner's lesson off its branch, stage it, and merge into `strategy/main` with the window, the metrics, and the Sui anchor attached.
5. Losers stay unmerged and queryable. Next session's strategies fork fresh from `main` and inherit the winner's lesson.

---

## Running it

You'll need Node 20+, an Alpaca **paper** account, an OpenAI key, and MemForks credentials (`npx @memfork/cli init --quick` provisions a testnet tree).

```bash
npm install
```

`.env.local`:

```bash
# MemForks
MEMFORK_TREE_ID=
MEMFORK_PRIVATE_KEY=
MEMFORK_MEMWAL_ACCOUNT=
MEMFORK_MEMWAL_KEY=

# OpenAI
OPENAI_API_KEY=

# Alpaca paper
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_FEED=iex

# protects the admin/session routes
ADMIN_SECRET=

# risk knobs — defaults shown
MAX_RISK_PER_TRADE=50
MAX_RISK_PCT=0.005
MAX_POSITION_USD=3000
MAX_CONCURRENT_POSITIONS=3
DAILY_LOSS_LIMIT=300
TRAIL_PERCENT=2.0
EOD_FLAT_TIME=15:55
```

Provision the branches once (idempotent — creates `strategy/main` and the three variants):

```bash
curl -X POST http://localhost:3000/api/admin/init -H "x-admin-secret: $ADMIN_SECRET"
```

Start the dev server and kick off a session:

```bash
npm run dev

curl -X POST http://localhost:3000/api/session/start \
  -H "x-admin-secret: $ADMIN_SECRET" -H "content-type: application/json" \
  -d '{"tickers": ["AAPL","TSLA","NVDA","AMD","SOFI"]}'
```

---

## Routes

| Route | Method | What it does |
| --- | --- | --- |
| `/api/admin/init` | POST | Create the branch topology (idempotent). |
| `/api/session/start` | POST | Launch the three strategies on a watchlist. |
| `/api/session/close` | POST | Rank by expectancy, merge the winner's lesson into `main`. |
| `/api/positions` | GET | Live positions + account equity / day P&L. |
| `/api/strategies/disagreements` | GET | Tickers where the strategies currently disagree. |

---

## Branch layout

```
strategy/main                          house rules + the playbook that compounds
├── strategy/orb-immediate             break-and-go
├── strategy/orb-retest                pullback-reclaim
├── strategy/orb-shakeout              flush-and-reclaim
├── strategy/<variant>/lesson          staged at session close, merged into main
└── strategy/<variant>/conviction@<ts> forked when a strategy reverses mid-trade
```

---

## Stack

Next.js 16 · Alpaca paper trading + market data · LangGraph · Vercel AI SDK · MemForks on Sui · TypeScript.

## A note on scope

This runs against Alpaca paper trading only. It's a research tool, not advice, and it's not wired for live capital — that would need a human approval step before any real order, which I left out on purpose.
