import { useState } from "react";

import type { AccessDeviceSummary } from "@deskcue/protocol";

import { DeviceDetails } from "./components/DeviceDetails";
import { DeviceRenameControl } from "./components/DeviceRenameControl";
import {
  formatAccessDeviceGroupDetail,
  formatAccessDeviceGroupTitle,
  formatCurrentAccessDetail,
  formatCurrentAccessTitle,
  formatDeviceDate,
  formatDeviceTitle,
  formatShortDeviceId,
  groupAccessDevices,
  isHostAccessDeviceGroup
} from "./helpers";
import styles from "./styles.module.scss";
import type { AccessDeviceListProps } from "./types";

export function AccessDeviceList({
  currentAccess,
  devices,
  forgettingCurrentBrowser,
  loading,
  renamingDeviceId,
  resettingOtherTokens,
  revokingDeviceId,
  onForgetCurrentBrowser,
  onRenameDevice,
  onRevokeDevice,
  onRevokeOtherDevices
}: AccessDeviceListProps) {
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [deviceLabelDraft, setDeviceLabelDraft] = useState("");
  const currentDevice = devices.find((device) => device.current && !device.revokedAt) ?? null;
  const currentAccessDetail = currentDevice ? null : formatCurrentAccessDetail(currentAccess);
  const otherDevices = devices.filter((device) => !device.current && !device.revokedAt);
  const otherAccessTokenGroups = groupAccessDevices(otherDevices);
  const visibleGroups = showAllGroups ? otherAccessTokenGroups : otherAccessTokenGroups.slice(0, 4);
  const hiddenGroupCount = Math.max(0, otherAccessTokenGroups.length - visibleGroups.length);
  const hiddenTokenCount = otherAccessTokenGroups
    .slice(visibleGroups.length)
    .reduce((total, group) => total + group.devices.length, 0);
  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((current) =>
      current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey]
    );
  };
  const startRename = (device: AccessDeviceSummary) => {
    setEditingDeviceId(device.id);
    setDeviceLabelDraft(device.label);
  };
  const cancelRename = () => {
    setEditingDeviceId(null);
    setDeviceLabelDraft("");
  };
  const saveRename = async (device: AccessDeviceSummary) => {
    const saved = await onRenameDevice(device, deviceLabelDraft);
    if (saved) {
      cancelRename();
    }
  };

  return (
    <div className={styles.devicePanel}>
      <div>
        <span className={styles.label}>This device</span>
        <strong>
          {loading
            ? "Checking..."
            : currentDevice
              ? formatDeviceTitle(currentDevice)
              : formatCurrentAccessTitle(currentAccess)}
        </strong>
        {!loading && currentAccessDetail ? (
          <small className={styles.currentAccessDetail}>{currentAccessDetail}</small>
        ) : null}
        {currentDevice ? (
          <>
            <DeviceDetails device={currentDevice} />
            <div className={styles.deviceActions}>
              <DeviceRenameControl
                device={currentDevice}
                draft={deviceLabelDraft}
                editing={editingDeviceId === currentDevice.id}
                saving={renamingDeviceId === currentDevice.id}
                onCancel={cancelRename}
                onDraftChange={setDeviceLabelDraft}
                onSave={saveRename}
                onStart={startRename}
              />
              <button
                className={styles.inlineDangerButton}
                disabled={forgettingCurrentBrowser || renamingDeviceId === currentDevice.id}
                onClick={onForgetCurrentBrowser}
                type="button"
              >
                {forgettingCurrentBrowser ? "Forgetting..." : "Forget"}
              </button>
            </div>
          </>
        ) : null}
      </div>
      <div>
        <span className={styles.label}>Other active tokens</span>
        {loading ? (
          <small>Checking...</small>
        ) : visibleGroups.length > 0 ? (
          <ul className={styles.deviceList}>
            {visibleGroups.map((group) => (
              <li key={group.key}>
                <button
                  aria-expanded={expandedGroups.includes(group.key)}
                  className={styles.deviceGroupCard}
                  onClick={() => toggleGroup(group.key)}
                  type="button"
                >
                  <span className={styles.deviceGroupTitle}>
                    {isHostAccessDeviceGroup(group) ? (
                      <span className={styles.deviceGroupRole}>Host</span>
                    ) : null}
                    {isHostAccessDeviceGroup(group) ? " " : ""}
                    {formatAccessDeviceGroupTitle(group)}
                  </span>
                  <small>{formatAccessDeviceGroupDetail(group)}</small>
                  <span className={styles.deviceGroupHint}>
                    {expandedGroups.includes(group.key) ? "Hide tokens" : "Open tokens"}
                    <span className={styles.deviceGroupChevron} aria-hidden="true" />
                  </span>
                </button>
                {expandedGroups.includes(group.key) ? (
                  <ul className={styles.tokenList}>
                    {group.devices.map((device) => (
                      <li key={device.id}>
                        <div className={styles.tokenMain}>
                          <span>{device.label}</span>
                          <small>
                            {formatShortDeviceId(device.id)} · {formatDeviceDate(device.lastSeenAt ?? device.createdAt)}
                          </small>
                        </div>
                        <div className={styles.tokenActions}>
                          <DeviceRenameControl
                            device={device}
                            draft={deviceLabelDraft}
                            editing={editingDeviceId === device.id}
                            saving={renamingDeviceId === device.id}
                            onCancel={cancelRename}
                            onDraftChange={setDeviceLabelDraft}
                            onSave={saveRename}
                            onStart={startRename}
                          />
                          <button
                            className={styles.inlineDangerButton}
                            disabled={revokingDeviceId === device.id || renamingDeviceId === device.id}
                            onClick={() => onRevokeDevice(device)}
                            type="button"
                          >
                            {revokingDeviceId === device.id ? "Revoking..." : "Revoke"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
            {hiddenGroupCount > 0 ? (
              <li className={styles.deviceListFooter}>
                <span>
                  {hiddenTokenCount} older active token{hiddenTokenCount === 1 ? "" : "s"} in {hiddenGroupCount} more group{hiddenGroupCount === 1 ? "" : "s"}
                </span>
                <button
                  className={styles.inlineButton}
                  onClick={() => setShowAllGroups(true)}
                  type="button"
                >
                  Show all groups
                </button>
              </li>
            ) : null}
            {showAllGroups && otherAccessTokenGroups.length > 4 ? (
              <li>
                <button
                  className={styles.inlineButton}
                  onClick={() => setShowAllGroups(false)}
                  type="button"
                >
                  Show fewer groups
                </button>
              </li>
            ) : null}
            <li className={styles.deviceListActions}>
              <span>Revoke every other active token for this DeskCue instance.</span>
              <button
                className={styles.inlineDangerButton}
                disabled={resettingOtherTokens || otherDevices.length === 0}
                onClick={onRevokeOtherDevices}
                type="button"
              >
                {resettingOtherTokens ? "Revoking..." : "Revoke other tokens"}
              </button>
            </li>
          </ul>
        ) : (
          <small>No other active tokens</small>
        )}
      </div>
    </div>
  );
}
