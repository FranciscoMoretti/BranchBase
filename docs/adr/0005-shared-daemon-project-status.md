# One writer and a shared Project status

BranchBase supports both CLI-only and dashboard users through the same local daemon, application commands, and Project status contract. The CLI does not construct a separate controller or write operational state: this avoids competing lifecycle owners, divergent command approval rules, and different status meanings across interfaces. Starting the daemon does not open a browser; opening the dashboard is explicit.

Project status retains Git facts, configuration validity, observations, and cleanup-only runs independently. Reading the status module does not reconcile identities, allocate ports, or record activity; the application refresh operation explicitly reconciles identities and records observations around that read. Reconciliation never starts repository commands or allocates ports. An unavailable observer is not evidence that a service stopped.

We organize feature policy into Project, Configuration, App-group, Activity, and Codex modules, with application orchestration above them and Git, host, routing, persistence, HTTP, and CLI adapters at their boundaries. Small consumer-specific interfaces are preferred to a universal repository or service interface. Contracts imported by the browser remain free of host dependencies. This is a modular application, not a set of separately deployed services.

Lifecycle actions revalidate command trust and process ownership at the moment of use. Restart holds the same instance locks throughout stop and start; cached observations are never termination authority. The production composition root holds a process-lifetime writer lease per control directory, while the existing development session owns its isolated checkout state.
