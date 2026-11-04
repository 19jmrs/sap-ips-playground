# Implementation brief
Run: 20261102-implementation. Mode: same-turn-parallel.
Objective: working local public-facing English IPS transformation and expression playground, actual execution, batch partial failure, trace, editor assistance, tests and documented compatibility.
Authorization: development handoff supersedes old confirmation gate. No deployment, purchases, login, remote provisioning, branch/worktree.
Privacy: browser memory only; no persistence or payload logs. Reload clears app memory. Browsers may retain pages in memory or restore state; no absolute closure guarantee is possible on arbitrary clients.
Capabilities: spawn, message, wait, interrupt, filesystem and user input available. Agent closure unsupported. No detached execution evidence. No enforced spending budget.
Concurrency: three specialists plus coordinator, no nested delegation.
Implementation: React/Vite with client execution avoids transmitting payloads. Engine compatibility remains evidence-based; unknown syntax must fail explicitly.
Acceptance: source/target/chain; JSONPath/condition manual Run; batch detection/override and per-entity outcomes; stage results/changes/trace; examples; official inventory; meaningful engine tests and end-to-end browser QA; reproducible startup.
