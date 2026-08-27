# Contributing

Contributions are welcome.

1. Fork the repository and create a focused branch.
2. Keep Host and Client lifecycle effects reversible.
3. Do not commit runtime `.progress-target` data, credentials, or private cluster evidence.
4. Run syntax checks before opening a pull request:

```powershell
node --check index.js
node --check client.js
```

5. Explain state-schema or migration changes in the pull request.
6. For resource discovery changes, cover missing servers, stale snapshots, phase transitions, and replans.

Please keep deployment-specific server names configurable when extending the project.
