import { loadDaemonEnvFiles } from "#config/envFiles";

loadDaemonEnvFiles();

const { startDaemonServer } = await import("#server/startDaemonServer");
const { flushLogger, logger } = await import("#infrastructure/logging/logger");

try {
  await startDaemonServer();
} catch (error) {
  logger.error("DeskCue daemon startup failed", {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exitCode = 1;
  try {
    await flushLogger();
  } catch (flushError) {
    process.stderr.write(
      `DeskCue daemon failed to flush logs after startup failure: ${
        flushError instanceof Error ? flushError.message : String(flushError)
      }\n`
    );
  }
}
