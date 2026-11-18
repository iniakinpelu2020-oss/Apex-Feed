# Apex Feed

A small RSS and Atom reader for ApexOS. Entries are cached on the device, so the last fetch stays
readable with no connection. Vanilla HTML/CSS/JS with relative `./` paths for `/apps/feed/`.

## Run

```sh
python3 -m http.server 8080
# then open http://127.0.0.1:8080/
```

Feeds must be served over http(s) and — for a browser-only app — must allow cross-origin reads. Many
publishers do not. If adding a feed fails with a network error, open **CORS relay** in the sidebar and
enter a relay prefix of your own, such as `https://your-relay.example/?url=`; the app appends the
encoded feed URL to it. Nothing is hard-coded: with the field empty every fetch is direct.

## What it does

- **Add feed** by URL, with `https://` assumed when no scheme is given; duplicates are detected.
- **Refresh all** fetches each feed in turn, keeps the read flags of entries already seen and counts
  what is new. A failure is stored per feed and shown under its name, without discarding what is
  already cached.
- **Sidebar** lists feeds with unread counts, plus an "All items" row. **Mark all read** and
  **Unsubscribe** act on the current selection; unsubscribing forgets that feed's cached entries.
- **Reader** shows the entry's title, feed, date and body text with a link to the original. Opening an
  entry marks it read.

## Parsing

`DOMParser` in XML mode handles RSS 2.0, RSS 1.0/RDF (items are siblings of `channel`) and Atom.
Links follow the shape of each format: Atom's `<link href>` with `rel="alternate"` is preferred, RSS's
`<link>` text is the fallback. Body text prefers `content:encoded`, then `content`, `description`,
`summary`, and is stripped to plain text — HTML is never injected into the page.

## Storage

One `localStorage` key, `apex.feed.v1`, capped at the **400 newest entries** so a long-lived reader
cannot quietly fill the origin's quota:

```json
{
  "proxy": "",
  "feeds": [{ "id": "…", "url": "https://example.com/feed.xml", "title": "Example",
              "added": 1763472000000, "error": "" }],
  "items": [{ "key": "feedid|guid", "feedId": "…", "title": "…", "link": "https://…",
              "date": 1763472000000, "text": "Plain text body", "read": false }]
}
```

Item keys are `feedId|guid`, so a feed that changes its guids will re-add entries; one that keeps them
stable accumulates history instead of duplicating.

## Bundling into ApexOS

Roster entry `Apex-Feed feed`. Keep paths relative and bump `CACHE` in `sw.js` (`apex-feed-v1`) when
shell files change.
