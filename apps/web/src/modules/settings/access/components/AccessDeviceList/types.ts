import type {
  AccessDeviceSummary,
  CurrentAccessState
} from "@deskcue/protocol";

export type AccessDeviceListProps = {
  currentAccess: CurrentAccessState | null;
  devices: AccessDeviceSummary[];
  forgettingCurrentBrowser: boolean;
  loading: boolean;
  renamingDeviceId: string | null;
  resettingOtherTokens: boolean;
  revokingDeviceId: string | null;
  onForgetCurrentBrowser: () => void;
  onRenameDevice: (device: AccessDeviceSummary, label: string) => Promise<boolean>;
  onRevokeDevice: (device: AccessDeviceSummary) => void;
  onRevokeOtherDevices: () => void;
};

export type AccessDeviceGroup = {
  key: string;
  devices: AccessDeviceSummary[];
  host: boolean;
  latestDevice: AccessDeviceSummary;
};
