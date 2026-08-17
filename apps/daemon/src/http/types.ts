import type { SessionDetail, SessionSummary } from "@deskcue/protocol";

export type DecorateSession = <T extends SessionSummary | SessionDetail>(session: T) => T;
