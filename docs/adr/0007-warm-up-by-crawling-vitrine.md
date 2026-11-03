# Warm the cache by crawling Vitrine, and keep visited pages in the cache store

A warm-up fills the cache by requesting Vitrine's own pages over HTTP and following their links, the same way from `npm run warm-up` as from the server itself. We chose this over a warm-up that calls each Source's loaders directly, because a page already knows which Source keys it reads, Templates included, and a crawl needs no list of them to keep in step.

`/sitemap.xml` lists every page that last answered with status 200, with the time of that visit, and not whether each Source key a page read is still in the cache. Pages are not cached, their content is, so tracking keys per page would cost a write per key read for little gain.

## Consequences

- A warm-up loads only what is missing or older than its allowed age, as any Visitor would, and has no way to reload fresh content.
- The visited pages live under one key, `visited-pages`, in the content cache store, so they last as long as its content and replicas sharing Redis share them. Source keys always hold a `/`, so they never meet it. Two replicas writing at once may lose a visit, which the next visit restores.
- A page visited again within a minute keeps its time, so a busy page does not write to the store on every request. A page that is not found any more is left out.
- The command cannot read Settings, which hold secrets it should not need, so it starts from `/` or the paths given, and from the sitemap, where the server's own warm-up starts from every fixed Route and Menu link.
- A page that shows an alert, such as a Source that is down or Epics a GitLab tier does not include, counts as failed, so a cron sees it.
