# Contributing

Thanks for looking closer. AniRoll does a lot, and some of it goes deep, so this page is a way in:
how this repository works, where to start reading, and what helps.

## How this repository works

This repository holds **published snapshots** of AniRoll's source, one commit per release. AniRoll is
developed elsewhere, and every change arrives here with the next release. That means a pull request
can't be merged as it is. It is still read, and a good idea finds its way into a later release.

Roll, the Watch Party and the taste match are stubs here, on purpose (see the README,
[The deliberate cut](README.md#the-deliberate-cut)). Each stub says what the module is for and what
every export promises, with its real signature and the files that use it.

## Where to start reading

Reading needs nothing installed. A path that builds up step by step:

1. **README, "How it is built"**: the problems AniRoll solves, one section each.
2. **`js/router.js`**, then a small page like **`js/pages/season.js`**: how a URL becomes a page. Every
   page exports `render({ content, params, query })` and draws into `content`.
3. **`js/store.js`** and **`js/auth.js`**: the little shared state, `esc()` for everything put into
   markup, the login token.
4. **The top of `js/api.js`**: the request budget, the queue for saves, the cache. Then any one query
   function below it; they all follow the same pattern.
5. **`js/pages/home.js`** with **`js/upnext.js`**: follow a +1 on a Continue Watching card
   (the README walks through it).
6. **`api/server.js`**, section by section (`// =====` marks each one), with **`js/jellyfin.js`** next to
   it: the Jellyfin matcher exists in both, with the same rules.
7. For the look: **`js/design.js`**, **`js/m3.js`** and **`css/m3.css`**.

Most files open with a comment saying what they are for. Comments further down explain *why*
something is done a certain way, especially where the obvious way failed.

## What helps

- **Issues**: a bug you ran into on [aniroll.app](https://aniroll.app), a question about how
  something works, an idea.
- **Pull requests**: welcome as a concrete proposal. Keep them small and say what they fix.
- **Security**: please don't describe a vulnerability in a public issue. Use **Report a vulnerability**
  in this repository's Security tab.

## Conventions

If you propose code, it helps when it reads like the rest:

- English in code, comments and the UI. Plain ES modules; every import carries the current `?v=N`.
- Anything from data that goes into markup goes through `esc()` (`js/store.js`). No inline scripts or
  handlers: the Content Security Policy only runs AniRoll's own files.
- Requests to AniList go through `js/api.js` only, so the request budget sees them. List changes use
  `api.progressVars()` and `api.saveMediaListEntry()`.
- Motion checks `prefersReducedMotion()` (`js/animations.js`). No emojis in the UI; dropdowns use
  `js/select.js` rather than the browser's own.
- Comments say why, not what.
- `tools/e2e/` drives every page against a mocked AniList, and `tools/api-test/` checks the matcher, the
  relay and the data files. A change that touches either area comes with a check.
