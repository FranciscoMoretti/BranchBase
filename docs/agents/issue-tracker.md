# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- Create, read, comment on, label, assign, and close issues using `gh issue`.
- Infer `FranciscoMoretti/brum` from the repository remote.
- PRs are not treated as a triage request surface.
- When a skill says “publish to the issue tracker,” create a GitHub issue.

## Wayfinding operations

- A map is one issue labelled `wayfinder:map`.
- Investigation tickets are GitHub sub-issues labelled `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Claim a ticket by assigning it to the developer driving the map.
- Use GitHub’s native issue dependencies for blocking relationships.
- The frontier consists of open, unblocked, unassigned child tickets.
- Resolve a ticket by posting its answer, closing it, and adding a brief linked pointer under the map’s “Decisions so far.”
- If sub-issues or dependencies are unavailable, use task-list children and explicit `Blocked by:` lines.
