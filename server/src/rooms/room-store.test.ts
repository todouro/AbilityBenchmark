import assert from "node:assert/strict";
import test from "node:test";
import { RoomStore } from "./room-store.js";

test("creates five-character private rooms and assigns the creator as host", () => {
  const store = new RoomStore();
  const session = store.createRoom({ nickname: "Shan" }, "socket-host");

  assert.equal(session.room.code.length, 5);
  assert.match(session.room.code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);
  assert.equal(session.room.players.length, 1);
  assert.equal(session.room.players[0]?.nickname, "Shan");
  assert.equal(session.room.players[0]?.isHost, true);
  assert.equal(session.room.status, "lobby");
});

test("live rounds require everyone to be ready and share one server seed", () => {
  const store = new RoomStore({ countdownMs: 3_000 });
  const host = store.createRoom({ nickname: "Host" }, "socket-host");
  const guest = store.joinRoom(host.room.code, "Guest", "socket-guest");

  assert.throws(
    () => store.startRound(host.room.code, host.playerId),
    /every connected player is ready/
  );

  store.setReady(host.room.code, guest.playerId, true);
  const start = store.startRound(host.room.code, host.playerId);

  assert.equal(start.countdownMs, 3_000);
  assert.equal(start.round.phase, "countdown");
  assert.equal(start.round.seed.length, 16);
  assert.equal(start.round.testId, "reaction-time");

  const active = store.markRoundStarted(host.room.code, start.round.id);
  assert.equal(active?.status, "playing");
  assert.equal(active?.currentRound?.startedAt !== null, true);
});

test("completed live rounds rank scores and award placement points", () => {
  const store = new RoomStore({ countdownMs: 1 });
  const host = store.createRoom({ nickname: "Host" }, "socket-host");
  const guest = store.joinRoom(host.room.code, "Guest", "socket-guest");
  store.setReady(host.room.code, guest.playerId, true);

  const started = store.startRound(host.room.code, host.playerId);
  store.markRoundStarted(host.room.code, started.round.id);

  const firstSubmission = store.submitScore(
    host.room.code,
    host.playerId,
    started.round.id,
    { value: 190, unit: "ms" }
  );
  assert.equal(firstSubmission.completed, false);

  const finalSubmission = store.submitScore(
    host.room.code,
    guest.playerId,
    started.round.id,
    { value: 155, unit: "ms" }
  );

  assert.equal(finalSubmission.completed, true);
  assert.equal(finalSubmission.results?.[0]?.playerId, guest.playerId);
  assert.equal(finalSubmission.results?.[0]?.rank, 1);
  assert.equal(finalSubmission.results?.[0]?.points, 2);
  assert.equal(finalSubmission.results?.[1]?.playerId, host.playerId);
  assert.equal(finalSubmission.room.status, "results");
});

test("a disconnected player can reconnect with their room token", () => {
  const store = new RoomStore({ disconnectGraceMs: 60_000 });
  const session = store.createRoom({ nickname: "Player" }, "socket-old");

  store.disconnectSocket("socket-old");
  const outcome = store.reconnectPlayer(
    session.room.code,
    session.playerId,
    session.reconnectToken,
    "socket-new"
  );

  assert.equal(outcome.session.playerId, session.playerId);
  assert.equal(outcome.session.room.players[0]?.isOnline, true);
  assert.equal(outcome.replacedSocketId, null);
});

test("the host role transfers when the host leaves", () => {
  const store = new RoomStore();
  const host = store.createRoom({ nickname: "Host" }, "socket-host");
  const guest = store.joinRoom(host.room.code, "Guest", "socket-guest");

  const result = store.leaveRoom(host.room.code, host.playerId);
  assert.equal(result.room?.hostId, guest.playerId);
  assert.equal(result.room?.players[0]?.isHost, true);
});
