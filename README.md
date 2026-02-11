# TransitionConsole

Frontend console for visualizing hierarchical transition diagrams from JSON and streaming agent-driven coverage.

## Data input

The app loads data from `public/data.json`. Replace that file with the latest export generated from your spec workflow.

Copy `.env.example` to `.env` and fill in your GitHub token before running the Copilot agent server.
The Copilot SDK requires the Copilot CLI installed and available in PATH (or set `COPILOT_CLI_PATH`).

## Scripts

- `npm install`
- `npm run dev` (frontend)
- `npm run dev:server` (Copilot agent server)
- `npm run build`
- `npm run preview`

## Key features

- Diagram view for individual state machines
- System view that links all diagrams with connectors
- Copilot agent streaming via `/api/agent/stream`
- Mock runner fallback when `VITE_AGENT_MODE=mock`
- Status panel with pass/fail validation results
