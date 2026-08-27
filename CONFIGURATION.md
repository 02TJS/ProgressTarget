# Configuration audit and deployment checklist

BigPlan intentionally does not assume that another deployment has the author's servers, paths, deadlines, metrics, or execution tools. Configure and review the following before use.

## Plugin configuration

Edit `cordis.patch.yml` before adding the bundle:

```yaml
- insert:
    - id: progress-target
      name: dsh-bigplan
      config:
        requiredServers:
          - gpu-a
          - gpu-b
          - inference-pool
        resourceDiscoveryMaxAgeMinutes: 10
        dataDir: .progress-target
```

| Setting | Default | Meaning |
|---|---:|---|
| `requiredServers` | `[]` | Complete fixed server inventory that each resource snapshot must cover. Empty means no fixed inventory is enforced. |
| `resourceDiscoveryMaxAgeMinutes` | `10` | Maximum snapshot age at phase start or replan. |
| `dataDir` | `.progress-target` | Storage directory relative to `DSH_CWD` or the Host working directory. |

Server names are arbitrary strings. The sample names in the guide are examples only.

## Items every user must customize

1. **Resource inventory** — server, queue, workstation, cloud node, or scheduler pool names.
2. **Discovery commands** — SSH, Slurm, Kubernetes, cloud APIs, or local commands available in that environment.
3. **Evidence policy** — what command output or scheduler record is sufficient without leaking secrets.
4. **Freshness window** — choose a value appropriate to cluster contention and task startup latency.
5. **Storage location** — ensure the Host can write it and that backups/retention meet local policy.
6. **Quality metrics** — names, comparison operators, thresholds, units, datasets, and statistical confidence.
7. **Deliverables** — artifact names, acceptance rules, checksums, validation logs, and downstream consumers.
8. **Deadlines and timezone** — all API timestamps must be valid ISO 8601 values.
9. **Parallelism policy** — GPU/CPU limits, queue quotas, cost budgets, and whether all available nodes may be used.
10. **Sharding contract** — partition key, overlap rules, deterministic merge, retry behavior, and output manifest.
11. **Monitoring cadence** — BigPlan supplies initial 5/50/75/100 semantics, but operational alerts remain deployment-owned.
12. **Authorization policy** — who may rewrite/delete history and what audit trail is required.
13. **Security** — credentials must remain in the deployment's secret system, never in plan evidence.
14. **Profile name and restart procedure** — `web` is an example; use the actual DSH Profile and its normal Host lifecycle.
15. **Agent capabilities** — BigPlan validates supplied state; it does not create SSH, scheduler, GPU, timer, or background-job capabilities.

## Resource discovery behavior

- If `requiredServers` is non-empty, every snapshot must contain each configured name exactly once.
- Additional dynamically discovered servers are allowed.
- Duplicate server entries are rejected.
- With `requiredServers: []`, any discovered inventory is accepted, including an empty list for CPU-only or resource-neutral phases.
- A new snapshot is required at phase start and whenever a running phase submits a new execution plan.
- The snapshot must be newer than the previous phase completion and the same phase's previous snapshot.
- For shardable work, all servers reported as `available` with `availableGpus > 0` must be represented by resource branches.

## Preflight checklist

- [ ] Replace example server names in prompts and examples.
- [ ] Confirm the Agent can actually query every configured server.
- [ ] Confirm evidence contains no tokens, usernames, private paths, host keys, or proprietary dataset names.
- [ ] Run one CPU-only phase and one multi-server phase.
- [ ] Verify stale and incomplete snapshots are rejected.
- [ ] Verify the DSH Web page reads the intended session storage.
- [ ] Confirm restart/update behavior in the actual Profile.
- [ ] Define retention, backup, and authorized mutation policy for plan JSON.
