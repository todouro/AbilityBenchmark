export const TEST_IDS = [
  "reaction-time",
  "aim-trainer",
  "chimp-test",
  "number-memory",
  "typing-speed"
] as const;

export type TestId = (typeof TEST_IDS)[number];

export const DEFAULT_TEST_ID: TestId = "reaction-time";

export const ROOM_CODE_LENGTH = 5;
export const MAX_ROOM_PLAYERS = 12;
export const MAX_NICKNAME_LENGTH = 20;
export const DEFAULT_DISCONNECT_GRACE_MS = 60_000;
export const DEFAULT_ROUND_COUNTDOWN_MS = 3_000;

export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
