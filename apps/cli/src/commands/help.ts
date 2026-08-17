import { DEFAULT_DAEMON_PORT, DEFAULT_WEB_PORT } from "@deskcue/protocol";

export function printStartHelp() {
  console.log("DeskCue local start");
  console.log("");
  console.log("Run DeskCue from the repository root:");
  console.log("  npm run start");
  console.log("");
  console.log(`Daemon: http://localhost:${DEFAULT_DAEMON_PORT}`);
  console.log(`Web:    http://localhost:${DEFAULT_DAEMON_PORT}`);
  console.log("");
  console.log("For development with Vite hot reload:");
  console.log("  npm run dev");
  console.log(`Dev web: http://localhost:${DEFAULT_WEB_PORT}`);
  console.log("");
  console.log("The current MVP loop supports workspace registration, command execution, logs, git diff, preview port selection, and stdin input.");
}

export function printUsage() {
  console.log("DeskCue CLI");
  console.log("");
  console.log("Usage:");
  console.log("  deskcue start");
  console.log("  deskcue doctor");
}
