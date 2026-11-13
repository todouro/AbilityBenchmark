import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData
} from "@ability-benchmark/shared";
import { config } from "./config.js";
import { attachRoomHandlers } from "./socket/handlers.js";

export function createApplication() {
  const app = express();

  const isAllowedOrigin = (origin?: string): boolean =>
    !origin ||
    config.clientOrigins.includes("*") ||
    config.clientOrigins.includes(origin);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Origin is not allowed by CORS."));
        }
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_request, response) => {
    response.json({
      ok: true,
      service: "abilitybenchmark-server",
      timestamp: Date.now()
    });
  });

  const httpServer = createServer(app);
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Origin is not allowed by CORS."));
        }
      },
      credentials: true
    },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 16_384
  });

  attachRoomHandlers(io, config);

  return { app, httpServer, io };
}
