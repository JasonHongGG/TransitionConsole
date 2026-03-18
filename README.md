# TransitionConsole

TransitionConsole is a local development workspace for:
- visualizing transition diagrams,
- planning execution paths with AI,
- running step-by-step browser/operator execution.

## Architecture

- `frontend/`: React + Vite UI
- `backend/main-server/`: planned-runner orchestration (`/api/planned/*`)
- `backend/ai-server/`: path-planner / step-narrator / operator-loop agents
- `backend/operator-server/`: Playwright-based browser operator

## Quick start

1. Install dependencies

```bash
cd frontend && npm install
cd ../backend && npm install
```

2. Prepare env files

- Create `frontend/.env` from `frontend/.env.example`
- Create `backend/.env` from `backend/.env.example`
- Set `GITHUB_TOKEN` in `backend/.env`

3. Install Playwright browser runtime (required)

```bash
cd backend
npx playwright install chromium
```

4. Start services

- VS Code Task (recommended): `workspace:dev:all`
- Or run manually:

```bash
cd backend
npm run dev:main
npm run dev:ai
npm run dev:operator

cd ../frontend
npm run dev
```

## Health checks

- Main server: `http://localhost:7070/health`
- AI server: `http://localhost:7081/health`
- Operator server: `http://localhost:7082/health`
- Frontend (default): `http://localhost:5173`

## Required env highlights

### frontend/.env

- `VITE_PORT` (default `5173`)
- `PORT_OFFSET` (default `0`, 整組服務 port 平移量)
- `VITE_MAIN_SERVER_PORT` (default `7070`)

### backend/.env

- `PORT_OFFSET` (default `0`, 整組服務 port 平移量)
- Service ports:
	- `MAIN_SERVER_PORT`
	- `AI_SERVER_PORT`
	- `OPERATOR_SERVER_PORT`
- AI runtime:
	- `AI_PROVIDER`
	- `GITHUB_TOKEN`
	- `AI_RUNTIME_MODEL`
	- `AI_RUNTIME_TIMEOUT_MS`
- Agent-specific timeouts (fallback to `AI_RUNTIME_TIMEOUT_MS`):
	- `PATH_PLANNER_TIMEOUT_MS`
	- `PLANNED_RUNNER_NARRATIVE_TIMEOUT_MS`
	- `PLANNED_RUNNER_OPERATOR_TIMEOUT_MS`
- Path planner prompt strategy:
	- `PATH_PLANNER_PROMPT_VARIANT` (`implementation`, `exp1_meaningful`, `exp2_unwalked_required`, `exp3_unwalked_branch_first`, `exp4_unwalked_long_paths`, `exp5_journey_deepening`, `exp6_comprehensive`, `exp7_risk_first`, `exp8_portfolio_balanced`)

## Run Multiple Instances

If you want to run multiple copies of this workspace in parallel, set a different `PORT_OFFSET` for each copy.

Recommended offsets:

- instance A: `PORT_OFFSET=0`
- instance B: `PORT_OFFSET=100`
- instance C: `PORT_OFFSET=200`

With the current defaults, each instance resolves ports like this:

- frontend: `VITE_PORT + PORT_OFFSET`
- frontend -> main-server target: `VITE_MAIN_SERVER_PORT + PORT_OFFSET`
- main-server: `MAIN_SERVER_PORT + PORT_OFFSET`
- ai-server: `AI_SERVER_PORT + PORT_OFFSET`
- operator-server: `OPERATOR_SERVER_PORT + PORT_OFFSET`

Example with `PORT_OFFSET=100`:

- frontend: `5273` or `5100` if your `frontend/.env` uses `5000`
- frontend -> main-server target: `7170`
- main-server: `7170`
- ai-server: `7181`
- operator-server: `7182`

This means each project copy only needs one change: set a different `PORT_OFFSET` in both `backend/.env` and `frontend/.env`.

All service-to-service URLs are derived locally from ports, so you no longer need to maintain separate localhost base URL env vars.

## Input data

The frontend reads transition data from:

- `frontend/public/data.json`

Replace this file with your latest exported diagram data before running plans.

## Mock planner replay (optional)

Use historical planner logs instead of live LLM planning:

- Put planner JSON files in `backend/ai-server/mock-data/path-planner/`
- Set in `backend/.env`:
	- `PATH_PLANNER_PROVIDER=mock-replay`
	- `PATH_PLANNER_MOCK_DIR=ai-server/mock-data/path-planner`
	- `PATH_PLANNER_MOCK_LOOP=true`
	- `PATH_PLANNER_MOCK_RESET_ON_START=true`

## Troubleshooting

- Error: `browserType.launch: Executable doesn't exist ... ms-playwright ...`
	- Run: `cd backend && npx playwright install chromium`
- Start/step returns 500
	- Check `/health` endpoints above
	- Verify `GITHUB_TOKEN` and timeout values in `backend/.env`
