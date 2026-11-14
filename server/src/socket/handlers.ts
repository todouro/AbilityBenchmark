import type { Server, Socket } from "socket.io";
import type {
  AckCallback,
  ClientToServerEvents,
  InterServerEvents,
  RoomErrorCode,
  RoomSnapshot,
  RoundResult,
  RoundSubmissionResponse,
  ServerToClientEvents,
  SocketData
} from "@ability-benchmark/shared";
import type { ServerConfig } from "../config.js";
import { RoomError, RoomStore } from "../rooms/room-store.js";

type AbilitySocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type AbilityServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

function errorResponse(error: unknown): {
  code: RoomErrorCode;
  message: string;
} {
  if (error instanceof RoomError) {
    return { code: error.code, message: error.message };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "The server could not complete that request."
  };
}

function acknowledge<T>(ack: AckCallback<T>, action: () => T): void {
  try {
    ack({ ok: true, data: action() });
  } catch (error) {
    ack({ ok: false, error: errorResponse(error) });
  }
}

function assertNoRoom(socket: AbilitySocket): void {
  if (socket.data.roomCode || socket.data.playerId) {
    throw new RoomError(
      "ALREADY_IN_ROOM",
      "Leave your current room before joining another one."
    );
  }
}

function getContext(socket: AbilitySocket): { roomCode: string; playerId: string } {
  const { roomCode, playerId } = socket.data;
  if (!roomCode || !playerId) {
    throw new RoomError("UNAUTHORIZED", "Join a room before using this action.");
  }
  return { roomCode, playerId };
}

const stores = new WeakMap<AbilityServer, RoomStore>();

function roomStoreFor(io: AbilityServer): RoomStore {
  const store = stores.get(io);
  if (!store) throw new Error("Room store has not been registered.");
  return store;
}

function emitResults(
  io: AbilityServer,
  roomCode: string,
  results: RoundResult[] | null
): void {
  if (!results) return;
  const room = roomStoreFor(io).getRoomSnapshot(roomCode);
  if (!room?.currentRound) return;

  io.to(roomCode).emit("round:results", {
    roundId: room.currentRound.id,
    results,
    overallLeaderboard: room.overallLeaderboard
  });
}

