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
