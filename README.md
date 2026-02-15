# TransitionConsole

Frontend console for visualizing hierarchical transition diagrams from JSON and planned-runner coverage.

## Project structure

- `frontend/`: React + Vite client app
- `backend/`: split backend services
	- `main-server/`: planned-runner orchestration API
	- `ai-server/`: AI runtime provider + agent factory + prompt modules
	- `operator-server/`: browser operator execution API

## Environment files

- `frontend/.env` and `frontend/.env.example`
- `backend/.env` and `backend/.env.example`

Backend split-service defaults:

- `PORT=7070` (main orchestrator)
- `AI_SERVER_PORT=7081`
- `OPERATOR_SERVER_PORT=7082`
- `AI_SERVER_BASE_URL=http://localhost:7081`
- `OPERATOR_SERVER_BASE_URL=http://localhost:7082`
- `AI_PROVIDER=copilot-sdk`
- `AI_RUNTIME_MODEL=gpt-5.2`
- `AI_RUNTIME_TIMEOUT_MS=180000`

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
	- `npm run dev:main`
	- `npm run dev:ai`
	- `npm run dev:operator`

Recommended during development: use VSCode task `dev: all` to start frontend + all backend services in parallel.

## Key features

- Diagram view for individual state machines
- System view that links all diagrams with connectors
- Planned runner execution via `/api/planned/*`
- Status panel with pass/fail validation results

## Mock planner replay (test-only)

To avoid Copilot cost during testing, backend supports replaying historical planner JSON logs by round.

- Put JSON files into `backend/ai-server/mock-data/path-planner/`
- Enable in `backend/.env`:
	- `PATH_PLANNER_PROVIDER=mock-replay`
	- `PATH_PLANNER_MOCK_DIR=ai-server/mock-data/path-planner`
	- `PATH_PLANNER_MOCK_LOOP=true`
	- `PATH_PLANNER_MOCK_RESET_ON_START=true`

Behavior:

- Files are consumed in chronological order (timestamp in filename first, then `createdAt` fallback)
- One file = one planning round
- If files run out and loop is enabled, replay restarts from the first file