function registerSocketHandlers(
  io: AbilityServer,
  store: RoomStore
): void {
  stores.set(io, store);

  io.on("connection", (socket: AbilitySocket) => {
    socket.on("room:create", (payload, ack) => {
      acknowledge(ack, () => {
        assertNoRoom(socket);
        const session = store.createRoom(payload, socket.id);
        socket.data.roomCode = session.room.code;
        socket.data.playerId = session.playerId;
        socket.join(session.room.code);
        io.to(session.room.code).emit("room:state", session.room);
        return session;
      });
    });

    socket.on("room:join", (payload, ack) => {
      acknowledge(ack, () => {
        assertNoRoom(socket);
        const session = store.joinRoom(payload.code, payload.nickname, socket.id);
        socket.data.roomCode = session.room.code;
        socket.data.playerId = session.playerId;
        socket.join(session.room.code);
        io.to(session.room.code).emit("room:state", session.room);
        const joiningPlayer = session.room.players.find(
          (player) => player.id === session.playerId
        );
        io.to(session.room.code).emit("room:notice", {
          type: "player-joined",
          message: (joiningPlayer?.nickname ?? "A player") + " joined the room."
        });
        return session;
      });
    });

    socket.on("room:reconnect", (payload, ack) => {
      acknowledge(ack, () => {
        assertNoRoom(socket);
        const outcome = store.reconnectPlayer(
          payload.code,
          payload.playerId,
          payload.reconnectToken,
          socket.id
        );

        socket.data.roomCode = outcome.session.room.code;
        socket.data.playerId = outcome.session.playerId;
        socket.join(outcome.session.room.code);

        if (outcome.replacedSocketId) {
          const previousSocket = io.sockets.sockets.get(outcome.replacedSocketId);
          if (previousSocket && previousSocket.id !== socket.id) {
            previousSocket.data.roomCode = undefined;
            previousSocket.data.playerId = undefined;
            previousSocket.disconnect(true);
          }
        }

        io.to(outcome.session.room.code).emit("room:state", outcome.session.room);
        io.to(outcome.session.room.code).emit("room:notice", {
          type: "player-reconnected",
          message: "A player reconnected."
        });
        return outcome.session;
      });
    });

    socket.on("room:leave", (ack) => {
      acknowledge(ack, () => {
        const { roomCode, playerId } = getContext(socket);
        const outcome = store.leaveRoom(roomCode, playerId);
        socket.leave(roomCode);
        socket.data.roomCode = undefined;
        socket.data.playerId = undefined;

        if (outcome.room) {
          io.to(roomCode).emit("room:state", outcome.room);
          io.to(roomCode).emit("room:notice", {
            type: "player-left",
            message: "A player left the room."
          });
        } else {
          io.to(roomCode).emit("room:closed", "The room is now empty and has been closed.");
        }

        emitResults(io, roomCode, outcome.completedResults);
        return { left: true as const };
      });
    });

    socket.on("room:configure", (payload, ack) => {
      acknowledge(ack, () => {
        const { roomCode, playerId } = getContext(socket);
        const room = store.configureRoom(roomCode, playerId, payload);
        io.to(roomCode).emit("room:state", room);
        return room;
      });
    });

    socket.on("player:ready", (payload, ack) => {
      acknowledge(ack, () => {
        const { roomCode, playerId } = getContext(socket);
        const room = store.setReady(roomCode, playerId, payload.ready);
        io.to(roomCode).emit("room:state", room);
        return room;
      });
    });

    socket.on("round:start", (ack) => {
      acknowledge(ack, () => {
        const { roomCode, playerId } = getContext(socket);
        const outcome = store.startRound(roomCode, playerId);
        io.to(roomCode).emit("room:state", outcome.room);

        if (outcome.countdownMs > 0) {
          io.to(roomCode).emit("round:countdown", outcome.round);
          const timer = setTimeout(() => {
            const updatedRoom = store.markRoundStarted(roomCode, outcome.round.id);
            const startedRound = updatedRoom?.currentRound;
            if (updatedRoom && startedRound) {
              io.to(roomCode).emit("round:started", startedRound);
              io.to(roomCode).emit("room:state", updatedRoom);
            }
          }, outcome.countdownMs);
          timer.unref?.();
        } else {
          io.to(roomCode).emit("round:started", outcome.round);
        }

        return {
          round: outcome.round,
          countdownMs: outcome.countdownMs
        };
      });
    });

    socket.on("round:progress", (payload, ack) => {
      acknowledge(ack, () => {
        const { roomCode, playerId } = getContext(socket);
        store.updateProgress(roomCode, playerId, payload.roundId, payload.progress);

        const room = store.getRoomSnapshot(roomCode);
        const player = room?.players.find((entry) => entry.id === playerId);
        if (player?.progress) {
          io.to(roomCode).emit("player:progress", {
            playerId,
            nickname: player.nickname,
            progress: player.progress
          });
        }
        return { accepted: true as const };
      });
    });

    socket.on("round:submit", (payload, ack) => {
      acknowledge<RoundSubmissionResponse>(ack, () => {
        const { roomCode, playerId } = getContext(socket);
        const outcome = store.submitScore(
          roomCode,
          playerId,
          payload.roundId,
          payload.score
        );

        io.to(roomCode).emit("room:state", outcome.room);
        if (outcome.results) {
          emitResults(io, roomCode, outcome.results);
        }

        return {
          completed: outcome.completed,
          results: outcome.results,
          overallLeaderboard: outcome.room.overallLeaderboard
        };
      });
    });

    socket.on("round:rematch", (ack) => {
      acknowledge(ack, () => {
        const { roomCode, playerId } = getContext(socket);
        const room = store.rematch(roomCode, playerId);
        io.to(roomCode).emit("room:state", room);
        return room;
      });
    });

    socket.on("disconnect", () => {
      const outcome = store.disconnectSocket(socket.id);
      if (!outcome) return;

      io.to(outcome.roomCode).emit("room:state", outcome.room);
      io.to(outcome.roomCode).emit("room:notice", {
        type: "player-disconnected",
        message: "A player disconnected. They can reconnect for a short time."
      });
      emitResults(io, outcome.roomCode, outcome.completedResults);
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
    });
  });
}

export function attachRoomHandlers(
  io: AbilityServer,
  serverConfig: ServerConfig
): void {
  const store = new RoomStore({
    disconnectGraceMs: serverConfig.disconnectGraceMs,
    countdownMs: serverConfig.roundCountdownMs,
    onDisconnectExpired: (roomCode, room, completedResults) => {
      if (!room) {
        io.to(roomCode).emit(
          "room:closed",
          "A disconnected player did not return and the room is empty."
        );
        return;
      }

      io.to(roomCode).emit("room:state", room);
      io.to(roomCode).emit("room:notice", {
        type: "player-left",
        message: "A disconnected player was removed from the room."
      });

      if (completedResults && room.currentRound) {
        io.to(roomCode).emit("round:results", {
          roundId: room.currentRound.id,
          results: completedResults,
          overallLeaderboard: room.overallLeaderboard
        });
      }
    }
  });

  registerSocketHandlers(io, store);
}
