# TransitionConsole

Frontend console for visualizing hierarchical transition diagrams from JSON and planned-runner coverage.

## Data input

The app loads data from `public/data.json`. Replace that file with the latest export generated from your spec workflow.

## Scripts

- `npm install`
- `npm run dev` (frontend)
- `npm run dev:server` (planned runner server)
- `npm run build`
- `npm run preview`

## Key features

- Diagram view for individual state machines
- System view that links all diagrams with connectors
- Planned runner execution via `/api/planned/*`
- Status panel with pass/fail validation results
