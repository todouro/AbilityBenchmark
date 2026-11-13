import { randomBytes, randomUUID } from "node:crypto";
import {
  DEFAULT_DISCONNECT_GRACE_MS,
  DEFAULT_ROUND_COUNTDOWN_MS,
  DEFAULT_TEST_ID,
  MAX_NICKNAME_LENGTH,
  MAX_ROOM_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  TEST_IDS
} from "@ability-benchmark/shared";
import type {
  ConfigureRoomPayload,
  CreateRoomPayload,
  LeaderboardEntry,
  PlayerProgress,
  PlayerSnapshot,
  RoomMode,
  RoomSessionPayload,
  RoomSnapshot,
  RoomStatus,
  RoundDescriptor,
  RoundResult,
  ScoreSubmission,
  TestId
} from "@ability-benchmark/shared";
import { validateScore } from "./score-validation.js";

interface StoredPlayer {
  id: string;
  nickname: string;
  reconnectToken: string;
  socketId: string | null;
  isReady: boolean;
  joinedAt: number;
  lastSeenAt: number;
  progress: PlayerProgress | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

interface StoredRound extends RoundDescriptor {
  eligiblePlayerIds: string[];
  submissions: Map<string, { score: ScoreSubmission; submittedAt: number }>;
}

interface StoredRoom {
  code: string;
  mode: RoomMode;
  status: RoomStatus;
  hostId: string;
  selectedTest: TestId;
  createdAt: number;
  players: Map<string, StoredPlayer>;
  currentRound: StoredRound | null;
  overallPoints: Map<string, number>;
}

export class RoomError extends Error {
  constructor(
    public readonly code:
      | "INVALID_INPUT"
      | "ROOM_NOT_FOUND"
      | "ROOM_FULL"
      | "ROOM_ACTIVE"
      | "NOT_HOST"
      | "NOT_READY"
      | "ROUND_NOT_ACTIVE"
      | "DUPLICATE_SUBMISSION"
      | "INVALID_SCORE"
      | "UNAUTHORIZED"
      | "ALREADY_IN_ROOM"
      | "INTERNAL_ERROR",
    message: string
  ) {
    super(message);
    this.name = "RoomError";
  }
}

export interface RoomStoreOptions {
  disconnectGraceMs?: number;
  countdownMs?: number;
  onDisconnectExpired?: (
    roomCode: string,
    room: RoomSnapshot | null,
    completedResults: RoundResult[] | null
  ) => void;
}

export interface ReconnectOutcome {
  session: RoomSessionPayload;
  replacedSocketId: string | null;
}

export interface RoundStartOutcome {
  room: RoomSnapshot;
  round: RoundDescriptor;
  countdownMs: number;
}

export interface RoundSubmissionOutcome {
  room: RoomSnapshot;
  completed: boolean;
  results: RoundResult[] | null;
}

export interface DisconnectOutcome {
  roomCode: string;
  room: RoomSnapshot;
  completedResults: RoundResult[] | null;
}

export interface LeaveOutcome {
  roomCode: string;
  room: RoomSnapshot | null;
  completedResults: RoundResult[] | null;
}

export class RoomStore {
  private readonly rooms = new Map<string, StoredRoom>();
  private readonly disconnectGraceMs: number;
  private readonly countdownMs: number;
  private readonly onDisconnectExpired?: RoomStoreOptions["onDisconnectExpired"];

  constructor(options: RoomStoreOptions = {}) {
    this.disconnectGraceMs =
      options.disconnectGraceMs ?? DEFAULT_DISCONNECT_GRACE_MS;
    this.countdownMs = options.countdownMs ?? DEFAULT_ROUND_COUNTDOWN_MS;
    this.onDisconnectExpired = options.onDisconnectExpired;
  }

  createRoom(payload: CreateRoomPayload, socketId: string): RoomSessionPayload {
    const nickname = this.normalizeNickname(payload.nickname);
    const mode = payload.mode ?? "live";
    this.assertMode(mode);

    const code = this.createUniqueCode();
    const player = this.createPlayer(nickname, socketId, true);
    const room: StoredRoom = {
      code,
      mode,
      status: "lobby",
      hostId: player.id,
      selectedTest: DEFAULT_TEST_ID,
      createdAt: Date.now(),
      players: new Map([[player.id, player]]),
      currentRound: null,
      overallPoints: new Map([[player.id, 0]])
    };

    this.rooms.set(code, room);
    return this.createSession(room, player);
  }

