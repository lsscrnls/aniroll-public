# AniRoll

**Can't decide what to watch? Roll for it.** AniRoll is an anime tracker on top of your
[AniList](https://anilist.co) account: it picks tonight's show from your Planning list, runs watch
parties with friends, tracks what you play in Jellyfin, and shows the week's episodes at a glance.

Live at **[aniroll.app](https://aniroll.app)**. Log in with AniList; your list stays on AniList.

![Roll: the reel spins through your Planning list and lands on tonight's show](docs/screenshots/clip-roll.webp)

This repository is here so you can **read how AniRoll works**. It is not a kit for running your own
copy: Roll, the Watch Party and the taste match are left out (see [What's not in here](#whats-not-in-here)).

## What it does

- **Roll**: a slot-machine reel picks from your Planning list, filtered by length, score and genre,
  optionally with recommended titles that aren't on your list yet.
- **Watch Party**: the host counts episodes, guests follow along and their AniList moves with them.
- **Home**: the show you're on with a live countdown to its next episode, then everything else you watch.
- **Jellyfin live tracking**: an episode played past 90% counts as watched, rewatches included.
- **Calendar**: the week (or month) with air times and where you stand on each show.
- **Recommendations with a taste match** from your own scores, genres and tags.
- **My List**, **Social** (your AniList feed), **scores in your AniList format**, installable as a PWA.
- **Two designs**: AniRoll's own, or **Material 3 Expressive** in the colours of the show you watched last.

| AniRoll | Material 3 Expressive |
|---|---|
| ![AniRoll's design: Home with the show you're on and its countdown, then an accent colour by swatch and hex code](docs/screenshots/clip-design-aniroll.webp) | ![Material 3 Expressive: Home themed from the show you're on, widgets, +1 and Roll](docs/screenshots/clip-m3.webp) |
| Monochrome and cinematic, one accent colour of your choice. | Themed from your last show: its cover becomes the wallpaper, every surface follows. |

| My List | Calendar |
|---|---|
| ![My List: +1 on a card, then the Planning tab](docs/screenshots/clip-list.webp) | ![Calendar: all airing shows, month and week](docs/screenshots/clip-calendar.webp) |
| **Taste match** | **Home** |
| ![Recommendations with their match, one opened in the detail panel](docs/screenshots/clip-match.webp) | ![Home: the show you're on, a countdown to its next episode, then Continue Watching](docs/screenshots/home.webp) |

<p align="center">
  <img src="docs/screenshots/mobile-roll.webp" width="260" alt="Roll on a phone">
  &nbsp;&nbsp;
  <img src="docs/screenshots/mobile-home.webp" width="260" alt="Home on a phone">
</p>

Screenshots and clips show a made-up demo account; the shows are real, from AniList.

## How the code is laid out

Plain JavaScript ES modules, loaded by the browser as they are: no framework, no bundler, no build
step. Every import carries `?v=N`, raised on each release, so browsers never mix old and new modules.

**Start here:** `index.html` loads `js/app.js`, which sets up the shell (navigation, avatar menu,
settings, background jobs) and hands the URL to `js/router.js`. The router maps `#/list`, `#/roll`, …
to a module in `js/pages/`, and each page exports one `render({ content, query })`.

| Where | What it holds |
|---|---|
| `js/api.js` | Everything that talks to the [AniList GraphQL API](https://docs.anilist.co): queries, the request budget, the cache, the queue for saves |
| `js/store.js` | Small shared state (user, settings), escaping, toasts, score formats, events other modules listen to |
| `js/auth.js` | The AniList login token, kept in `localStorage` |
| `js/pages/*.js` | One module per page: `home`, `list`, `calendar`, `detail` (the slide-in panel), `social`, `search`, … |
| `js/upnext.js`, `js/home-cinema.js` | What Home says about your list (next episode, what's waiting, the week) and AniRoll's Home on top of it |
| `js/design.js`, `js/m3.js`, `css/m3.css` | The design switch; Material 3's palette, generated from one seed colour, and its extra pieces (hero, widgets, cursor) |
| `js/jellyfin.js`, `js/nowplaying.js` | Jellyfin: matching what you played to an AniList entry, the *Now watching* chip |
| `js/a11y.js`, `js/select.js` | Dialogs that trap focus and close on Escape, keyboard activation, styled selects |
| `js/whatsnew.js` | The changelog and the pop-up for returning visitors |
| `api/server.js` | The small Node backend: Jellyfin relay and webhook, background sync, share pages, error log |
| `css/style.css` | AniRoll's own design; `css/m3.css` is only loaded in Material 3 |

### One action, followed through the code

Pressing **+1** on a Continue Watching card (`js/pages/home.js`):

1. The card updates at once: progress text, bar, and the button disappears on the last episode.
2. `api.progressVars()` works out what else changes with the episode (a planned show becomes
   *Watching*, the last episode completes it or counts a rewatch, start and end dates get filled in),
   then `api.saveMediaListEntry()` sends it.
3. Saves for the same entry are chained, so three quick clicks arrive at AniList in order, and only the
   newest target is sent.
4. `api.js` takes a slot from the request budget. If AniList is rate limiting, the save waits in a queue
   in `localStorage` and goes out later; the card keeps the new number.
5. The card emits `aniroll:watched` (`js/store.js`): Material 3 listens and re-colours the app from
   the show you just watched. Home's hero presses this same card's button, so there is one code path for saving.

### Ideas worth reading

- **A request budget shared by every tab** (`js/api.js`): at most 20 AniList requests per rolling
  minute, counted in `localStorage`. On a 429 everything pauses for five minutes; reads come from a
  RAM + IndexedDB cache, writes wait in a queue that drains slowly. Identical queries in flight share one request.
- **Strict Jellyfin matching** (`js/jellyfin.js`, the same rules in `api/server.js`): a wrong guess
  would move someone's list on the wrong show, so a year in either title has to agree, the episode has to
  fit, and shows that share a name are told apart before anything is written. A correction by hand wins
  over a later playback.
- **Secrets at rest** (`api/server.js`): Jellyfin keys and AniList tokens for background sync are
  stored encrypted, with the key outside the data volume; data files are written atomically.
- **A relay that can't be turned inward** (`api/server.js`): it only forwards the few Jellyfin endpoints
  AniRoll calls, and refuses private addresses in the connection itself, so DNS can't be used to reach localhost.
- **Material 3 from one colour** (`js/design.js`): Google's Material Color Utilities turn the cover
  colour of your last show into a full light and dark scheme; the wallpaper is that cover, blurred once
  on a tiny canvas instead of with a costly CSS blur.
- **Motion that respects you** (`js/animations.js`): GSAP and Lenis, off entirely with *Reduce motion*.

## What's not in here

The parts that make AniRoll AniRoll are not published:

- **Roll** (`js/pages/roll.js`, `js/reel.js`)
- **Watch Party** (`js/pages/watchparty.js`, and its server side `api/party.js`)
- **Taste match** (`js/taste.js`)

In this repository they are stubs with the same exports, so the rest of the app still loads and reads
coherently. This repository only ever held published snapshots, so older commits don't have them either.

AniRoll is built with Vanilla JS, [GSAP](https://gsap.com), [Lenis](https://lenis.darkroom.engineering),
the self-hosted [Inter](https://rsms.me/inter/) font and Material Symbols. All anime data comes from AniList.
