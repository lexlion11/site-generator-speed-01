# site-generator-speed-01

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/lexlion11/site-generator-speed-01/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/lexlion11/site-generator-speed-01/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A fast static site generator that reproduces the make.fun site pipeline byte-for-byte while
running about twice as fast as the house baseline: front matter, a markdown subset, the
template dialect (templates compiled to code), slug rules, collections, tags, layouts,
pagination and the build report.

- `main.ts` — the driver: reads `cases.json`, runs the build for each case and writes `answers.json`.
- `solve.js` — the generator itself, a dependency-free ES module.

## Run it

```sh
node main.ts
```

The driver reads `cases.json` from the current directory and writes `answers.json` next to it.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
