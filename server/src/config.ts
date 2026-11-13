import "dotenv/config";
import {
  DEFAULT_DISCONNECT_GRACE_MS,
  DEFAULT_ROUND_COUNTDOWN_MS
} from "@ability-benchmark/shared";

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(name + " must be a positive integer.");
  }

  return parsed;
}

const rawOrigins = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";

export interface ServerConfig {
  port: number;
  clientOrigins: string[];
  disconnectGraceMs: number;
  roundCountdownMs: number;
}

export const config: ServerConfig = {
  port: readPositiveInteger("PORT", 3001),
  clientOrigins: rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  disconnectGraceMs: readPositiveInteger(
    "ROOM_DISCONNECT_GRACE_MS",
    DEFAULT_DISCONNECT_GRACE_MS
  ),
  roundCountdownMs: readPositiveInteger(
    "ROUND_COUNTDOWN_MS",
    DEFAULT_ROUND_COUNTDOWN_MS
  )
};
