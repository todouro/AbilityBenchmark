import type { TestId } from "./constants.js";

export type RoomMode = "live" | "async";
export type RoomStatus = "lobby" | "countdown" | "playing" | "results";
export type RoundPhase = "countdown" | "playing" | "results";

export type ScoreUnit = "ms" | "ms/target" | "level" | "digits" | "wpm";

export interface ScoreSubmission {
  value: number;
  unit: ScoreUnit;
  accuracy?: number;
}

export interface PlayerProgress {
  completed: number;
  total: number;
  label?: string;
}

export interface PlayerSnapshot {
  id: string;
  nickname: string;
  isHost: boolean;
  isReady: boolean;
  isOnline: boolean;
  hasSubmitted: boolean;
  joinedAt: number;
  progress: PlayerProgress | null;
}

export interface LeaderboardEntry {
  playerId: string;
  nickname: string;
  points: number;
}

export interface RoundResult {
  playerId: string;
  nickname: string;
  score: ScoreSubmission;
  rank: number;
  points: number;
  submittedAt: number;
}

export interface RoundDescriptor {
  id: string;
  testId: TestId;
  mode: RoomMode;
  seed: string;
  phase: RoundPhase;
  createdAt: number;
  startAt: number;
  startedAt: number | null;
  results: RoundResult[] | null;
}

export interface RoomSnapshot {
  code: string;
  mode: RoomMode;
  status: RoomStatus;
  hostId: string;
  selectedTest: TestId;
  createdAt: number;
  players: PlayerSnapshot[];
  currentRound: RoundDescriptor | null;
  overallLeaderboard: LeaderboardEntry[];
}

export interface RoomSessionPayload {
  room: RoomSnapshot;
  playerId: string;
  reconnectToken: string;
}

export type RoomErrorCode =
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
  | "INTERNAL_ERROR";

export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: RoomErrorCode; message: string } };

export type AckCallback<T> = (response: Ack<T>) => void;

export interface CreateRoomPayload {
  nickname: string;
  mode?: RoomMode;
}

export interface JoinRoomPayload {
  code: string;
  nickname: string;
}

export interface ReconnectRoomPayload {
  code: string;
  playerId: string;
  reconnectToken: string;
}

export interface ConfigureRoomPayload {
  mode: RoomMode;
  testId: TestId;
}

export interface ReadyPayload {
  ready: boolean;
}

export interface RoundProgressPayload {
  roundId: string;
  progress: PlayerProgress;
}

export interface SubmitScorePayload {
  roundId: string;
  score: ScoreSubmission;
}

export interface RoundStartResponse {
  round: RoundDescriptor;
  countdownMs: number;
}

export interface RoundSubmissionResponse {
  completed: boolean;
  results: RoundResult[] | null;
  overallLeaderboard: LeaderboardEntry[];
}

export interface RoomNotice {
  type:
    | "player-joined"
    | "player-left"
    | "player-disconnected"
    | "player-reconnected"
    | "host-changed";
  message: string;
}

export interface PlayerProgressEvent {
  playerId: string;
  nickname: string;
  progress: PlayerProgress;
}
