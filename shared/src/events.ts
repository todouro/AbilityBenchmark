import type {
  AckCallback,
  ConfigureRoomPayload,
  CreateRoomPayload,
  JoinRoomPayload,
  PlayerProgressEvent,
  ReadyPayload,
  ReconnectRoomPayload,
  RoomNotice,
  RoomSessionPayload,
  RoomSnapshot,
  RoundDescriptor,
  RoundProgressPayload,
  RoundStartResponse,
  RoundSubmissionResponse,
  SubmitScorePayload
} from "./types.js";

export interface ClientToServerEvents {
  "room:create": (
    payload: CreateRoomPayload,
    ack: AckCallback<RoomSessionPayload>
  ) => void;
  "room:join": (
    payload: JoinRoomPayload,
    ack: AckCallback<RoomSessionPayload>
  ) => void;
  "room:reconnect": (
    payload: ReconnectRoomPayload,
    ack: AckCallback<RoomSessionPayload>
  ) => void;
  "room:leave": (ack: AckCallback<{ left: true }>) => void;
  "room:configure": (
    payload: ConfigureRoomPayload,
    ack: AckCallback<RoomSnapshot>
  ) => void;
  "player:ready": (
    payload: ReadyPayload,
    ack: AckCallback<RoomSnapshot>
  ) => void;
  "round:start": (ack: AckCallback<RoundStartResponse>) => void;
  "round:progress": (
    payload: RoundProgressPayload,
    ack: AckCallback<{ accepted: true }>
  ) => void;
  "round:submit": (
    payload: SubmitScorePayload,
    ack: AckCallback<RoundSubmissionResponse>
  ) => void;
  "round:rematch": (ack: AckCallback<RoomSnapshot>) => void;
}

export interface ServerToClientEvents {
  "room:state": (room: RoomSnapshot) => void;
  "room:notice": (notice: RoomNotice) => void;
  "room:closed": (message: string) => void;
  "round:countdown": (round: RoundDescriptor) => void;
  "round:started": (round: RoundDescriptor) => void;
  "player:progress": (event: PlayerProgressEvent) => void;
  "round:results": (event: {
    roundId: string;
    results: NonNullable<RoomSnapshot["currentRound"]>["results"];
    overallLeaderboard: RoomSnapshot["overallLeaderboard"];
  }) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  roomCode?: string;
  playerId?: string;
}
