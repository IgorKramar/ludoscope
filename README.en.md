<div align="center">

# Ludoscope

**English** · [Русский](README.md)

**Game-design analysis, reproducible simulations and project memory.**

TypeScript · CLI · MCP · Local-first

</div>

---

Ludoscope is a local toolkit for exploring game mechanics, resource economies and design decisions. A shared typed core is exposed through a CLI and MCP tools; agent skills help connect analysis to a human-led design workflow.

**Status: functional core, version 0.4.0.** This is not a declaration that every 1.0 acceptance criterion is complete. See [LIMITATIONS.md](LIMITATIONS.md).

## What is implemented

- Structured project profiles, design principles, graphs and immutable decision records.
- Analysis of mechanics, resource economies, dependencies and feedback structures.
- Seeded simulations, invariants, Monte Carlo runs and sensitivity analysis.
- Markdown/JSON reporting, project-context retrieval and design-document templates.
- CLI and MCP interfaces with explicit input/output schemas.
- Project scanning tied to Git revisions and file hashes rather than assumptions based on filenames.

A simulation checks the specified model. It does **not** prove that a game is fun, balanced for real players or educationally effective. Playtesting remains part of the process.

## Build and explore

Use Node.js 22+ and npm, as specified by the project documentation.

```sh
npm ci --ignore-scripts
npm run check
```

Try the included survival example from the repository root:

```sh
node dist/cli/index.js --project examples/survival init
node dist/cli/index.js --project examples/survival scan
node dist/cli/index.js --project examples/survival analyse mechanic mechanic.json
node dist/cli/index.js --project examples/survival simulate economy.json
node dist/cli/index.js --project examples/survival validate
```

`init` refuses to overwrite existing project files. The [Russian guide](README.md) contains the plugin/MCP setup, report commands and explicit decision-commit workflow. Build before installing the plugin: the installed copy is not a live link to your source tree.

## Where to start reading

| Document | Purpose |
| :--- | :--- |
| [Architecture](ARCHITECTURE.md) | System organisation and boundaries |
| [API](docs/API.md) / [MCP](MCP.md) | Programmatic integration |
| [Simulation](SIMULATION.md) | Models and reproducibility |
| [Testing](TESTING.md) | Validation approach |
| [Knowledge](KNOWLEDGE.md) | Provenance and limits of the knowledge base |
| [Limitations](LIMITATIONS.md) | Incomplete subsystems and constraints |
| [Changelog](CHANGELOG.md) | Changes between versions |

## Boundaries and provenance

The tools operate inside the configured project root. Saving a design decision requires explicit intent; analysis is not permission to change a project. The standard local workflow has no mandatory model-provider account or telemetry.

Knowledge entries are summaries, original methods and bibliographic references. Full commercial books are not redistributed. English output is available in several interfaces and templates, while some structural diagnostics still contain Russian text; see the localisation limitations.

## License

MIT for original code and independently written materials. Rights to third-party sources remain with their owners; see [KNOWLEDGE.md](KNOWLEDGE.md).

---

[Igor Kramar](https://github.com/IgorKramar) · Product engineering & developer tools
