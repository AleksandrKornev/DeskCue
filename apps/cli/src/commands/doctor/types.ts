export type FileStatus =
  | {
      exists: false;
      path: string;
    }
  | {
      exists: true;
      modifiedAt: string;
      path: string;
      sizeBytes: number;
    };

export type ToolStatus = {
  available: boolean;
  detail: string;
};

export type MigrationFailure = {
  backupPath: string | null;
  databaseFile: string | null;
  detail: string | null;
  message: string;
  timestamp: string | null;
};
