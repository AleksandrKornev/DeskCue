import { makeAutoObservable } from "mobx";

export class PreviewReviewStore {
  reloadVersion = 0;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  reload() {
    this.reloadVersion += 1;
  }

}

export const previewReviewStore = new PreviewReviewStore();
