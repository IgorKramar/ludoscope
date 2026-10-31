![LUDOSCOPE](docs/assets/ludoscope.svg)

[Русский](README.md) · [API](docs/API.md) · [Architecture](ARCHITECTURE.md) · [Limitations](LIMITATIONS.md)

# LUDOSCOPE

**Game Design Intelligence Engine** — a local game-design toolkit for Codex and other agents. Explore mechanics, inspect dependencies, run seeded models and retain the evidence behind a design decision.

**Version 0.6.0:** 17 Skills, 41 MCP tools and a shared TypeScript core. This is a functional release; the full 1.0 specification remains a roadmap.

## Try the complete demonstration

Node.js 22+ and npm are required. CI runs on Node.js 22 and 24 on Linux.

```sh
git clone https://github.com/IgorKramar/ludoscope.git
cd ludoscope
npm ci --ignore-scripts
npm run check
npm run demo
```

The demo creates an isolated game project and a separate output directory. It produces `report.md`, `analysis.md`, `data.json` and `manifest.json` with checksums. It uses actual simulator output, preserves project/task identity through analysis and revision, and never changes the bundled fixtures.

```sh
npm run demo -- --output /tmp/ludoscope-demo
```

The chosen output directory must be new. Omit `--output` for a fresh temporary directory on every run. The demo report is Russian; structured API identifiers remain English.

## Install in Codex

Build first, then register the absolute repository path:

```sh
codex plugin marketplace add /absolute/path/to/ludoscope
codex plugin add ludoscope@ludoscope-local
codex plugin list --json
```

Local plugin installation was verified with Codex CLI 0.159.2 in the [0.4.0 verification record](docs/verification-0.4.0.md). Current CI separately verifies the npm-installed package and real MCP calls. It does not test every Codex client version or desktop UI.

Codex installs a copy containing `dist/` and dependencies. Rebuild and reinstall after updating. Start Codex in your game repository, or explicitly set the MCP project root:

```sh
codex mcp add ludoscope --env LUDOSCOPE_PROJECT_ROOT=/absolute/path/to/game -- node /absolute/path/to/ludoscope/dist/mcp/index.js
```

Standalone MCP supplies tools; the full plugin also supplies Skills. Initialize a new game's memory:

```sh
node /absolute/path/to/ludoscope/dist/cli/index.js --project /absolute/path/to/game init --language en
```

Use `context` to reopen an initialized project. `init` refuses to overwrite existing files. Decisions use preview followed by explicit `--commit`.

## Use the agent API

```js
import { LudoscopeAgentApi } from "ludoscope/api";

const api = await LudoscopeAgentApi.create();
const analysis = await api.call("analyze_concept", {
  request: {
    api_version: "1.0",
    request_id: "request.route",
    project_id: "project.puzzle",
    task_id: "task.route",
    timestamp: new Date().toISOString(),
    status: "submitted",
    context: {
      subject: "Route selection",
      author_goals: ["Discover a spatial rule"],
      creative_principles: ["Only three rules"],
      constraints: ["No character progression"]
    }
  },
  concept: "Choose a route using visible spatial clues."
});
console.log(analysis.markdown);
```

Run package imports from a consumer project with LUDOSCOPE installed, or use the built local module in repository scripts. [API reference](docs/API.md) · [Executable MCP client](examples/world-forge/mcp-client.mjs).

An unconfigured Chronicler yields explicit incomplete history and a `partial` analysis. The local analysis still runs. FIP is a provisional profile; remote publication needs both explicit intent and host authorization.

## What you can inspect

The [Hydrocraft pilot](examples/hydrocraft-pilot/README.md) links pinned recipe and callback files to an original stock-flow model. `npm run pilot:hydrocraft` runs offline; add `-- --source /path/to/pinned-checkout` to verify source fingerprints. The mod remains unchanged. [Traceability](docs/TRACEABILITY.md) reports stale bindings and incomplete declared evidence chains; it does not run game tests or authenticate playtests.

| Area | Implementation |
| :--- | :--- |
| Knowledge | 208 entries, 19 sources, contextual lenses and provenance |
| Systems | Dependency graphs, resource models, invariants and sensitivity |
| Research | Experiment plans, imported observations, linked measurement criteria |
| Memory | Profiles, versioned artifacts and immutable decision records |
| Integration | CLI, typed API, strict MCP input/output schemas |
| Quality | Node 22/24 CI, regression tests, stdio MCP and installed-package checks |

## Evidence and boundaries

Hypotheses, source summaries, model results, engineering tests and player observations remain distinct. Multiple criteria for one hypothesis are evaluated conjunctively; repeated rows do not count as additional participants. Reference validation rejects conflicting evidence IDs and preserves artifact links across revisions.

A simulation checks specified rules. Real players are needed to evaluate experience. Knowledge coverage is selective; full commercial books and OCR are not distributed. Some diagnostics and the demo narrative remain Russian. See [knowledge provenance](KNOWLEDGE.md) and [known limitations](LIMITATIONS.md).

[Testing](TESTING.md) · [Contributing](CONTRIBUTING.md) · [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md).

MIT for original code and independently written material. Third-party rights remain with their owners.