  joinRoom(codeInput: string, nicknameInput: string, socketId: string): RoomSessionPayload {
    const code = this.normalizeCode(codeInput);
    const room = this.requireRoom(code);

    if (room.status === "countdown" || room.status === "playing") {
      throw new RoomError("ROOM_ACTIVE", "This room is already playing a round.");
    }

    if (room.players.size >= MAX_ROOM_PLAYERS) {
      throw new RoomError("ROOM_FULL", "This room has reached its player limit.");
    }

    const player = this.createPlayer(
      this.normalizeNickname(nicknameInput),
      socketId,
      false
    );
    room.players.set(player.id, player);
    room.overallPoints.set(player.id, 0);

    return this.createSession(room, player);
  }

  reconnectPlayer(
    codeInput: string,
    playerId: string,
    reconnectToken: string,
    socketId: string
  ): ReconnectOutcome {
    const code = this.normalizeCode(codeInput);
    const room = this.requireRoom(code);
    const player = room.players.get(playerId);

    if (!player || player.reconnectToken !== reconnectToken) {
      throw new RoomError("UNAUTHORIZED", "The reconnect details are invalid or expired.");
    }

    const replacedSocketId = player.socketId;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);

    player.disconnectTimer = null;
    player.socketId = socketId;
    player.lastSeenAt = Date.now();

    return {
      session: this.createSession(room, player),
      replacedSocketId
    };
  }

  disconnectSocket(socketId: string): DisconnectOutcome | null {
    const match = this.findPlayerBySocket(socketId);
    if (!match) return null;

    const { room, player } = match;
    player.socketId = null;
    player.lastSeenAt = Date.now();

    const completedResults = this.completeRoundIfReady(room);
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);

    player.disconnectTimer = setTimeout(() => {
      const currentRoom = this.rooms.get(room.code);
      const currentPlayer = currentRoom?.players.get(player.id);
      if (!currentRoom || !currentPlayer || currentPlayer.socketId !== null) return;

      const expiredResults = this.removePlayer(currentRoom, player.id);
      const snapshot = this.rooms.has(room.code)
        ? this.snapshot(currentRoom)
        : null;
      this.onDisconnectExpired?.(room.code, snapshot, expiredResults);
    }, this.disconnectGraceMs);

    player.disconnectTimer.unref?.();

