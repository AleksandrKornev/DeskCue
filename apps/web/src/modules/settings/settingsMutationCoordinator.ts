import { makeAutoObservable } from "mobx";

export type SettingsMutationKind = "daemon" | "storage";

export class SettingsMutationCoordinator {
  pendingMutation: SettingsMutationKind | null = null;
  private mutationToken = 0;

  constructor() {
    makeAutoObservable<this, "mutationToken">(
      this,
      {
        mutationToken: false
      },
      {
        autoBind: true
      }
    );
  }

  tryStart(kind: SettingsMutationKind) {
    if (this.pendingMutation) return null;

    this.mutationToken += 1;
    this.pendingMutation = kind;

    return this.mutationToken;
  }

  finish(token: number) {
    if (token !== this.mutationToken) return;

    this.pendingMutation = null;
  }

  reset() {
    this.mutationToken += 1;
    this.pendingMutation = null;
  }
}
