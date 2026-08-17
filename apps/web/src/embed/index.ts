import { DeskCueRemoteApp } from "./DeskCueRemoteApp";

export { DeskCueRemoteApp };
export type DeskCueRemoteAppProps = Parameters<typeof DeskCueRemoteApp>[0];
export type {
  DeskCueRuntime,
  DeskCueRuntimeFeatures,
  DeskCueRuntimeMode
} from "@runtime";
