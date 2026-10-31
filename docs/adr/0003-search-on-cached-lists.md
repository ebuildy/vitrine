# Search within cached lists

Vitrine caches whole lists per Main Group and Harbor project and answers searches from those lists, because it is faster and safer: search traffic never spams the GitLab or Harbor APIs.

## Considered Options

- **Search on the cache (chosen)**: cache complete lists and filter them inside Vitrine. Results are consistent across Sources and most searches are fast, but they are only as fresh as the cache and the first search after expiry is slow.
- **Forward each search to the Sources**: send every query to the GitLab and Harbor search APIs. Results are always current, but each search adds load on the Sources, and their differing search features give inconsistent results.
