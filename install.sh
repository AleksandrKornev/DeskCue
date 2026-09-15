#!/bin/sh

set -eu

REPOSITORY="AleksandrKornev/DeskCue"
METHOD="standalone"
VERSION=""

usage() {
  printf '%s\n' \
    "Install DeskCue for Linux" \
    "" \
    "Usage: install.sh [--method standalone|deb] [--version <version>]" \
    "" \
    "The default standalone method installs per-user files under ~/.local." \
    "The deb method requires sudo; rerun it with a newer release to update."
}

wait_for_deskcue() {
  CLI_PATH="$1"
  NODE_PATH="$2"
  EXPECTED_VERSION="$3"
  ATTEMPT=0
  CONFIRMATIONS=0

  while [ "$ATTEMPT" -lt 30 ]; do
    if "$CLI_PATH" status --json >"$TEMP_ROOT/status.json" 2>/dev/null &&
       "$NODE_PATH" --input-type=module -e '
         import { readFileSync } from "node:fs";
         const status = JSON.parse(readFileSync(process.argv[1], "utf8")).data?.status;
         if (status?.host?.version !== process.argv[2] || status?.daemon?.version !== process.argv[2]) process.exit(1);
       ' "$TEMP_ROOT/status.json" "$EXPECTED_VERSION" 2>/dev/null; then
      CONFIRMATIONS=$((CONFIRMATIONS + 1))
      if [ "$CONFIRMATIONS" -ge 3 ]; then return 0; fi
    else
      CONFIRMATIONS=0
    fi

    ATTEMPT=$((ATTEMPT + 1))
    sleep 1
  done

  return 1
}

replace_unit_file() (
  source_unit_path="$1"
  target_unit_path="$2"
  target_unit_root="${target_unit_path%/*}"
  temporary_unit_path="$(mktemp "$target_unit_root/.deskcue-host.service.XXXXXX")" || exit 1

  trap 'rm -f -- "$temporary_unit_path"' EXIT HUP INT TERM
  cp -- "$source_unit_path" "$temporary_unit_path"
  chmod 0644 "$temporary_unit_path"
  mv -f -- "$temporary_unit_path" "$target_unit_path"
  trap - EXIT HUP INT TERM
)

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --method)
      [ "$#" -ge 2 ] || { printf '%s\n' "Missing value for --method" >&2; exit 2; }
      METHOD="$2"
      shift 2
      ;;
    --version)
      [ "$#" -ge 2 ] || { printf '%s\n' "Missing value for --version" >&2; exit 2; }
      VERSION="$2"
      shift 2
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[ "$METHOD" = "standalone" ] || [ "$METHOD" = "deb" ] || {
  printf '%s\n' "--method must be standalone or deb" >&2
  exit 2
}

command -v curl >/dev/null 2>&1 || { printf '%s\n' "curl is required" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { printf '%s\n' "sha256sum is required" >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { printf '%s\n' "systemd user services are required" >&2; exit 1; }
if [ "$METHOD" = "standalone" ]; then
  command -v systemd-run >/dev/null 2>&1 || { printf '%s\n' "systemd-run is required" >&2; exit 1; }
fi

case "$(uname -m)" in
  x86_64|amd64) ARCH="x64"; DEB_ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64"; DEB_ARCH="arm64" ;;
  *) printf 'Unsupported architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac

if [ -z "$VERSION" ]; then
  VERSION="$(curl -fsSL "https://github.com/$REPOSITORY/releases/latest/download/release-version.txt")"
fi

case "$VERSION" in
  *[!0-9A-Za-z.-]*|'') printf '%s\n' "Invalid release version" >&2; exit 1 ;;
esac

RELEASE_BASE="${DESKCUE_INSTALLER_RELEASE_BASE:-https://github.com/$REPOSITORY/releases/download/v$VERSION}"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/deskcue-install.XXXXXX")"

cleanup() {
  case "$TEMP_ROOT" in
    "${TMPDIR:-/tmp}"/deskcue-install.*) rm -rf -- "$TEMP_ROOT" ;;
  esac
}

trap cleanup EXIT HUP INT TERM
curl -fsSL "$RELEASE_BASE/SHA256SUMS" -o "$TEMP_ROOT/SHA256SUMS"

if [ "$METHOD" = "deb" ]; then
  ASSET="deskcue_${VERSION}_${DEB_ARCH}.deb"
else
  ASSET="deskcue-${VERSION}-linux-${ARCH}.tar.gz"
