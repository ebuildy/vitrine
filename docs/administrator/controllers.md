# Controllers

A Route in Settings joins a URL to a Controller, which is responsible for one kind of page. Startup stops, naming the Route, on a Controller that does not exist or a param it does not take.

```yaml
routes:
  - url: /images/tools
    controller: harbor-images
    params:
      source: tools-harbor
```

A Controller reads each param from one of two places:

- `params` in the Route, a fixed value, as `source: tools-harbor` above.
- A segment of the URL: `:source` or `:project` takes one segment, and `:group+` takes one segment or more, as Groups nest. A URL holds one `:name+` segment at most.

A Route may also carry a Template, which replaces what the Controller shows inside the page: see [Templates](templates.md).

Some Controllers link to the pages of others. Vitrine finds those pages among the Routes, so a list of Groups links each one only if a `gitlab-group` Route has `:group+` in its URL. A page that no Route shows has no link.

## `navigation`

The Navigation page: the latest Releases of every Main Group and the Harbor projects of every Harbor Source, then the Members of every Main Group, then the Main Groups of every GitLab Source, and links to every other Route whose URL has no `:` segment. Declare as many as you like, on any URL.

| Param | Required | What it does |
| --- | --- | --- |
| `arrangement` | no | `grid`, the default, sets Releases and Harbor projects side by side above the rest. `columns` gives the Overview, Members and Groups a column each. `list` runs everything down the page. |
| `maxItems` | no | How many items each list shows, a whole number above zero. Defaults to 5. |

## `harbor-images`

The Images of Harbor projects, with their tags and the scan results of each tag.

| Param | Required | What it does |
| --- | --- | --- |
| `source` | no | Limits the page to one Harbor Source. Left out, the page shows every Harbor Source. |
| `project` | no, needs `source` | Shows this Harbor project only. Left out, the page shows each Harbor project selected under `projects` of the Source. |

A Route with `:source` and `:project` in its URL, such as `/harbor/:source/:project`, shows any Harbor project the Source can read, whether `projects` selects it or not. The `harbor` Controller and the Harbor projects of the Navigation page link to it.

## `harbor`

Every Harbor project a Harbor Source reports, whatever its `projects` select, each linked to its Images. It needs a `harbor-images` Route with `:source` and `:project` in its URL.

| Param | Required | What it does |
| --- | --- | --- |
| `source` | yes | The Harbor Source, usually from the URL, as in `/harbor/:source`. |

## `nexus`

The Published Repositories of a Nexus Source, with their format and type, each linked to its page in Nexus. Search links a Repository to a Route with `:source` in its URL.

| Param | Required | What it does |
| --- | --- | --- |
| `source` | yes | The Nexus Source, usually from the URL, as in `/nexus/:source`. |

## `gitlab-group`

A Group: its summary, its subgroups, its Projects and its Members. A Group outside every Main Group is not found. It needs a `gitlab-project` Route with `:group+` and `:project` in its URL.

| Param | Required | What it does |
| --- | --- | --- |
| `group` | yes | The Group path, such as `platform/backend`, usually from the URL, as in `/gitlab/:group+`. |
| `source` | no | The GitLab Source. Left out, it is the first GitLab Source whose Main Groups hold the Group: when two Sources share a Group path, put `:source` in the URL. |

## `gitlab-project`

A Project: its summary, README, latest commits and open Issues, with its Releases and contributors beside them. A Project outside every Main Group, or archived, is not found.

| Param | Required | What it does |
| --- | --- | --- |
| `group` | yes | The path of the Group holding the Project. |
| `project` | yes | The last segment of the Project path. As in GitLab, a `-` ends the Group path in the URL: `/gitlab/:group+/-/:project` serves `/gitlab/platform/backend/-/api`. |
| `source` | no | As for `gitlab-group`. |

## `gitlab-issues`

The open, non-confidential Issues of a Group and of everything beneath it, with their assignees.

| Param | Required | What it does |
| --- | --- | --- |
| `group` | yes | The Group path, usually from the URL, as in `/issues/:group+`. |
| `source` | no | As for `gitlab-group`. |

## `gitlab-roadmap`

The open Epics of a Main Group and of everything beneath it, on a timeline and as a list. Any Group other than a Main Group is not found. Epics need GitLab 18.1 or later on a tier that includes them: otherwise the page shows an error.

| Param | Required | What it does |
| --- | --- | --- |
| `group` | yes | The Main Group path, usually from the URL, as in `/roadmap/:group+`. |
| `source` | no | As for `gitlab-group`. |

## `search`

One search box over every Group, Project, Issue, Member and Epic of every Main Group, every Image of every selected Harbor project and every Published Repository, by name, format or type, filtered by content type and by Source. It answers from the lists the other pages cache, so a search costs the Sources nothing while those lists are fresh, and a word may have one letter wrong.

Each result links to the Vitrine page that shows it: a Group or Member to its `gitlab-group` Route, a Project to its `gitlab-project` Route, an Issue to the `gitlab-issues` Route of its Group, an Epic to the `gitlab-roadmap` Route of its Main Group, an Image to its `harbor-images` Route and a Repository to its `nexus` Route. A result that no Route shows has no link, as search never leaves Vitrine.

The `search` Controller takes no params.
