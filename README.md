# Stash

Your X bookmarks, turned into a strategy report for the project you're building.

You bookmark things "for later" and never look again. Now you don't have to.
Stash has your agent map what your project has really built, read every
bookmark you **saved** in a date range, and come back with fully argued ideas
tied to your actual code, plus the ideas you had and lost track of.

## Install

```bash
npx skills add Mouaddotmd/stash --skill stash
```

Then, in your project, tell your agent:

> stash my bookmarks from Nov 1 to Nov 3

**Start with a few days.** The first read of a big backlog uses a lot of your
agent plan: 1,000+ bookmarks can take hundreds of thousands of tokens. Bookmarks
it has read are remembered, so later runs only pay for what's new.

## What you get

`.stash/board.html`, a report you can read instead of your bookmarks:

- **Where the project stands** and where your saves say it should go
- **Lost ideas:** things you keep saving but never built, interests that faded,
  ideas from your own docs that are newly possible, and ideas someone else has
  now shipped
- **Ideas with a real argument:** what it is, why now, how it would work in your
  product, what it costs, the best case against it, and where to start. Each one
  is checked against your code, and at least one is an original combination that
  no single post says.
- **Themed boards** of every bookmark that matters, with why it matters to you
- **Find a post:** search everything Stash has read, by what you remember

## How it works

- **By the day you saved it.** "Nov 1 to Nov 3" means everything you bookmarked
  in those days, whether that's 5 or 500.
- **Fast.** Loading takes about a minute per month of bookmarks.
- **No X API key.** Your agent opens your bookmarks in your own logged-in browser
  and asks X's page to load the next pages, the same loader it uses when you
  scroll. It never likes, reposts or unbookmarks, and never reads cookies or tokens.
- **One click to save.** Stash adds a **Save to Stash** button to the page. It
  opens a small helper window that hands your bookmarks to a receiver on your own
  computer, which then exits by itself.
- **The thinking is your agent's**, on the plan you already pay for.

## Privacy

Your bookmarks go from the page to `127.0.0.1` and into `.stash/` in your project,
which ignores itself in git. Stash has no server, no analytics and no account.
Your agent reads your bookmarks to do its work, so they're handled under your
agent provider's terms, like anything else you show it.

## Use at your own risk

Stash automates your own browser on X, and X's terms restrict automated access.
It's deliberately gentle, but that risk is yours to weigh. It also reads X's
internal page structure, so an X redesign can break it until it's patched.

## Known limits

- It reads only the first post of a thread.
- It can't read inside X Articles. It counts them and tells you.
- It sees video frames but doesn't hear audio.
- Videos need macOS for frames. Elsewhere, they're judged by their thumbnail.

## Needs

- An agent that can control your browser (e.g. Claude Code + Claude in Chrome)
- Node 18+

## Files

```
skills/stash/
  SKILL.md              the steps your agent follows
  scripts/project.mjs   what to read to map your project, and if the map is stale
  scripts/stash.js      runs in your bookmarks tab: load by date, read, save
  scripts/bridge.mjs    receives bookmarks on 127.0.0.1, then exits
  scripts/index.mjs     the private index: ingest, merge, topics, search
  scripts/media.mjs     images + video frames for the relevant ones
  scripts/frames.swift  frame grabber (macOS)
  scripts/check.mjs     refuses a thin or unverifiable report
  scripts/board.mjs     builds .stash/board.html
tests/smoke.mjs         runs the whole pipeline on made-up bookmarks
```

## Develop

```bash
npm test
```

No dependencies. The test uses made-up data and needs no browser or X account.

## License

MIT
