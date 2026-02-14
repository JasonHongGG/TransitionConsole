# TransitionConsole

Frontend console for visualizing hierarchical transition diagrams from JSON and planned-runner coverage.

## Project structure

- `frontend/`: React + Vite client app
- `backend/`: Express planned-runner server

## Environment files

- `frontend/.env` and `frontend/.env.example`
- `backend/.env` and `backend/.env.example`

## Lint config

- `frontend/eslint.config.js`
- `backend/eslint.config.js`

## Data input

The app loads data from `frontend/public/data.json`. Replace that file with the latest export generated from your spec workflow.

## Scripts

- Frontend:
	- `cd frontend`
	- `npm install`
	- `npm run dev`
	- `npm run build`
	- `npm run preview`
- Backend:
	- `cd backend`
	- `npm install`
	- `npm run dev`

## Key features

- Diagram view for individual state machines
- System view that links all diagrams with connectors
- Planned runner execution via `/api/planned/*`
- Status panel with pass/fail validation results

## Mock planner replay (test-only)

To avoid Copilot cost during testing, backend supports replaying historical planner JSON logs by round.

- Put JSON files into `backend/mock-data/path-planner/`
- Enable in `backend/.env`:
	- `PATH_PLANNER_PROVIDER=mock-replay`
	- `PATH_PLANNER_MOCK_DIR=mock-data/path-planner`
	- `PATH_PLANNER_MOCK_LOOP=true`
	- `PATH_PLANNER_MOCK_RESET_ON_START=true`

Behavior:

- Files are consumed in chronological order (timestamp in filename first, then `createdAt` fallback)
- One file = one planning round
- If files run out and loop is enabled, replay restarts from the first file
