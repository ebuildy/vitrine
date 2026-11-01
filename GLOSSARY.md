# Vitrine

A forkable portal that DevOps teams put in front of their GitLab and Harbor, so people can browse content, find it and go to where it can be downloaded.

## Language

### Portal

**Vitrine**:
The portal as a whole. It aggregates and points to content, and access to that content stays with each Source.
_Avoid_: Catalog site, the site, showcase

**Source**:
One GitLab, Harbor or Nexus instance whose content Vitrine aggregates.
_Avoid_: Backend, upstream, integration

**Visitor**:
A person browsing Vitrine. A Visitor may have access to some Sources and not others.
_Avoid_: User, customer, client

**Administrator**:
The DevOps person who runs a Vitrine installation, configures it through its Settings and may fork it to change what Settings cannot.
_Avoid_: Admin, operator, maintainer

**Settings**:
The file an Administrator edits to configure an installation, including its Sources, Main Groups and cache store.
_Avoid_: Config, configuration, options

**Published**:
The state of content that belongs to a Main Group or a selected Harbor project and is not confidential.
_Avoid_: Public, visible, exposed, approved

**Stale**:
The state of cached Source content older than its allowed age. Stale content is shown only when the Source is down, with a warning.
_Avoid_: Expired, outdated

**Route**:
An association in Settings between a URL and a Controller, with an optional Template.
_Avoid_: Path, page, mapping

**Controller**:
The named unit responsible for one kind of page, chosen by a Route.
_Avoid_: Handler, view, page type

**Template**:
Astro markup written in Settings that replaces how a Route's Controller arranges the content of its page, usually by placing Components.
_Avoid_: Layout, theme, page

**Component**:
A self-contained UI building block that can be placed on any page and presents its own content, warnings and errors.
_Avoid_: Widget, block, partial

### GitLab content

**Main Group**:
A GitLab group named as the starting point for what Vitrine aggregates from that Source. Everything beneath it is included.
_Avoid_: Root group, top-level group

**Group**:
A GitLab group at or beneath a Main Group.
_Avoid_: Namespace, team, subgroup when the Main Group itself is meant

**Project**:
A GitLab project beneath a Main Group and not archived.
_Avoid_: Repository, repo, Harbor project

**Member**:
A person belonging to a Main Group or anything beneath it.
_Avoid_: User, staff, employee

**Epic**:
A GitLab epic of a Main Group or anything beneath it. GitLab's API calls it a work item of type Epic.
_Avoid_: Work item, initiative

**Roadmap**:
The Epics of a Main Group laid out on a timeline.
_Avoid_: Planning, schedule

### Harbor content

**Image**:
An OCI image held in a Harbor repository, together with its tags and their scan results.
_Avoid_: Container, artifact, Exhibit
