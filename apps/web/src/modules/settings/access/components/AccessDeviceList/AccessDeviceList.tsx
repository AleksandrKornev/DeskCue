import { useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { AccessDeviceSummary } from "@deskcue/protocol";
import { scheduleSettingsFocusVisibility } from "@modules/settings/focusVisibility";

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

const SETTINGS_ACTION_BAR_SELECTOR = "[data-settings-action-bar]";
const SETTINGS_TABLIST_SELECTOR = "[role=\"tablist\"]";

function toggleExpandedDeviceGroup(
  groupKey: string,
  setExpandedGroups: Dispatch<SetStateAction<string[]>>
) {
  setExpandedGroups((current) =>
    current.includes(groupKey)
      ? current.filter((key) => key !== groupKey)
      : [...current, groupKey]
  );
}

function startDeviceRename(
  device: AccessDeviceSummary,
  setEditingDeviceId: Dispatch<SetStateAction<string | null>>,
  setDeviceLabelDraft: Dispatch<SetStateAction<string>>
) {
  setEditingDeviceId(device.id);
  setDeviceLabelDraft(device.label);
}

function cancelDeviceRename(
  setEditingDeviceId: Dispatch<SetStateAction<string | null>>,
  setDeviceLabelDraft: Dispatch<SetStateAction<string>>
) {
  setEditingDeviceId(null);
  setDeviceLabelDraft("");
}

async function saveDeviceRename(
  device: AccessDeviceSummary,
  deviceLabelDraft: string,
  onRenameDevice: AccessDeviceListProps["onRenameDevice"],
  setEditingDeviceId: Dispatch<SetStateAction<string | null>>,
  setDeviceLabelDraft: Dispatch<SetStateAction<string>>
) {
  const saved = await onRenameDevice(device, deviceLabelDraft);

  if (saved) cancelDeviceRename(setEditingDeviceId, setDeviceLabelDraft);
}

function findLastDeviceGroupFocusTarget(
  deviceList: ParentNode | null,
  fallback: HTMLElement | null
) {
  const groupTargets = deviceList?.querySelectorAll<HTMLElement>(
    "[data-access-device-group]"
  );

  return groupTargets?.[groupTargets.length - 1] ?? fallback;
}

export function AccessDeviceList({
  connectionRevision,
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
  const deviceListLabelRef = useRef<HTMLSpanElement>(null);
  const deviceListRef = useRef<HTMLUListElement>(null);
  const groupVisibilityButtonRef = useRef<HTMLButtonElement>(null);
  const groupVisibilityHadFocusRef = useRef(false);
  const currentDevice = devices.find((device) => device.current && !device.revokedAt) ?? null;
  const currentAccessDetail = currentDevice ? null : formatCurrentAccessDetail(currentAccess);
  const otherDevices = devices.filter((device) => !device.current && !device.revokedAt);
  const otherAccessTokenGroups = groupAccessDevices(otherDevices);
  const visibleGroups = showAllGroups ? otherAccessTokenGroups : otherAccessTokenGroups.slice(0, 4);
  const hasGroupVisibilityToggle = otherAccessTokenGroups.length > 4;
  const deviceLayoutKey = JSON.stringify([currentAccess, devices]);
  const hiddenGroupCount = Math.max(0, otherAccessTokenGroups.length - visibleGroups.length);
  const hiddenTokenCount = otherAccessTokenGroups
    .slice(visibleGroups.length)
    .reduce((total, group) => total + group.devices.length, 0);

  useLayoutEffect(() => {
    setExpandedGroups([]);
    setShowAllGroups(false);
    cancelDeviceRename(setEditingDeviceId, setDeviceLabelDraft);
  }, [connectionRevision]);

  useLayoutEffect(() => {
    if (!hasGroupVisibilityToggle) {
      if (showAllGroups) setShowAllGroups(false);
      if (!groupVisibilityHadFocusRef.current) return;

      findLastDeviceGroupFocusTarget(
        deviceListRef.current,
        deviceListLabelRef.current
      )?.focus();
      groupVisibilityHadFocusRef.current = false;
      return;
    }

    const target = groupVisibilityButtonRef.current;
    const page = target?.closest<HTMLElement>("main");

    if (!target || !page || document.activeElement !== target) return;

    scheduleSettingsFocusVisibility({
      actionBarSelector: SETTINGS_ACTION_BAR_SELECTOR,
      page,
      stickyNavigationSelector: SETTINGS_TABLIST_SELECTOR,
      target
    });
  }, [deviceLayoutKey, hasGroupVisibilityToggle, loading, showAllGroups]);

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
                disabled={renamingDeviceId !== null}
                draft={deviceLabelDraft}
                editing={editingDeviceId === currentDevice.id}
                saving={renamingDeviceId === currentDevice.id}
                onCancel={() => cancelDeviceRename(setEditingDeviceId, setDeviceLabelDraft)}
                onDraftChange={setDeviceLabelDraft}
                onSave={(device) => saveDeviceRename(
                  device,
                  deviceLabelDraft,
                  onRenameDevice,
                  setEditingDeviceId,
                  setDeviceLabelDraft
                )}
                onStart={(device) => startDeviceRename(
                  device,
                  setEditingDeviceId,
                  setDeviceLabelDraft
                )}
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
        <span
          className={styles.label}
          data-access-device-list-focus-fallback=""
          ref={deviceListLabelRef}
          tabIndex={-1}
        >
          Other active tokens
        </span>
        {loading && visibleGroups.length > 0 ? (
          <small role="status">Refreshing active tokens...</small>
        ) : null}
        {loading && visibleGroups.length === 0 ? (
          <small>Checking...</small>
        ) : visibleGroups.length > 0 ? (
          <ul className={styles.deviceList} ref={deviceListRef}>
            {visibleGroups.map((group) => (
              <li key={group.key}>
                <button
                  aria-expanded={expandedGroups.includes(group.key)}
                  className={styles.deviceGroupCard}
                  data-access-device-group=""
                  onClick={() => toggleExpandedDeviceGroup(group.key, setExpandedGroups)}
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
                            disabled={renamingDeviceId !== null}
                            draft={deviceLabelDraft}
                            editing={editingDeviceId === device.id}
                            saving={renamingDeviceId === device.id}
                            onCancel={() => cancelDeviceRename(
                              setEditingDeviceId,
                              setDeviceLabelDraft
                            )}
                            onDraftChange={setDeviceLabelDraft}
                            onSave={(renamedDevice) => saveDeviceRename(
                              renamedDevice,
                              deviceLabelDraft,
                              onRenameDevice,
                              setEditingDeviceId,
                              setDeviceLabelDraft
                            )}
                            onStart={(renamedDevice) => startDeviceRename(
                              renamedDevice,
                              setEditingDeviceId,
                              setDeviceLabelDraft
                            )}
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
            {hasGroupVisibilityToggle ? (
              <li className={styles.deviceListFooter} key="group-visibility-toggle">
                <span>
                  {showAllGroups
                    ? `All ${otherAccessTokenGroups.length} active token groups shown`
                    : `${hiddenTokenCount} older active token${hiddenTokenCount === 1 ? "" : "s"} in ${hiddenGroupCount} more group${hiddenGroupCount === 1 ? "" : "s"}`}
                </span>
                <button
                  aria-expanded={showAllGroups}
                  className={styles.inlineButton}
                  onBlur={() => {
                    groupVisibilityHadFocusRef.current = false;
                  }}
                  onClick={() => setShowAllGroups((current) => !current)}
                  onFocus={() => {
                    groupVisibilityHadFocusRef.current = true;
                  }}
                  ref={groupVisibilityButtonRef}
                  type="button"
                >
                  {showAllGroups ? "Show fewer groups" : "Show all groups"}
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
