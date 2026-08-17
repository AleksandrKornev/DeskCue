import type { OverviewResponse } from "@deskcue/protocol";

export const initialOverview: OverviewResponse = {
  clientContext: {
    canOpenNativeDialogs: false
  },
  workspaces: [],
  sessions: []
};
