import { createApplication } from "./app.js";
import { config } from "./config.js";

const { httpServer, io } = createApplication();

httpServer.listen(config.port, "0.0.0.0", () => {
  console.log("AbilityBenchmark server listening on port " + config.port);
});

function shutdown(signal: string): void {
  console.log(signal + " received; shutting down AbilityBenchmark server.");
  io.close(() => {
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
