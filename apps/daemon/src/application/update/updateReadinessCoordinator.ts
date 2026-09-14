import type { SqliteDatabaseContext } from "#persistence/connection/sqliteConnection";
import { createPreUpdateBackup } from "#persistence/migrations/sqliteMigrationBackup";

import type { UpdateAdmission, UpdateAdmissionDrainLease } from "./updateAdmission.ts";
import {
  pruneUpdateBackupsBeforeCreate,
  retainCurrentUpdateBackup
} from "./updateBackupRetention.ts";

export type UpdateReadinessBlockerCode =
  | "local_llm_generation_active"
  | "lm_studio_operation_active"
  | "managed_session_running"
  | "manual_command_active"
  | "source_agent_turn_active";

export type UpdateReadinessBlocker = {
  code: UpdateReadinessBlockerCode;
  count: number;
  message: string;
};

export type UpdateDrainLease = {
  backupPath: string | null;
  blockers: [];
  ok: true;
  release: () => void;
};

export type UpdateDrainBlocked = {
  blockers: UpdateReadinessBlocker[];
  ok: false;
};

export type UpdateDrainResult = UpdateDrainBlocked | UpdateDrainLease;

type UpdateReadinessProbes = {
  countActiveLocalLlmGenerations: () => number;
  countActiveLmStudioOperations: () => number;
  countActiveManagedSessions: () => number;
  countActiveManualCommands: () => number;
  countActiveSourceAgentTurns: () => Promise<number>;
};

function blocker(code: UpdateReadinessBlockerCode, count: number, message: string) {
  return count > 0 ? { code, count, message } : null;
}

export class UpdateReadinessCoordinator {
  private beginFlight: Promise<UpdateDrainResult> | null = null;
  private heldLease: UpdateDrainLease | null = null;

  constructor(
    private readonly admission: UpdateAdmission,
    private readonly probes: UpdateReadinessProbes,
    private readonly sqliteContext: SqliteDatabaseContext
  ) {}

  beginUpdateDrain(
    quiesceDatabaseWriters: () => Promise<void>
  ): Promise<UpdateDrainResult> {
    if (this.heldLease) return Promise.resolve(this.heldLease);
    if (this.beginFlight) return this.beginFlight;

    this.beginFlight = this.prepareUpdate(quiesceDatabaseWriters).finally(() => {
      this.beginFlight = null;
    });
    return this.beginFlight;
  }

  private async prepareUpdate(
    quiesceDatabaseWriters: () => Promise<void>
  ): Promise<UpdateDrainResult> {
    const admissionLease = this.admission.beginDrain();

    try {
      const sourceAgentTurnCount = await this.probes.countActiveSourceAgentTurns();
      const blockers = [
        blocker(
          "managed_session_running",
          Math.max(
            this.probes.countActiveManagedSessions(),
            this.admission.getActiveCount("managed_session")
          ),
          "One or more DeskCue-managed agent sessions are still running."
        ),
        blocker(
          "source_agent_turn_active",
          Math.max(sourceAgentTurnCount, this.admission.getActiveCount("source_agent")),
          "One or more source-agent turns are still active."
        ),
        blocker(
          "local_llm_generation_active",
          Math.max(
            this.probes.countActiveLocalLlmGenerations(),
            this.admission.getActiveCount("local_llm")
          ),
          "One or more local LLM generations are still active."
        ),
        blocker(
          "manual_command_active",
          Math.max(
            this.probes.countActiveManualCommands(),
            this.admission.getActiveCount("manual_command")
          ),
          "One or more manual commands are still running."
        ),
        blocker(
          "lm_studio_operation_active",
          Math.max(
            this.probes.countActiveLmStudioOperations(),
            this.admission.getActiveCount("lm_studio")
          ),
          "One or more LM Studio runtime operations are still active."
        )
      ].filter((item): item is UpdateReadinessBlocker => item !== null);

      if (blockers.length > 0) {
        admissionLease.release();
        return { blockers, ok: false };
      }

      await quiesceDatabaseWriters();

      pruneUpdateBackupsBeforeCreate(this.sqliteContext.databaseFilePath);
      const backupPath = createPreUpdateBackup({
        database: this.sqliteContext.database,
        databaseFilePath: this.sqliteContext.databaseFilePath
      });

      if (backupPath) {
        retainCurrentUpdateBackup(this.sqliteContext.databaseFilePath, backupPath);
      }

      const lease = this.createHeldLease(admissionLease, backupPath);

      this.heldLease = lease;

      return lease;
    } catch (error) {
      admissionLease.release();
      throw error;
    }
  }

  private createHeldLease(admissionLease: UpdateAdmissionDrainLease, backupPath: string | null) {
    let released = false;
    const lease: UpdateDrainLease = {
      backupPath,
      blockers: [],
      ok: true,
      release: () => {
        if (released) return;

        released = true;
        if (this.heldLease === lease) this.heldLease = null;
        admissionLease.release();
      }
    };

    return lease;
  }
}