fi

curl -fL "$RELEASE_BASE/$ASSET" -o "$TEMP_ROOT/$ASSET"
EXPECTED_LINE="$(grep "  $ASSET\$" "$TEMP_ROOT/SHA256SUMS" || true)"
[ -n "$EXPECTED_LINE" ] || { printf 'No checksum published for %s\n' "$ASSET" >&2; exit 1; }
printf '%s\n' "$EXPECTED_LINE" | (cd "$TEMP_ROOT" && sha256sum --check --status -)

USER_PROGRAM_ROOT="$HOME/.local/lib/deskcue"
USER_CLI_LINK="$HOME/.local/bin/deskcue"
USER_UNIT_PATH="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/deskcue-host.service"

if [ "$METHOD" = "deb" ]; then
  if [ -e "$USER_PROGRAM_ROOT" ] || [ -L "$USER_PROGRAM_ROOT" ] ||
     [ -e "$USER_CLI_LINK" ] || [ -L "$USER_CLI_LINK" ] ||
     [ -e "$USER_UNIT_PATH" ] || [ -L "$USER_UNIT_PATH" ]; then
    printf '%s\n' "Remove the standalone DeskCue installation before installing the Debian package" >&2
    exit 1
  fi
  command -v dpkg >/dev/null 2>&1 || { printf '%s\n' "dpkg is required for --method deb" >&2; exit 1; }
  command -v sudo >/dev/null 2>&1 || { printf '%s\n' "sudo is required for --method deb" >&2; exit 1; }
  HAD_DEB_INSTALL=false
  DEB_WAS_ENABLED=true
  DEB_WAS_ACTIVE=true
  if command -v dpkg-query >/dev/null 2>&1 &&
     dpkg-query -W -f='${Status}' deskcue 2>/dev/null | grep -q 'ok installed'; then
    HAD_DEB_INSTALL=true
    if ! systemctl --user is-enabled --quiet deskcue-host.service 2>/dev/null; then DEB_WAS_ENABLED=false; fi
    if ! systemctl --user is-active --quiet deskcue-host.service 2>/dev/null; then DEB_WAS_ACTIVE=false; fi
  fi
  systemctl --user stop deskcue-host.service 2>/dev/null || true
  if ! sudo dpkg -i "$TEMP_ROOT/$ASSET"; then
    systemctl --user daemon-reload 2>/dev/null || true
    if [ "$HAD_DEB_INSTALL" = "true" ] && [ "$DEB_WAS_ACTIVE" = "true" ]; then
      systemctl --user start deskcue-host.service 2>/dev/null || true
    fi
    exit 1
  fi
  systemctl --user daemon-reload
  if [ "$DEB_WAS_ENABLED" = "true" ]; then
    systemctl --user enable deskcue-host.service
  else
    systemctl --user disable deskcue-host.service
  fi
  systemctl --user start deskcue-host.service
  wait_for_deskcue /usr/bin/deskcue /usr/lib/deskcue/runtime/node "$VERSION" || {
    if [ "$HAD_DEB_INSTALL" = "true" ] && [ "$DEB_WAS_ACTIVE" != "true" ]; then
      systemctl --user stop deskcue-host.service 2>/dev/null || true
    fi
    printf '%s\n' "DeskCue was installed, but its user service did not become healthy" >&2
    exit 1
  }
  if [ "$HAD_DEB_INSTALL" = "true" ] && [ "$DEB_WAS_ACTIVE" != "true" ]; then
    systemctl --user stop deskcue-host.service
  fi
  printf 'DeskCue %s installed from %s\n' "$VERSION" "$ASSET"
  printf '%s\n' "Run: deskcue status"
  exit 0
fi

if command -v dpkg-query >/dev/null 2>&1 &&
   dpkg-query -W -f='${Status}' deskcue 2>/dev/null | grep -q 'ok installed'; then
  printf '%s\n' "Remove the Debian DeskCue package before installing the standalone build" >&2
  exit 1
fi

PROGRAM_PARENT="$HOME/.local/lib"
PROGRAM_ROOT="$USER_PROGRAM_ROOT"
BIN_ROOT="$HOME/.local/bin"
UNIT_ROOT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
CLI_LINK="$USER_CLI_LINK"
UNIT_PATH="$USER_UNIT_PATH"
EXTRACT_ROOT="$TEMP_ROOT/extracted"
BACKUP_ROOT="$PROGRAM_PARENT/.deskcue-install-backup"

