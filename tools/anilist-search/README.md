# AniList search

The search from [AniRoll](https://aniroll.app), extracted so it can be dropped into any anime
tracker. Plain ES modules, no framework, no dependencies, no build step.

| File | What it is |
|------|------------|
| `anilist-search.js` | Core without UI: request, cache, debounce, rate-limit handling. Browser and Node 18+ |
| `search-overlay.js` | Ready-made search dialog (Ctrl/Cmd+K) on top of the core |
| `search-overlay.css` | Styles for the dialog, all classes prefixed `als-`, light and dark |
| `demo.html` | Working example — serve the folder and open it |

Try it:

```bash
npx serve tools/anilist-search
```

ES modules don't load from `file://`, so any static server works (`python -m http.server` too).

## Option 1: the ready-made overlay

```html
<link rel="stylesheet" href="search-overlay.css">
<script type="module">
    import { mountSearchOverlay } from './search-overlay.js';

    const search = mountSearchOverlay({
        onSelect: (media) => location.href = `/anime/${media.id}`,
    });
    document.querySelector('#search-button').addEventListener('click', search.open);
</script>
```

Options for `mountSearchOverlay`:

| Option | Default | |
|--------|---------|---|
| `onSelect(media)` | — required | Called with the chosen AniList media object |
| `type` | `null` | `'ANIME'`, `'MANGA'` or `null` for both |
| `minLength` | `3` | Characters before the first request |
| `debounceMs` | `300` | Pause after typing before searching |
| `limit` | `8` | Results shown (max 50) |
| `shortcut` | `true` | Ctrl/Cmd+K opens and closes, Escape closes |
| `titleLanguage` | `'userPreferred'` | `'english'`, `'romaji'`, `'native'` |
| `placeholder` | depends on `type` | |
| `container` | `document.body` | Where the dialog is mounted |
| `token` | `null` | AniList OAuth token, optional |

It returns `{ open, close, destroy, element }`. Keyboard: arrow keys move, Enter selects.

Theming: override the variables on `.als-overlay`, e.g.
`.als-overlay { --als-accent: #3db4f2; --als-radius: 12px; --als-font: 'Inter', sans-serif; }`.
Dark mode follows the system; `data-theme="dark"` / `"light"` on a parent overrides it.

## Option 2: only the core, with your own UI

```js
import { createSearchController, displayTitle, describeMedia } from './anilist-search.js';

const controller = createSearchController({
    type: 'ANIME',
    onState: ({ status, media, error }) => {
        // status: 'idle' | 'short' | 'loading' | 'done' | 'error'
        if (status === 'done') renderList(media.map(m => `${displayTitle(m)} — ${describeMedia(m)}`));
        if (status === 'error') showError(error.message);
    },
});
input.addEventListener('input', () => controller.update(input.value));
```

Or a single request without debouncing:

```js
import { searchAniList } from './anilist-search.js';

const { media, pageInfo } = await searchAniList('jujutsu kaisen', { type: 'ANIME', perPage: 10 });
```

Each result has `id`, `idMal`, `type`, `format`, `status`, `episodes`, `chapters`, `season`,
`seasonYear`, `meanScore`, `isAdult`, `siteUrl`, `title { userPreferred romaji english native }` and
`coverImage { medium large color }`. Add fields in `SEARCH_QUERY` if the tracker needs more.

## Things we learned the hard way

- **Never send `type: null`.** AniList treats an explicit `null` as a filter and returns zero results,
  even for an exact title. The module leaves unset variables out — keep it that way when extending.
- **Rate limits.** AniList allows about 90 requests a minute, and only 30 while it is degraded. On a
  429 the module pauses every search for the `Retry-After` time (at least a minute) and throws
  `AniListRateLimitError` instead of retrying, which would only extend the block.
- **Search-as-you-type** fires a request per keystroke unless debounced. The controller also aborts
  the request for an older term and drops answers that arrive out of order.
- Results are cached for 5 minutes (`cacheTtlMs`), so going back to a term costs nothing.
- Adult titles are filtered out unless `includeAdult: true` is passed to `searchAniList`.
