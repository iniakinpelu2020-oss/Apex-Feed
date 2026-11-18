# Apex Feed

An RSS reader with no ranking algorithm. Newest first, and that is the whole idea.

**Status: not built.**

## What it should do

- Subscribe to feeds by URL.
- Show everything, newest first, with no "for you" and no engagement metric.
- Mark read, star, and search.

## The constraint that shapes it

Feeds have to be fetched somewhere, and a browser cannot do it for most sites. That means
a Worker fetches the feed and returns parsed items — well within the free 100,000 requests
a day if you poll a few dozen feeds an hour rather than every minute.

Two real limits: some sites block unknown fetchers, and fetching on a schedule needs the
cron that already exists in `Automation`.

## Why "no algorithm" is the easy part

There is nothing to build: sort by date. The work is in the fetching, the de-duplication of
items that reappear, and not downloading the same article twice.

## What you need to do

1. Nothing new.

## First three steps

1. A Worker route that takes a feed URL and returns JSON items.
2. A list view with read/unread state in Firestore.
3. A cron job in `Automation` that refreshes subscribed feeds every hour.