mkdir -p -- "$PROGRAM_PARENT" "$BIN_ROOT" "$UNIT_ROOT" "$EXTRACT_ROOT"
tar -xzf "$TEMP_ROOT/$ASSET" --directory "$EXTRACT_ROOT" --strip-components=1

"$EXTRACT_ROOT/runtime/node" --input-type=module -e '
  import { readFileSync } from "node:fs";
  const [manifestPath, version, architecture] = process.argv.slice(1);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.packageId !== "io.deskcue.app" ||
      manifest.platform !== "linux" ||
      manifest.appVersion !== version || manifest.architecture !== architecture) process.exit(1);
' "$EXTRACT_ROOT/payload-manifest.json" "$VERSION" "$ARCH"

HAD_EXISTING_INSTALL=false
PREVIOUS_VERSION=""
WAS_ENABLED=true
WAS_ACTIVE=true
if [ -e "$PROGRAM_ROOT" ] || [ -L "$PROGRAM_ROOT" ]; then
  if [ ! -d "$PROGRAM_ROOT" ] || [ -L "$PROGRAM_ROOT" ] ||
     [ ! -f "$PROGRAM_ROOT/payload-manifest.json" ] || [ -L "$PROGRAM_ROOT/payload-manifest.json" ] ||
     [ ! -f "$PROGRAM_ROOT/installation-owner.json" ] || [ -L "$PROGRAM_ROOT/installation-owner.json" ] ||
     [ ! -f "$PROGRAM_ROOT/bin/deskcue" ] || [ -L "$PROGRAM_ROOT/bin/deskcue" ] ||
     [ ! -f "$PROGRAM_ROOT/systemd/deskcue-host.service" ] ||
     [ -L "$PROGRAM_ROOT/systemd/deskcue-host.service" ] ||
     ! cmp -s "$PROGRAM_ROOT/installation-owner.json" "$EXTRACT_ROOT/installation-owner.json"; then
    printf 'Refusing to replace an unrecognized directory: %s\n' "$PROGRAM_ROOT" >&2
    exit 1
  fi

  PREVIOUS_VERSION="$("$EXTRACT_ROOT/runtime/node" --input-type=module -e '
    import { readFileSync } from "node:fs";
    const manifest = JSON.parse(readFileSync(process.argv[1], "utf8"));
    if (manifest.schemaVersion !== 1 || manifest.packageId !== "io.deskcue.app" ||
        manifest.platform !== "linux" || !Array.isArray(manifest.files) || manifest.files.length === 0 ||
        !manifest.files.some(({ path }) => path === "bin/deskcue") ||
        !manifest.files.some(({ path }) => path === "systemd/deskcue-host.service") ||
        !manifest.files.some(({ path }) => path === "installation-owner.json")) process.exit(1);
    process.stdout.write(manifest.appVersion);
  ' "$PROGRAM_ROOT/payload-manifest.json")" || {
    printf 'Refusing to replace an unrecognized directory: %s\n' "$PROGRAM_ROOT" >&2
    exit 1
  }
  HAD_EXISTING_INSTALL=true
  if ! systemctl --user is-enabled --quiet deskcue-host.service 2>/dev/null; then WAS_ENABLED=false; fi
  if ! systemctl --user is-active --quiet deskcue-host.service 2>/dev/null; then WAS_ACTIVE=false; fi
fi

if [ -e "$CLI_LINK" ] || [ -L "$CLI_LINK" ]; then
  if [ "$HAD_EXISTING_INSTALL" != "true" ] ||
     [ ! -L "$CLI_LINK" ] ||
     [ "$(readlink "$CLI_LINK")" != "$PROGRAM_ROOT/bin/deskcue" ]; then
    printf 'Refusing to replace an unrecognized CLI path: %s\n' "$CLI_LINK" >&2
    exit 1
  fi
fi
if [ -e "$UNIT_PATH" ] || [ -L "$UNIT_PATH" ]; then
  if [ "$HAD_EXISTING_INSTALL" != "true" ] ||
     [ -L "$UNIT_PATH" ] ||
     ! cmp -s "$PROGRAM_ROOT/systemd/deskcue-host.service" "$UNIT_PATH"; then
    printf 'Refusing to replace an unrecognized user service: %s\n' "$UNIT_PATH" >&2
    exit 1
  fi
fi
if [ -e "$BACKUP_ROOT" ]; then
  printf 'Remove or recover the previous DeskCue backup first: %s\n' "$BACKUP_ROOT" >&2
  exit 1
