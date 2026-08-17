import type { AccessLinkResponse } from "@deskcue/protocol";

export type PairingHostOption = {
  label: string;
  value: string;
};

export type DevicePairingDialogProps = {
  activePairingOrigin: string;
  activePairingWebUrl: string;
  isCustomPairingOrigin: boolean;
  isSavedPairingOrigin: boolean;
  pairingHostChoice: string;
  pairingHostOptions: PairingHostOption[];
  pairingLink: AccessLinkResponse;
  pairingLinkOrigin: string;
  onClose: () => void;
  onCopyPairingLink: () => void;
  onManagePairingHosts: () => void;
  onPairingHostChoiceChange: (value: string) => void;
  onPairingLinkOriginChange: (value: string) => void;
};
