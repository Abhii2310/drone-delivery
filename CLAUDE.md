# SKYGUARD — working agreement

Read this before every task. It overrides your instincts about code quality.

This is a 12-hour hackathon prototype demoed at 08:30. A working end-to-end demo beats architecture quality every single time. There is no phase 2.

## Reference docs

* `docs/BUILD-PLAN.md` — architecture, algorithms, data model
* `docs/3D-ADDENDUM.md` — MapLibre + deck.gl layer stack, camera system
* `docs/UI-SPEC.md` — design tokens, component anatomy, motion choreography
* `IMPLEMENTATION.md` — the step sequence and gates

Consult them for detail. Never contradict them. If you think one is wrong, say so and wait.

## Architecture — non-negotiable

* One FastAPI process, one asyncio loop, no threads. Module-level `AppState` singleton.
* WebSocket is server → client only. Every mutation is a REST call.
* The tick loop never awaits the LLM. AI runs in `asyncio.create_task`.
* `actions.apply_action()` is the only function permitted to change `drone.route_id`, `drone.status`, `drone.target_alt`, or `mission.state`. Scenario buttons, AI approvals, emergency mode and policy compilation all go through it.
* The frontend never moves a drone. Positions come only from server telemetry. No client-side `setInterval` that changes position. This is a demo-integrity requirement.
* All geometry is in local ENU metres. lat/lng only at serialization.
* Seeded RNG (1337) and a `sim_clock` advanced by `dt`. Never `time.time()` in sim logic.
* Telemetry never enters React state. Module-scope buffer read by a rAF loop.

## Forbidden

PostgreSQL, PostGIS, SQLite, SQLAlchemy, Alembic, Redis, Docker, Celery, microservices, Next.js, SSR, GraphQL, auth systems, JWT, Cesium, Leaflet, Three.js, computer vision, real hardware, repository/service/DI layers, abstract base classes "for extensibility", `useEffect` polling loops, state machines libraries, i18n.

## Workflow — follow exactly

1. Do only what the current step asks. Never build ahead.
2. After writing code: run it, test the acceptance criteria, report the result.
3. If something in a previous step is broken, fix it before continuing.
4. Never refactor working code into abstractions.
5. Never rename working modules or swap a working library for a "better" one.
6. If a step exceeds its time budget, stop and report rather than continuing.
7. End every step by saying what you built, what you verified, and what you did not do.
8. Keep files under the line budgets in `docs/BUILD-PLAN.md` §4.

## Code style

* Python: type hints on public functions, Pydantic models, no docstring essays.
* TypeScript: strict mode on, no `any` except at WS boundaries.
* Comments only where the why is non-obvious. No comment banners, no section headers.
* No `try/except` that swallows errors silently. Log and re-raise, or handle explicitly.

## When in doubt

Ask a single specific question and stop. Do not guess and build.
