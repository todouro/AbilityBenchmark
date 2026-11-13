# AbilityBenchmark

A multiplayer cognitive and reflex benchmark where friends can compare results in private rooms. The project is being built in phases; this repository currently contains **Phase 1: the shared protocol and authoritative multiplayer server**.

## Phase 1 project structure

    .
    ├── client/
    │   └── README.md            # React app scaffolded in Phase 2
    ├── server/
    │   └── src/
    │       ├── app.ts           # Express, HTTP and Socket.IO bootstrap
    │       ├── config.ts        # Environment configuration
    │       ├── index.ts         # Server entry point and shutdown
    │       ├── rooms/
    │       │   ├── room-store.ts
    │       │   ├── score-validation.ts
    │       │   ├── room-store.test.ts
    │       │   ├── score-validation.test.ts
    │       │   └── seeded-random.test.ts
    │       └── socket/
    │           └── handlers.ts  # Typed room and round event handlers
    ├── shared/
    │   └── src/
    │       ├── constants.ts
    │       ├── events.ts
    │       ├── index.ts
    │       ├── random.ts       # Shared deterministic PRNG and sequence helpers
    │       └── types.ts
    ├── .env.example
    ├── package.json
    └── tsconfig.base.json

## Requirements

- Node.js 20 or newer
- npm 10 or newer

## Run the Phase 1 server

1. Install workspace dependencies:

       npm install

2. Copy .env.example to .env and adjust values if needed:

       PORT=3001
       CLIENT_ORIGIN=http://localhost:5173
       ROOM_DISCONNECT_GRACE_MS=60000
       ROUND_COUNTDOWN_MS=3000

3. Start the server in watch mode:

       npm run dev

4. Check the health endpoint at http://localhost:3001/health.

The root development command builds the shared TypeScript package first, then starts the server with tsx.

## Useful commands

    npm run typecheck
    npm test
    npm run build
    npm start

npm start expects a successful build first.

## Socket.IO protocol

All client-to-server commands use acknowledgements with a consistent response shape:

- Success: { ok: true, data: ... }
- Failure: { ok: false, error: { code, message } }

| Client event | Purpose |
| --- | --- |
| room:create | Create a room and receive its five-character code and reconnect token |
| room:join | Join a room by code and nickname |
| room:reconnect | Restore a disconnected player using the room code, player ID and reconnect token |
| room:leave | Leave the current room |
| room:configure | Host selects a test and Live or Async mode |
| player:ready | Set lobby readiness |
| round:start | Start a synchronized Live round or an immediate Async round |
| round:progress | Broadcast a player's current progress |
| round:submit | Submit a validated result |
| round:rematch | Return the room to its lobby state |

Server broadcasts include room:state, room:notice, round:countdown, round:started, player:progress, round:results and room:closed.

### Live mode

The host selects a test and starts the round once connected players are ready. The server creates one random seed and one future startAt timestamp, broadcasts the same round descriptor to the room, then changes the round to playing when the countdown expires. Every player receives the same seed so the client test module can generate the same deterministic scenario.

The shared package exports createSeededRandom, seededShuffle and seededIntegers. Using the same seed with these helpers produces the same sequence on the server and in browsers.

### Async mode

Any room member can start the selected test. The round begins immediately and uses one room-wide seed. Players can submit independently; the room result is finalised when every still-connected participant has submitted or disconnected.

### Reconnection

The server issues a random reconnect token when a player joins. Keep the roomCode, playerId and reconnectToken on the client so it can send room:reconnect after a dropped connection. Disconnected players remain reserved for the configured grace period (60 seconds by default); the host role is transferred if the host does not return.

## Phase 1 scope and limitations

- Room state is intentionally in memory. Restarting the server clears rooms.
- Reconnect credentials are designed for casual anonymous sessions, not account security.
- Score validation rejects malformed values and implausible ranges, including reaction times below 100 ms. Client-reported performance scores are still subject to stronger test-specific verification in the test phases.
- The React UI, individual test components, PostgreSQL persistence, Prisma schema, optional accounts, charts, Docker and deployment configuration are planned for later phases.

## Next phases

- **Phase 2:** Reaction Time test end-to-end with synchronized multiplayer play.
- **Phase 3:** Aim Trainer, Chimp Test, Number Memory and Typing Speed.
- **Phase 4:** Accounts, persistent history, friends and leaderboards.
- **Phase 5:** Docker, deployment, responsive polish and production hardening.