fi

systemctl --user stop deskcue-host.service 2>/dev/null || true
if [ -e "$PROGRAM_ROOT" ]; then mv -- "$PROGRAM_ROOT" "$BACKUP_ROOT"; fi

if ! mv -- "$EXTRACT_ROOT" "$PROGRAM_ROOT"; then
  if [ -e "$BACKUP_ROOT" ]; then mv -- "$BACKUP_ROOT" "$PROGRAM_ROOT"; fi
  systemctl --user restart deskcue-host.service 2>/dev/null || true
  exit 1
fi

if ! ln -sfn -- "$PROGRAM_ROOT/bin/deskcue" "$CLI_LINK" ||
   ! replace_unit_file "$PROGRAM_ROOT/systemd/deskcue-host.service" "$UNIT_PATH" ||
   ! systemctl --user daemon-reload; then
  INSTALLATION_FAILED=true
elif [ "$WAS_ENABLED" = "true" ]; then
  if ! systemctl --user enable deskcue-host.service; then INSTALLATION_FAILED=true; else INSTALLATION_FAILED=false; fi
else
  if ! systemctl --user disable deskcue-host.service; then INSTALLATION_FAILED=true; else INSTALLATION_FAILED=false; fi
fi
if [ "${INSTALLATION_FAILED:-false}" != "true" ]; then
  if ! systemctl --user start deskcue-host.service ||
     ! wait_for_deskcue "$CLI_LINK" "$PROGRAM_ROOT/runtime/node" "$VERSION"; then
    INSTALLATION_FAILED=true
  fi
fi
if [ "${INSTALLATION_FAILED:-false}" != "true" ] && [ "$WAS_ACTIVE" != "true" ]; then
  if ! systemctl --user stop deskcue-host.service; then INSTALLATION_FAILED=true; fi
fi
if [ "${INSTALLATION_FAILED:-false}" = "true" ]; then
  systemctl --user stop deskcue-host.service 2>/dev/null || true
  systemctl --user disable deskcue-host.service 2>/dev/null || true
  rm -rf -- "$PROGRAM_ROOT"

  if [ "$HAD_EXISTING_INSTALL" = "true" ] && [ -e "$BACKUP_ROOT" ]; then
    mv -- "$BACKUP_ROOT" "$PROGRAM_ROOT"
    ln -sfn -- "$PROGRAM_ROOT/bin/deskcue" "$CLI_LINK"
    replace_unit_file "$PROGRAM_ROOT/systemd/deskcue-host.service" "$UNIT_PATH"
    systemctl --user daemon-reload
    if [ "$WAS_ENABLED" = "true" ]; then
      systemctl --user enable deskcue-host.service 2>/dev/null || true
    else
      systemctl --user disable deskcue-host.service 2>/dev/null || true
    fi
    if systemctl --user start deskcue-host.service 2>/dev/null &&
       wait_for_deskcue "$CLI_LINK" "$PROGRAM_ROOT/runtime/node" "$PREVIOUS_VERSION"; then
      if [ "$WAS_ACTIVE" != "true" ]; then systemctl --user stop deskcue-host.service 2>/dev/null || true; fi
    else
      printf '%s\n' "The previous DeskCue version was restored but did not become healthy" >&2
    fi
  else
    rm -f -- "$CLI_LINK" "$UNIT_PATH"
    systemctl --user daemon-reload 2>/dev/null || true
  fi

  if [ "$HAD_EXISTING_INSTALL" = "true" ]; then
    printf '%s\n' "DeskCue installation failed and the previous version was restored" >&2
  else
    printf '%s\n' "DeskCue installation failed and the incomplete installation was removed" >&2
  fi
  printf '%s\n' "Inspect logs: journalctl --user -u deskcue-host.service -n 50 --no-pager" >&2
  exit 1
fi

if [ -e "$BACKUP_ROOT" ]; then rm -rf -- "$BACKUP_ROOT"; fi
printf 'DeskCue %s installed for the current user\n' "$VERSION"
printf 'CLI: %s\n' "$CLI_LINK"
case ":$PATH:" in
  *":$BIN_ROOT:"*) printf '%s\n' "Run: deskcue status" ;;
  *)
    printf 'Run: %s status\n' "$CLI_LINK"
    printf 'To use deskcue by name: export PATH="%s:$PATH"\n' "$BIN_ROOT"
    ;;
esac
