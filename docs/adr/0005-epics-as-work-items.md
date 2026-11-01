# Read Epics as work items through GitLab's GraphQL API

The Roadmap reads `Group.workItems(types: [EPIC])` from GitLab's GraphQL API, the one read in the GitLab client that is not REST. GitLab deprecated the Epics REST API in 17.0, for removal in v5 of the API, and the `Group.epics` GraphQL field in 17.5, and both point to work items, which GitLab's migration guide reads through GraphQL.

## Consequences

- Epics need GitLab 18.1 or later, when work item Epics became generally available. An older GitLab that refuses the query shows the Roadmap's general error.
- GitLab answers a tier without Epics with an empty list, where the REST API answered 403. The only signs are deprecated or experimental fields, and the absence of the Epic type from `Group.workItemTypes`, so an empty list with no such type counts as unavailable. Work item types became configurable in GitLab 19.0, so a Group with no Epics whose type was renamed shows that error wrongly. Listed Epics settle it either way.
- GitLab answers 200 for a query it could not run, so its `errors` count as a Source failure.
- A tier without Epics is an error, which is not cached, so each view of that Roadmap asks GitLab again.