    return {
      roomCode: room.code,
      room: this.snapshot(room),
      completedResults
    };
  }

  leaveRoom(roomCode: string, playerId: string): LeaveOutcome {
    const room = this.requireRoom(roomCode);
    if (!room.players.has(playerId)) {
      throw new RoomError("UNAUTHORIZED", "You are not a member of this room.");
    }

    const completedResults = this.removePlayer(room, playerId);
    return {
      roomCode: room.code,
      room: this.rooms.has(room.code) ? this.snapshot(room) : null,
      completedResults
    };
  }

  configureRoom(
    roomCode: string,
    playerId: string,
    payload: ConfigureRoomPayload
  ): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    this.requireHost(room, playerId);
    this.requireEditable(room);

    if (!TEST_IDS.includes(payload.testId)) {
      throw new RoomError("INVALID_INPUT", "The selected test is not supported.");
    }
    this.assertMode(payload.mode);

    room.mode = payload.mode;
    room.selectedTest = payload.testId;
    room.status = "lobby";
    room.currentRound = null;

    for (const player of room.players.values()) {
      player.isReady = player.id === room.hostId;
      player.progress = null;
    }

    return this.snapshot(room);
  }

  setReady(roomCode: string, playerId: string, ready: boolean): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    const player = this.requirePlayer(room, playerId);

    if (room.status !== "lobby") {
      throw new RoomError("ROOM_ACTIVE", "Ready status can only change in the lobby.");
    }
    if (typeof ready !== "boolean") {
      throw new RoomError("INVALID_INPUT", "Ready status must be true or false.");
    }

    player.isReady = player.id === room.hostId ? true : ready;
    return this.snapshot(room);
  }

  startRound(roomCode: string, playerId: string): RoundStartOutcome {
    const room = this.requireRoom(roomCode);

    if (room.status !== "lobby" && room.status !== "results") {
      throw new RoomError("ROOM_ACTIVE", "A round is already active.");
    }

    if (room.mode === "live") {
      this.requireHost(room, playerId);
      const everyoneReady = [...room.players.values()].every(
        (player) => player.socketId === null || player.isReady
      );
      if (!everyoneReady) {
        throw new RoomError("NOT_READY", "Wait until every connected player is ready.");
      }
    } else {
      this.requirePlayer(room, playerId);
    }

    const eligiblePlayerIds = [...room.players.values()]
      .filter((player) => player.socketId !== null)
      .map((player) => player.id);

    if (eligiblePlayerIds.length === 0) {
      throw new RoomError("ROOM_NOT_FOUND", "There are no connected players in this room.");
    }

    const now = Date.now();
    const countdownMs = room.mode === "live" ? this.countdownMs : 0;
    const round: StoredRound = {
      id: randomUUID(),
      testId: room.selectedTest,
      mode: room.mode,
      seed: randomBytes(8).toString("hex"),
      phase: countdownMs > 0 ? "countdown" : "playing",
      createdAt: now,
      startAt: now + countdownMs,
      startedAt: countdownMs > 0 ? null : now,
      results: null,
      eligiblePlayerIds,
      submissions: new Map()
    };

    room.currentRound = round;
    room.status = round.phase;

    for (const player of room.players.values()) {
      player.progress = null;
      if (room.mode === "live") player.isReady = false;
    }

    return {
      room: this.snapshot(room),
      round: this.publicRound(round),
      countdownMs
    };
  }

  markRoundStarted(roomCode: string, roundId: string): RoomSnapshot | null {
    const room = this.rooms.get(this.normalizeCode(roomCode));
    const round = room?.currentRound;

    if (!room || !round || round.id !== roundId || round.phase !== "countdown") {
      return null;
    }

    round.phase = "playing";
    round.startedAt = Date.now();
    room.status = "playing";
    return this.snapshot(room);
  }

  updateProgress(
    roomCode: string,
    playerId: string,
    roundId: string,
    progress: PlayerProgress
  ): void {
    const room = this.requireRoom(roomCode);
    const round = room.currentRound;
    const player = this.requirePlayer(room, playerId);

    if (!round || round.id !== roundId || round.phase !== "playing") {
      throw new RoomError("ROUND_NOT_ACTIVE", "There is no active round to update.");
    }

    if (!round.eligiblePlayerIds.includes(playerId)) {
      throw new RoomError("UNAUTHORIZED", "You are not part of this round.");
    }

    if (
      !progress ||
      !Number.isInteger(progress.completed) ||
      !Number.isInteger(progress.total) ||
      progress.total < 1 ||
      progress.total > 1_000 ||
      progress.completed < 0 ||
      progress.completed > progress.total ||
      (progress.label !== undefined && typeof progress.label !== "string")
    ) {
      throw new RoomError("INVALID_INPUT", "Progress values are invalid.");
    }

    player.progress = {
      completed: progress.completed,
      total: progress.total,
      ...(progress.label
        ? { label: progress.label.trim().slice(0, 32) }
        : {})
    };
  }

  submitScore(
    roomCode: string,
    playerId: string,
    roundId: string,
    score: ScoreSubmission
  ): RoundSubmissionOutcome {
    const room = this.requireRoom(roomCode);
    const round = room.currentRound;
    const player = this.requirePlayer(room, playerId);

    if (!round || round.id !== roundId || round.phase !== "playing") {
      throw new RoomError("ROUND_NOT_ACTIVE", "There is no active round to submit.");
    }

    if (round.startedAt === null || Date.now() < round.startedAt) {
      throw new RoomError("ROUND_NOT_ACTIVE", "The round has not started yet.");
    }

    if (!round.eligiblePlayerIds.includes(playerId)) {
      throw new RoomError("UNAUTHORIZED", "You are not part of this round.");
    }

    if (round.submissions.has(playerId)) {
      throw new RoomError("DUPLICATE_SUBMISSION", "You have already submitted this round.");
    }

    const validationError = validateScore(round.testId, score);
    if (validationError) {
      throw new RoomError("INVALID_SCORE", validationError);
    }

    round.submissions.set(playerId, {
      score: { ...score },
      submittedAt: Date.now()
    });
    player.progress = { completed: 1, total: 1, label: "Submitted" };

    const results = this.completeRoundIfReady(room);
    return {
      room: this.snapshot(room),
      completed: results !== null,
      results
    };
  }

  rematch(roomCode: string, playerId: string): RoomSnapshot {
    const room = this.requireRoom(roomCode);
    this.requireHost(room, playerId);

    if (room.status !== "results" && room.status !== "lobby") {
      throw new RoomError("ROOM_ACTIVE", "A rematch can only be prepared between rounds.");
    }

    room.currentRound = null;
    room.status = "lobby";

    for (const player of room.players.values()) {
      player.isReady = player.id === room.hostId;
      player.progress = null;
    }

    return this.snapshot(room);
  }

  getRoomSnapshot(roomCode: string): RoomSnapshot | null {
    const room = this.rooms.get(this.normalizeCode(roomCode));
    return room ? this.snapshot(room) : null;
  }

  private createPlayer(
    nickname: string,
    socketId: string,
    isHost: boolean
  ): StoredPlayer {
    const now = Date.now();
    return {
      id: randomUUID(),
      nickname,
      reconnectToken: randomBytes(32).toString("base64url"),
      socketId,
      isReady: isHost,
      joinedAt: now,
      lastSeenAt: now,
      progress: null,
      disconnectTimer: null
    };
  }

  private createSession(room: StoredRoom, player: StoredPlayer): RoomSessionPayload {
    return {
      room: this.snapshot(room),
      playerId: player.id,
      reconnectToken: player.reconnectToken
    };
  }

  private createUniqueCode(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = "";
      for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
        const choice = randomBytes(1)[0] ?? 0;
        code += ROOM_CODE_ALPHABET[choice % ROOM_CODE_ALPHABET.length];
      }
      if (!this.rooms.has(code)) return code;
    }

    throw new RoomError("INTERNAL_ERROR", "Could not allocate a room code. Try again.");
  }

  private normalizeNickname(input: string): string {
    if (typeof input !== "string") {
      throw new RoomError("INVALID_INPUT", "Nickname must be text.");
    }

    const nickname = input
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .trim()
      .slice(0, MAX_NICKNAME_LENGTH);

    if (!nickname) {
      throw new RoomError("INVALID_INPUT", "Enter a nickname before joining.");
    }

    return nickname;
  }

  private normalizeCode(input: string): string {
    if (typeof input !== "string") {
      throw new RoomError("INVALID_INPUT", "Room code must be text.");
    }
    return input.trim().toUpperCase();
  }

  private assertMode(mode: RoomMode): void {
    if (mode !== "live" && mode !== "async") {
      throw new RoomError("INVALID_INPUT", "Room mode must be Live or Async.");
    }
  }

  private requireRoom(codeInput: string): StoredRoom {
    const room = this.rooms.get(this.normalizeCode(codeInput));
    if (!room) throw new RoomError("ROOM_NOT_FOUND", "That room code was not found.");
    return room;
  }

  private requirePlayer(room: StoredRoom, playerId: string): StoredPlayer {
    const player = room.players.get(playerId);
    if (!player) throw new RoomError("UNAUTHORIZED", "You are not a member of this room.");
    return player;
  }

  private requireHost(room: StoredRoom, playerId: string): void {
    this.requirePlayer(room, playerId);
    if (room.hostId !== playerId) {
      throw new RoomError("NOT_HOST", "Only the room host can do that.");
    }
  }

  private requireEditable(room: StoredRoom): void {
    if (room.status === "countdown" || room.status === "playing") {
      throw new RoomError("ROOM_ACTIVE", "Room settings cannot change during a round.");
    }
  }

  private findPlayerBySocket(
    socketId: string
  ): { room: StoredRoom; player: StoredPlayer } | null {
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) return { room, player };
      }
    }
    return null;
  }

  private removePlayer(room: StoredRoom, playerId: string): RoundResult[] | null {
    const player = room.players.get(playerId);
    if (!player) return null;

    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    room.players.delete(playerId);
    room.overallPoints.delete(playerId);

    if (room.currentRound) {
      room.currentRound.eligiblePlayerIds = room.currentRound.eligiblePlayerIds.filter(
        (id) => id !== playerId
      );
    }

    if (room.players.size === 0) {
      this.rooms.delete(room.code);
      return null;
    }

    if (room.hostId === playerId) {
      const nextHost = [...room.players.values()].sort((a, b) => {
        const onlineOrder = Number(b.socketId !== null) - Number(a.socketId !== null);
        return onlineOrder || a.joinedAt - b.joinedAt;
      })[0];

      if (nextHost) {
        room.hostId = nextHost.id;
        nextHost.isReady = true;
      }
    }

    return this.completeRoundIfReady(room);
  }

  private completeRoundIfReady(room: StoredRoom): RoundResult[] | null {
    const round = room.currentRound;
    if (!round || round.phase !== "playing") return null;

    const hasPendingPlayer = round.eligiblePlayerIds.some((playerId) => {
      if (round.submissions.has(playerId)) return false;
      const participant = room.players.get(playerId);
      if (!participant) return false;
      // Async players may return during the reconnect grace period and submit later.
      return round.mode === "async" || participant.socketId !== null;
    });

    if (hasPendingPlayer || round.submissions.size === 0) return null;

    const lowerIsBetter =
      round.testId === "reaction-time" || round.testId === "aim-trainer";
    const submitted = [...round.submissions.entries()]
      .map(([playerId, submission]) => {
        const player = room.players.get(playerId);
        return player
          ? {
              playerId,
              nickname: player.nickname,
              score: submission.score,
              submittedAt: submission.submittedAt
            }
          : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) =>
        lowerIsBetter ? a.score.value - b.score.value : b.score.value - a.score.value
      );

    const total = submitted.length;
    let lastValue: number | null = null;
    let lastRank = 0;

    const results = submitted.map((entry, index): RoundResult => {
      const rank =
        lastValue !== null && entry.score.value === lastValue ? lastRank : index + 1;
      lastValue = entry.score.value;
      lastRank = rank;

      const points = Math.max(1, total - rank + 1);
      room.overallPoints.set(
        entry.playerId,
        (room.overallPoints.get(entry.playerId) ?? 0) + points
      );

      return {
        ...entry,
        rank,
        points
      };
    });

    round.results = results;
    round.phase = "results";
    room.status = "results";
    return results;
  }

  private publicRound(round: StoredRound): RoundDescriptor {
    return {
      id: round.id,
      testId: round.testId,
      mode: round.mode,
      seed: round.seed,
      phase: round.phase,
      createdAt: round.createdAt,
      startAt: round.startAt,
      startedAt: round.startedAt,
      results: round.results ? [...round.results] : null
    };
  }

  private snapshot(room: StoredRoom): RoomSnapshot {
    const round = room.currentRound;
    const players: PlayerSnapshot[] = [...room.players.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((player) => ({
        id: player.id,
        nickname: player.nickname,
        isHost: player.id === room.hostId,
        isReady: player.isReady,
        isOnline: player.socketId !== null,
        hasSubmitted: round?.submissions.has(player.id) ?? false,
        joinedAt: player.joinedAt,
        progress: player.progress
      }));

    const overallLeaderboard: LeaderboardEntry[] = players
      .map((player) => ({
        playerId: player.id,
        nickname: player.nickname,
        points: room.overallPoints.get(player.id) ?? 0
      }))
      .sort((a, b) => b.points - a.points);

    return {
      code: room.code,
      mode: room.mode,
      status: room.status,
      hostId: room.hostId,
      selectedTest: room.selectedTest,
      createdAt: room.createdAt,
      players,
      currentRound: round ? this.publicRound(round) : null,
      overallLeaderboard
    };
  }
}
