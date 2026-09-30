# AniRoll

**Can't decide what to watch? Roll for it.** AniRoll is an anime tracker on top of your
[AniList](https://anilist.co) account: it picks tonight's show from your Planning list, runs watch
parties with friends, tracks what you play in Jellyfin, and shows the week's episodes at a glance.

Live at **[aniroll.hxlx.de](https://aniroll.hxlx.de)**. Log in with AniList; your list stays on AniList.

![Roll: the reel spins through your Planning list and lands on tonight's show](docs/screenshots/clip-roll.webp)

## Read this first

This repository is a **showcase, not a kit**. It shows how AniRoll is built. It is not meant to be
cloned and run as your own copy: the code is **all rights reserved** ([LICENSE](LICENSE)). Reading it and
learning from it is welcome; copying, redistributing or hosting it needs my written permission.

**Everything AniRoll stands on is here**: talking to a rate-limited API with no backend of its own
in between, caching that keeps working offline, keeping two accounts in one browser apart, writing to
someone's list only when that is safe, a small server that holds secrets, a Material 3 Expressive design of its own, and
no bundler anywhere.

**Three pieces are cut on purpose**: Roll, the Watch Party and the taste match. They are what makes
AniRoll *AniRoll*. Their files are here as stubs with the same exports, so you can see exactly where
they plug in and what they get to work with. How they work inside is the part you have to think
through yourself. [More on the cut](#the-deliberate-cut).

New to the code? [CONTRIBUTING.md](CONTRIBUTING.md) suggests where to start reading.

## What it does

- **Roll**: a slot-machine reel picks from your Planning list, filtered by length, score and genre,
  optionally with recommended titles that aren't on your list yet; every show gets its turn before one comes back.
- **Watch Party**: the host counts episodes, guests follow along and their AniList moves with them.
- **Home**: the show you're on with a live countdown to its next episode, then everything else you watch
  and what from your Planning list starts soon.
- **Play from Jellyfin**: episodes from your own Jellyfin server play right in AniRoll, subtitles as the release styled them,
  with skip intro; sign-in by Quick Connect, no password typed into AniRoll.
- **Jellyfin live tracking**: an episode played past 90% counts as watched, rewatches included.
- **Calendar**: the week (or month) with air times and where you stand on each show.
- **Recommendations with a taste match** from your own scores, genres and tags.
- **Studio and voice actor pages**: everything a studio made, every role a voice actor plays; related shows as covers, spoiler tags only on request.
- **My List** with format chips, **Social** (your AniList feed), **scores out of 100** whatever your AniList format, installable as a PWA.
- **Material 3 Expressive**, in the colours of the show you watched last: its cover becomes the wallpaper,
  every surface follows. AniRoll's first design stays available as a legacy option in Settings.

![Material 3 Expressive: Home themed from the show you're on, widgets, +1 on a card, then Roll](docs/screenshots/clip-m3.webp)

| My List | Calendar |
|---|---|
| ![My List: +1 on a card, then the Planning tab](docs/screenshots/clip-list.webp) | ![Calendar: all airing shows, month and week](docs/screenshots/clip-calendar.webp) |
| **Taste match** | **Home** |
| ![Recommendations with their match, one opened in the detail panel](docs/screenshots/clip-match.webp) | ![Home: the show you're on, a countdown to its next episode, then Continue Watching](docs/screenshots/home.webp) |

**Play from Jellyfin**: an episode picked from the list, Skip intro, subtitles drawn the way the release styled them

![The player: Episodes on a show's page, an episode started, the Audio & subtitles menu, Skip intro, then the episode with its styled subtitles](docs/screenshots/clip-player.webp)

<p align="center">
  <img src="docs/screenshots/mobile-roll.webp" width="260" alt="Roll on a phone">
  &nbsp;&nbsp;
  <img src="docs/screenshots/mobile-home.webp" width="260" alt="Home on a phone">
</p>

Screenshots and clips show a made-up demo account; the shows are real, from AniList.

## How it is built

Each section below is a problem AniRoll has to solve, how it solves it, and where to read the code.

### A rate-limited API as the only backend

The browser talks straight to the [AniList GraphQL API](https://docs.anilist.co). AniList allows about
30 requests a minute when it is under load, and every open tab counts against that. So `js/api.js`
does not just send queries:

- **A budget shared by every tab**: at most 20 requests per rolling minute, counted in `localStorage`
  and claimed under `navigator.locks`, so two tabs can't both take the last slot.
- **Caching in two layers**: RAM (LRU, 50 MB) and IndexedDB (200 MB, oldest first), each kind of data
  with its own lifetime. If a refresh fails, the old answer is shown instead of an empty page.
- **One request for identical queries** that are in flight at the same time.
- **A pause on 429**: for five minutes nothing goes out, reads come from the cache, and changes wait in
  a queue that drains a few at a time once AniList answers again.

### One browser, more than one account

Everything an account caches or queues is marked with that account. Cache keys carry the account id
(never the token), so a different login on the same browser never sees someone else's list state. A
queued save only goes out for the account that made it. Logging out deletes that account's cache.

### Writing to someone's list only when it is safe

Jellyfin playback moves your AniList forward (`js/jellyfin.js`, and the same rules in `api/server.js`).
A wrong guess would change someone's list on the wrong show, so matching is strict: a year in either
title has to agree, the episode has to fit, shows that share a name are told apart first, and if in
doubt nothing is written. A correction by hand wins over a later playback.

### A player that leaves the files alone

`js/pages/play.js` and `js/player/` play episodes from the user's Jellyfin server. The browser says what
it can decode (`js/player/profile.js` asks it, codec by codec, instead of trusting a list), and Jellyfin
plays the file as it is, repackages it, or converts only what doesn't fit, usually just the audio.
Streams go through [hls.js](https://github.com/video-dev/hls.js) even where the browser plays HLS itself,
because only hls.js reports a failing conversion as what it is. Subtitles are drawn as the release made
them: ASS with the fonts embedded in the file through libass in WebAssembly
([JASSUB](https://github.com/ThaUnknown/jassub)), Blu-ray picture subtitles through
[libpgs](https://github.com/Arcus92/libpgs-js), timed to each video frame. Without a server, or with it
switched off, AniRoll shows no Play button rather than an error.

### A small server that holds secrets

`api/server.js` is plain Node without a framework. It serves the Jellyfin relay and webhook, background
sync, share pages and an error log. Jellyfin keys and AniList tokens are encrypted with AES-256-GCM,
and the key comes from outside the data volume (the server refuses to start without it). Data files
are written atomically. The relay forwards only the few Jellyfin endpoints AniRoll uses, and it refuses
private addresses at connect time, so DNS tricks can't point it at localhost.

### No bundler

Plain ES modules, loaded by the browser as they are. Every import carries `?v=N`, raised on each
release, so a browser never mixes old and new modules. With no bundler and no inline script, the
Content Security Policy can say `script-src 'self'`: only AniRoll's own files run, even if a bug ever
let markup through the escaping. The one addition is `'wasm-unsafe-eval'`, so the subtitle renderer's
WebAssembly may compile; it still has to come from AniRoll's own files.

### One design, generated from what you watch

AniRoll is built in Material 3 Expressive (`css/m3.css`, `js/m3.js`). Its whole light and dark scheme
comes from one seed colour, the cover colour of the show you watched last, through Google's Material
Color Utilities, in the colour style you pick. `index.html` starts in it, so no other look flashes first;
`js/design.js` keeps AniRoll's first design as a legacy option. Its wallpaper is that cover, blurred once on a tiny canvas
instead of with an expensive CSS blur. `js/m3.js` adds what CSS alone can't: the hero, the widgets
and a cursor that takes the shape of what it points at.

### Pages that don't trip over each other

`js/router.js` gives every navigation a number. A slow page that answers after you already moved on
cleans up after itself instead of drawing over the page you are on now. Dialogs (`js/a11y.js`) trap
focus, close on Escape, stack, and return focus to what opened them. *Reduce motion* turns off
GSAP and Lenis entirely.

## Finding your way around

**Start here:** `index.html` loads `js/app.js`, which sets up the shell (navigation, avatar menu,
settings, background jobs) and hands the URL to `js/router.js`. The router maps `#/list`, `#/roll`, …
to a module in `js/pages/`, and each page exports one `render({ content, params, query })`.

| Where | What it holds |
|---|---|
| `js/api.js` | Everything that talks to AniList: queries, the request budget, the cache, the queue for saves |
| `js/store.js` | Small shared state (user, settings), escaping, toasts, scores out of 100, events other modules listen to |
| `js/auth.js` | The AniList login token, kept in `localStorage` |
| `js/pages/*.js` | One module per page: `home`, `list`, `calendar`, `detail` (the slide-in panel), `social`, `search`, … |
| `js/upnext.js`, `js/home-cinema.js` | What Home says about your list (next episode, what's waiting, the week) and AniRoll's Home on top of it |
| `js/design.js`, `js/m3.js`, `css/m3.css` | Material 3's generated palette, its shapes and extra pieces; the legacy switch |
| `js/jellyfin.js`, `js/nowplaying.js` | Jellyfin: matching what you played to an AniList entry, the *Now watching* chip |
| `js/pages/play.js`, `js/player/` | The player: finding the episode, what the browser can play, the stream, its controls, subtitles |
| `js/vendor/` | Third-party libraries, unchanged and with their version in the name, each with its licence |
| `js/a11y.js`, `js/select.js` | Dialogs, keyboard activation, styled selects |
| `js/whatsnew.js` | The changelog and the pop-up for returning visitors |
| `api/server.js` | The Node backend |
| `css/style.css`, `css/m3.css` | The base styles (also the legacy design) and Material 3 on top of them |

### One action, followed through the code

Pressing **+1** on a Continue Watching card (`js/pages/home.js`):

1. The card updates at once: progress text, bar, and the button disappears on the last episode.
2. `api.progressVars()` works out what else changes with the episode (a planned show becomes
   *Watching*, the last episode completes it or counts a rewatch, start and end dates get filled in),
   then `api.saveMediaListEntry()` sends it.
3. Saves for the same entry are chained, so three quick clicks arrive at AniList in order, and only the
   newest target is sent.
4. `api.js` takes a slot from the request budget. If AniList is rate limiting, the save waits in the
   account's queue and goes out later; the card keeps the new number.
5. The card emits `aniroll:watched` (`js/store.js`): Material 3 listens and re-colours the app from
   the show you just watched. Home's hero presses this same card's button, so there is one code path for saving.

## The deliberate cut

| Piece | Files | What it builds on, all of it here |
|---|---|---|
| **Roll** | `js/pages/roll.js`, `js/reel.js` | `api.getMediaList()` and `api.getRecommendations()`, `api.saveMediaListEntry()`, the detail panel |
| **Watch Party** | `js/pages/watchparty.js`, `api/party.js` | `api.getUserMediaProgress()` and `api.saveMediaListEntry()`, background sync (`js/background.js`, `api/server.js`) |
| **Taste match** | `js/taste.js` | Your list with its scores, genres and tags; `api.getTasteProfile()`, the recommendations and the detail page call it |

The stubs keep every export, so the rest of the app loads and runs without them. The server runs
without `api/party.js`, too. This repository only ever held published snapshots, so older commits don't
contain these pieces either. To see them in action, [try AniRoll](https://aniroll.hxlx.de).

## How it is checked

- `tools/e2e/`: every page in Chromium (Playwright) against a mocked AniList: navigation, dialogs and
  keyboard, Material 3 and the legacy design, the changelog, and a check that two accounts in one browser never share
  cached answers or queued saves; the player against a mocked Jellyfin (direct play, a failing
  conversion, Quick Connect, styled and Blu-ray subtitles)
- `tools/api-test/`: the Jellyfin matcher in the server and the browser gives the same answer for the
  same cases, the relay refuses private addresses, posts are escaped, data files survive a crash mid-write

AniRoll is built with Vanilla JS, [GSAP](https://gsap.com), [Lenis](https://lenis.darkroom.engineering),
the self-hosted [Inter](https://rsms.me/inter/) font and Material Symbols. All anime data comes from AniList.

The player uses [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0),
[libpgs](https://github.com/Arcus92/libpgs-js) (MIT) and [JASSUB](https://github.com/ThaUnknown/jassub) (MIT).
JASSUB's WebAssembly contains libass, FreeType, HarfBuzz, FriBidi and other libraries under their own
licences, some of them LGPL-2.1-or-later; they ship as separate, replaceable files in
`js/vendor/jassub-2.5.16/`, rebuilt from the published package by `tools/vendor/jassub.sh`. Every
library's licence text lies next to it in `js/vendor/`.
