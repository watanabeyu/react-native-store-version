# Store fixtures

Responses taken from the real stores on 2026-11-08 and 2026-11-12 (see each file's header comment) and trimmed by
hand-checked scripts (`rnsv-store-fixtures`).
They keep the real structure around the values the library reads. Long free text, URLs inside the Play data,
contact details, developer IDs and region-specific prices (the currency of the requesting IP) were replaced with `…`,
and `nonce` values were emptied.
Every `AF_initDataCallback` `data` in the HTML fixtures is still valid JSON.

The hand-written fixtures one level up (`../itunes-lookup.json`, `../itunes-lookup-empty.json`, `../playstore.html`)
are used only by the v1 regression tests and are kept unchanged.

All requests: no cookies, User-Agent `okhttp/4.12.0` (what React Native's `fetch` sends on Android up to 0.87).
From React Native 0.88, the default User-Agent on Android is `<app name>/<versionName>`; on 2026-11-12,
`GitHub/1.283.0` returned a page with the same structure (version, release notes and release date in the same places).

## Release notes and release date in the Play pages

Right after the version slot, every page has the release notes and the release date:
`<version slot>,null,null,null,<release notes>,[["<display date>",[<seconds>,<nanoseconds>]]]`.
`<release notes>` is `[null,[null,"<text>"]]` (line breaks are `<br>`) or `null` when the app has no
"What's new". The display date depends on the language and the time zone of the request; the seconds are a Unix time.
In the fixtures, the release notes keep their first lines (up to 4), with URLs replaced by `…`, and the release date is real.

| File | Source | Fetched | Original size | Kept | Expected result |
|---|---|---|---|---|---|
| `itunes-lookup.json` | `https://itunes.apple.com/lookup?bundleId=com.github.stormbreaker.prod&country=jp` | 2026-11-08 | 9,797 B | Real wire format (3 leading / trailing newlines, `results[0]` on one line). Real values kept for `version`, `trackViewUrl` (with `?uo=4`, as the API returns it), `trackId`, `bundleId`, `artworkUrl512`, `currentVersionReleaseDate`, `minimumOsVersion`. `releaseNotes` keeps only its first line, `description` is `…`, arrays keep 1–2 items, rating / size keys are dropped | version `1.283.0`, `currentVersionReleaseDate` `2026-11-05T14:25:25Z` |
| `itunes-lookup-empty.json` | `https://itunes.apple.com/lookup?bundleId=com.example.rnsv.nonexistent&country=jp` | 2026-11-08 | 42 B | Unchanged | `resultCount: 0`, `results: []` |
| `playstore.html` | `https://play.google.com/store/apps/details?id=com.github.android` | 2026-11-08 (release notes: 2026-11-12, same release) | 1,259,356 B | (1) The JSON-LD script (`@type` kept; its `ratingValue` is a decoy number), (2) a decoy: two entries of the reviews block, placed before the version block, that hold older versions in `]]],"1.274.0",null,…` (every other string in them is `…` and every number is `0`, so the entries cannot be traced back to a review), (3) the `AF_initDataCallback` script that holds the version slot. The release notes were taken from the 2026-11-12 page, which had the same release date | version `1.283.0` in `[[["1.283.0"]],[[[37]],[[[26,"8.0"]]]]]`; release notes with line breaks; release date `[1793918943,…]` (`2026-11-05T22:49:03Z`) |
| `playstore-changed.html` | Same page as `playstore.html` | 2026-11-08 | 1,259,356 B | Same as `playstore.html`, but the array that wraps the version is rewritten into a different, still well-formed shape (`{"v":["1.283.0"],"t":[[[37]],[[[26,"8.0"]]]]}`). The version string, the release notes and the release date are still there | No pattern matches (structure change) |
| `playstore-varies.html` | `https://play.google.com/store/apps/details?id=com.google.android.apps.maps` | 2026-11-12 | 1,342,350 B | Same blocks as `playstore.html` | Version slot is empty: `[[null,[]],[[[28,"9"]],[null,[]]]]`. The page has no "Varies with device" text. Release notes and release date `[1794411350,…]` are there |
| `playstore-varies-nosdk.html` | `https://play.google.com/store/apps/details?id=com.google.android.calculator` | 2026-11-12 | 1,306,093 B | JSON-LD and the version block (the page had no reviews block with versions, so there is no decoy) | Version slot is empty and has no minimum OS label: `[[null,[]],[[[36]],[null,[]]]]`. Release notes and release date `[1789543527,…]` are there |
| `playstore-no-notes.html` | `https://play.google.com/store/apps/details?id=com.google.android.gms` | 2026-11-12 | 1,329,748 B | JSON-LD and the version block (no decoy, as above) | Version slot is empty: `[[null,[]],[[[18,"4.3"]],[null,[]]]]`. No "What's new": the release notes are `null`. Release date `[1794448416,…]` is there |
| `playstore-nonnumeric.html` | `https://play.google.com/store/apps/details?id=org.wikipedia` | 2026-11-08 (release notes: 2026-11-12, same release) | 1,294,016 B | Same blocks as `playstore.html`. The release notes were taken from the 2026-11-12 page, which had the same release date | Version slot holds a non-numeric versionName: `50616-r-2026-11-03`. Release notes and release date `[1793903519,…]` are there |

The Play block order (`ds:N`) and `hash` values change between requests, so nothing should depend on them.
On the real pages the reviews block comes before the version block in about half of the requests, which is why
the decoy is placed first: a pattern that only looks for a version-like number returns an older version.
