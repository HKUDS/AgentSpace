#!/usr/bin/env bash
DEFAULT_SERVER_URL="${DEFAULT_SERVER_URL:-}"
DEFAULT_PACKAGE_URL="${DEFAULT_PACKAGE_URL:-}"
set -euo pipefail

SCRIPT_NAME="$(basename "$0")"

PACKAGE_PATH=""
PACKAGE_URL=""
SERVER_URL="$DEFAULT_SERVER_URL"
DAEMON_TOKEN=""
DAEMON_ID=""
DEVICE_NAME="$(hostname -s 2>/dev/null || hostname || echo remote-daemon)"
RUNTIME_NAME="Remote Agent"
BASE_DIR="${AGENT_SPACE_DAEMON_HOME:-$HOME/.agent-space-daemon}"
STATE_DIR="${AGENT_SPACE_DAEMON_STATE_DIR:-$BASE_DIR}"
INSTALL_ROOT="${AGENT_SPACE_DAEMON_INSTALL_ROOT:-$BASE_DIR/runtime}"
ENV_FILE="${AGENT_SPACE_DAEMON_ENV_FILE:-$BASE_DIR/daemon.env}"
LAUNCHER_PATH="${AGENT_SPACE_DAEMON_LAUNCHER:-$BASE_DIR/start-daemon.sh}"
PROVIDER_PATH="${PATH}"
TMP_PACKAGE_PATH=""
UPDATE_EXISTING="false"
SERVER_URL_SET="false"
DAEMON_TOKEN_SET="false"
DAEMON_ID_SET="false"
DEVICE_NAME_SET="false"
RUNTIME_NAME_SET="false"
STATE_DIR_SET="false"
INSTALL_ROOT_SET="false"
PATH_SET="false"

print_help() {
  cat <<'EOF'
Install and start the standalone AgentSpace remote daemon in user space.

Usage:
  install-remote-daemon.sh --daemon-token adt_xxx

  install-remote-daemon.sh \
    --package /path/to/agent-space-daemon-<version>.tgz \
    --server-url https://agentspace.example \
    --daemon-token adt_xxx \
    --daemon-id daemon-prod-01

  install-remote-daemon.sh \
    --package-url https://artifact.example.com/agent-space-daemon-<version>.tgz \
    --server-url https://agentspace.example \
    --daemon-token adt_xxx \
    --daemon-id daemon-prod-01

Required:
  --daemon-token <token>   required unless --update-existing can read daemon.env

Defaults:
  --server-url <url>       default: baked into install-script when served from Server A
  --daemon-id <id>         default: hostname
  --package-url <url>      default: baked into install-script when served from Server A
  --base-dir <dir>         default: ~/.agent-space-daemon
  --state-dir <dir>        default: <base-dir>
  --install-root <dir>     default: <base-dir>/runtime

Package source:
  One of:
    --package <local-tgz-path>
    --package-url <remote-tgz-url>
  or rely on the default package URL baked into the install script

Optional:
  --device-name <name>     default: hostname
  --runtime-name <label>   default: Remote Agent
  --base-dir <dir>         default: ~/.agent-space-daemon
  --state-dir <dir>        default: ~/.agent-space-daemon
  --install-root <dir>     default: ~/.agent-space-daemon/runtime
  --env-file <path>        default: ~/.agent-space-daemon/daemon.env
  --launcher <path>        default: ~/.agent-space-daemon/start-daemon.sh
  --path <PATH>            PATH captured for codex/claude/agy/gemini/opencode/openclaw/nanobot/hermes lookup
  --update-existing        read existing daemon.env and reuse token/id/device/runtime settings
  --no-start               install files but do not start the daemon
  --help

Notes:
  - Run this script as a user that has access to codex / claude / agy / gemini / opencode / openclaw / nanobot / hermes.
  - Root is supported for server installs, but Claude Code must be logged in for /root and task commands run with root privileges.
  - Google Sheet agent writes require agent-space output and gws. If gws is missing, this installer installs @googleworkspace/cli into the daemon runtime.
  - Codex-based agents may also require a compatible bwrap unless the installed Codex can fall back to its vendored bwrap.
  - For advanced systemd deployment, use deploy/systemd manually.
EOF
}

log() {
  printf '[%s] %s\n' "$SCRIPT_NAME" "$*"
}

fail() {
  printf '[%s] ERROR: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

warn() {
  printf '[%s] WARNING: %s\n' "$SCRIPT_NAME" "$*" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Missing required command: $1"
  fi
}

resolve_on_provider_path() {
  local command_name="$1"
  if [[ "$command_name" == */* ]]; then
    if [[ -x "$command_name" ]]; then
      printf '%s\n' "$command_name"
      return 0
    fi
    return 1
  fi
  PATH="$PROVIDER_PATH" command -v "$command_name"
}

run_on_provider_path() {
  local command_name="$1"
  shift
  if [[ "$command_name" == */* ]]; then
    "$command_name" "$@"
    return $?
  fi
  PATH="$PROVIDER_PATH" "$command_name" "$@"
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  value="${value//$'\r'/ }"
  printf '%s' "$value"
}

verify_agent_space_output_cli() {
  local cli_path
  cli_path="$(resolve_on_provider_path agent-space || true)"
  [[ -n "$cli_path" ]] || fail "agent-space CLI was not found on PATH after install. Expected ${INSTALL_ROOT%/}/bin to be present."
  run_on_provider_path agent-space output --help >/dev/null || fail "agent-space output --help failed after install."
  run_on_provider_path agent-space output sheets-result add --help >/dev/null || fail "agent-space output sheets-result add --help failed after install."
  run_on_provider_path agent-space output validate --help >/dev/null || fail "agent-space output validate --help failed after install."
  AGENT_SPACE_OUTPUT_CLI_PATH="$cli_path"
}

verify_gws_cli() {
  GWS_COMMAND="${AGENT_SPACE_GOOGLE_WORKSPACE_EXECUTOR:-gws}"
  local gws_path
  gws_path="$(resolve_on_provider_path "$GWS_COMMAND" || true)"
  if [[ -z "$gws_path" ]]; then
    GWS_AVAILABLE="false"
    GWS_CLI_PATH=""
    GWS_VERSION=""
    GWS_ERROR="gws CLI was not found. Google Workspace features will be unavailable until the Google Workspace CLI is installed and executable."
    warn "$GWS_ERROR"
    return 0
  fi
  if ! GWS_VERSION="$(run_on_provider_path "$GWS_COMMAND" --version 2>&1)"; then
    GWS_AVAILABLE="false"
    GWS_CLI_PATH="$gws_path"
    GWS_ERROR="gws --version failed. Google Workspace features will be unavailable until this is fixed. Output: ${GWS_VERSION:-<no output>}"
    warn "$GWS_ERROR"
    return 0
  fi
  if [[ -z "$GWS_VERSION" ]]; then
    GWS_AVAILABLE="false"
    GWS_CLI_PATH="$gws_path"
    GWS_ERROR="gws --version returned no output. Google Workspace features may be unavailable until this is fixed."
    warn "$GWS_ERROR"
    return 0
  fi
  GWS_AVAILABLE="true"
  GWS_CLI_PATH="$gws_path"
  GWS_ERROR=""
}

install_gws_cli_if_missing() {
  GWS_COMMAND="${AGENT_SPACE_GOOGLE_WORKSPACE_EXECUTOR:-gws}"
  local gws_path
  gws_path="$(resolve_on_provider_path "$GWS_COMMAND" || true)"
  if [[ -n "$gws_path" ]]; then
    return 0
  fi
  if [[ "$GWS_COMMAND" == */* ]]; then
    fail "Configured Google Workspace executor was not found or is not executable: $GWS_COMMAND"
  fi
  if [[ "$GWS_COMMAND" != "gws" ]]; then
    fail "Google Workspace executor '$GWS_COMMAND' was not found on PATH. Set AGENT_SPACE_GOOGLE_WORKSPACE_EXECUTOR to an executable path or use the default 'gws'."
  fi

  log "gws CLI was not found; installing @googleworkspace/cli into $INSTALL_ROOT"
  if ! npm --cache "$NPM_CACHE_DIR" --prefix "$INSTALL_ROOT" install -g @googleworkspace/cli; then
    GWS_AVAILABLE="false"
    GWS_CLI_PATH=""
    GWS_VERSION=""
    GWS_ERROR="Automatic gws install failed. Google Workspace features will be unavailable until @googleworkspace/cli is installed manually or AGENT_SPACE_GOOGLE_WORKSPACE_EXECUTOR points to an executable."
    warn "$GWS_ERROR"
    return 0
  fi
  gws_path="$(resolve_on_provider_path "$GWS_COMMAND" || true)"
  if [[ -z "$gws_path" ]]; then
    GWS_AVAILABLE="false"
    GWS_CLI_PATH=""
    GWS_VERSION=""
    GWS_ERROR="Installed @googleworkspace/cli, but gws was still not found at ${INSTALL_ROOT%/}/bin/gws. Google Workspace features will be unavailable until this is fixed."
    warn "$GWS_ERROR"
    return 0
  fi
}

verify_bwrap_cli() {
  local bwrap_path
  bwrap_path="$(resolve_on_provider_path bwrap || true)"
  BWRAP_AVAILABLE="false"
  BWRAP_SUPPORTS_PERMS="false"
  BWRAP_CLI_PATH="$bwrap_path"
  BWRAP_VERSION=""
  BWRAP_ERROR=""
  if [[ -z "$bwrap_path" ]]; then
    BWRAP_ERROR="bwrap was not found on PATH. Codex-based agents may fail unless Codex can fall back to its vendored bwrap."
    warn "$BWRAP_ERROR"
    return 0
  fi
  if ! BWRAP_VERSION="$(run_on_provider_path bwrap --version 2>&1)"; then
    BWRAP_ERROR="bwrap --version failed. Codex-based agents may fail unless Codex can fall back to its vendored bwrap."
    warn "$BWRAP_ERROR"
    return 0
  fi
  local bwrap_help
  bwrap_help="$(run_on_provider_path bwrap --help 2>&1 || true)"
  if [[ "$bwrap_help" != *"--perms"* ]]; then
    BWRAP_ERROR="Installed bwrap does not support --perms. Codex-based agents may fail unless Codex can fall back to its vendored bwrap; current version output: ${BWRAP_VERSION:-unknown}."
    warn "$BWRAP_ERROR"
    return 0
  fi
  BWRAP_AVAILABLE="true"
  BWRAP_SUPPORTS_PERMS="true"
}

if [[ "${AGENT_SPACE_INSTALLER_TEST_HOOK:-}" == "verify-google-sheets-readiness" ]]; then
  PROVIDER_PATH="${AGENT_SPACE_INSTALLER_TEST_PATH:-$PROVIDER_PATH}"
  verify_agent_space_output_cli
  GWS_AVAILABLE="false"
  GWS_CLI_PATH=""
  GWS_VERSION=""
  GWS_ERROR=""
  verify_gws_cli
  verify_bwrap_cli
  printf 'Google Sheets readiness checks passed.\n'
  exit 0
fi

cleanup() {
  if [[ -n "$TMP_PACKAGE_PATH" && -f "$TMP_PACKAGE_PATH" ]]; then
    rm -f "$TMP_PACKAGE_PATH"
  fi
}

trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package)
      PACKAGE_PATH="${2:-}"
      shift 2
      ;;
    --package-url)
      PACKAGE_URL="${2:-}"
      shift 2
      ;;
    --server-url)
      SERVER_URL="${2:-}"
      SERVER_URL_SET="true"
      shift 2
      ;;
    --daemon-token)
      DAEMON_TOKEN="${2:-}"
      DAEMON_TOKEN_SET="true"
      shift 2
      ;;
    --daemon-id)
      DAEMON_ID="${2:-}"
      DAEMON_ID_SET="true"
      shift 2
      ;;
    --device-name)
      DEVICE_NAME="${2:-}"
      DEVICE_NAME_SET="true"
      shift 2
      ;;
    --runtime-name)
      RUNTIME_NAME="${2:-}"
      RUNTIME_NAME_SET="true"
      shift 2
      ;;
    --base-dir)
      BASE_DIR="${2:-}"
      shift 2
      ;;
    --state-dir)
      STATE_DIR="${2:-}"
      STATE_DIR_SET="true"
      shift 2
      ;;
    --install-root)
      INSTALL_ROOT="${2:-}"
      INSTALL_ROOT_SET="true"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --launcher)
      LAUNCHER_PATH="${2:-}"
      shift 2
      ;;
    --path)
      PROVIDER_PATH="${2:-}"
      PATH_SET="true"
      shift 2
      ;;
    --update-existing)
      UPDATE_EXISTING="true"
      shift
      ;;
    --no-start)
      START_NOW="false"
      shift
      ;;
    --help|-h)
      print_help
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

START_NOW="${START_NOW:-true}"

if [[ "$UPDATE_EXISTING" == "true" ]]; then
  [[ -f "$ENV_FILE" ]] || fail "--update-existing could not find daemon env file: $ENV_FILE"
  # shellcheck disable=SC1090
  source "$ENV_FILE"

  if [[ "$SERVER_URL_SET" != "true" && -n "${AGENT_SPACE_SERVER_URL:-}" ]]; then
    SERVER_URL="$AGENT_SPACE_SERVER_URL"
  fi
  if [[ "$DAEMON_TOKEN_SET" != "true" && -n "${AGENT_SPACE_DAEMON_TOKEN:-}" ]]; then
    DAEMON_TOKEN="$AGENT_SPACE_DAEMON_TOKEN"
  fi
  if [[ "$DAEMON_ID_SET" != "true" && -n "${AGENT_SPACE_DAEMON_ID:-}" ]]; then
    DAEMON_ID="$AGENT_SPACE_DAEMON_ID"
  fi
  if [[ "$DEVICE_NAME_SET" != "true" && -n "${AGENT_SPACE_DEVICE_NAME:-}" ]]; then
    DEVICE_NAME="$AGENT_SPACE_DEVICE_NAME"
  fi
  if [[ "$RUNTIME_NAME_SET" != "true" && -n "${AGENT_SPACE_RUNTIME_NAME:-}" ]]; then
    RUNTIME_NAME="$AGENT_SPACE_RUNTIME_NAME"
  fi
  if [[ "$STATE_DIR_SET" != "true" && -n "${AGENT_SPACE_DAEMON_STATE_DIR:-}" ]]; then
    STATE_DIR="$AGENT_SPACE_DAEMON_STATE_DIR"
  fi
  if [[ "$INSTALL_ROOT_SET" != "true" && -n "${AGENT_SPACE_DAEMON_INSTALL_ROOT:-}" ]]; then
    INSTALL_ROOT="$AGENT_SPACE_DAEMON_INSTALL_ROOT"
  elif [[ "$INSTALL_ROOT_SET" != "true" && -n "${AGENT_SPACE_DAEMON_BIN:-}" ]]; then
    INSTALL_ROOT="$(dirname "$(dirname "$AGENT_SPACE_DAEMON_BIN")")"
  fi
  if [[ "$PATH_SET" != "true" ]]; then
    PROVIDER_PATH="$PATH"
  fi
fi

[[ -n "$DAEMON_TOKEN" ]] || fail "--daemon-token is required"

if [[ -z "$PACKAGE_URL" && -n "$DEFAULT_PACKAGE_URL" ]]; then
  PACKAGE_URL="$DEFAULT_PACKAGE_URL"
fi

[[ -n "$SERVER_URL" ]] || fail "--server-url is required"

if [[ -z "$DAEMON_ID" ]]; then
  DAEMON_ID="$DEVICE_NAME"
fi

if [[ -n "$PACKAGE_PATH" && -n "$PACKAGE_URL" ]]; then
  fail "Use either --package or --package-url, not both"
fi

if [[ -z "$PACKAGE_PATH" && -z "$PACKAGE_URL" ]]; then
  fail "One of --package or --package-url is required"
fi

require_command npm
require_command mktemp
require_command install

if [[ -n "$PACKAGE_URL" ]]; then
  if command -v curl >/dev/null 2>&1; then
    TMP_PACKAGE_PATH="$(mktemp /tmp/agent-space-daemon.XXXXXX.tgz)"
    log "Downloading package from $PACKAGE_URL"
    curl -fsSL -H "Authorization: Bearer $DAEMON_TOKEN" "$PACKAGE_URL" -o "$TMP_PACKAGE_PATH"
    PACKAGE_PATH="$TMP_PACKAGE_PATH"
  elif command -v wget >/dev/null 2>&1; then
    TMP_PACKAGE_PATH="$(mktemp /tmp/agent-space-daemon.XXXXXX.tgz)"
    log "Downloading package from $PACKAGE_URL"
    wget -qO "$TMP_PACKAGE_PATH" --header="Authorization: Bearer $DAEMON_TOKEN" "$PACKAGE_URL"
    PACKAGE_PATH="$TMP_PACKAGE_PATH"
  else
    fail "Neither curl nor wget is available to download --package-url"
  fi
fi

[[ -f "$PACKAGE_PATH" ]] || fail "Package does not exist: $PACKAGE_PATH"

mkdir -p "$BASE_DIR" "$STATE_DIR" "$INSTALL_ROOT" "$(dirname "$ENV_FILE")" "$(dirname "$LAUNCHER_PATH")"

OLD_BIN_PATH="${INSTALL_ROOT%/}/bin/agent-space-daemon"
if [[ -x "$OLD_BIN_PATH" ]]; then
  log "Stopping existing user-space daemon if it is running"
  env PATH="$PROVIDER_PATH" "$OLD_BIN_PATH" stop --state-dir "$STATE_DIR" >/dev/null 2>&1 || true
fi

NPM_CACHE_DIR="${TMPDIR:-/tmp}/agent-space-npm-cache"
mkdir -p "$NPM_CACHE_DIR"

log "Installing standalone daemon package into $INSTALL_ROOT"
npm --cache "$NPM_CACHE_DIR" --prefix "$INSTALL_ROOT" install -g "$PACKAGE_PATH"

BIN_PATH="${INSTALL_ROOT%/}/bin/agent-space-daemon"
[[ -x "$BIN_PATH" ]] || fail "Installed binary not found at $BIN_PATH"
DAEMON_VERSION="$("$BIN_PATH" --version 2>/dev/null || true)"
DAEMON_VERSION="${DAEMON_VERSION//$'\r'/ }"
DAEMON_VERSION="${DAEMON_VERSION//$'\n'/ }"
DAEMON_VERSION="${DAEMON_VERSION:-unknown}"
log "Installed agent-space-daemon version: $DAEMON_VERSION"
AGENT_SPACE_CLI_PATH="${INSTALL_ROOT%/}/bin/agent-space"
[[ -x "$AGENT_SPACE_CLI_PATH" ]] || fail "Installed agent-space CLI not found at $AGENT_SPACE_CLI_PATH"
INSTALL_BIN_DIR="${INSTALL_ROOT%/}/bin"
if [[ ":$PROVIDER_PATH:" != *":$INSTALL_BIN_DIR:"* ]]; then
  PROVIDER_PATH="$INSTALL_BIN_DIR:$PROVIDER_PATH"
fi

log "Checking Google Sheets runtime readiness"
verify_agent_space_output_cli
GWS_AVAILABLE="false"
GWS_CLI_PATH=""
GWS_VERSION=""
GWS_ERROR=""
install_gws_cli_if_missing
verify_gws_cli
verify_bwrap_cli

TMP_ENV_FILE="$(mktemp /tmp/agent-space-daemon-env.XXXXXX)"
cat >"$TMP_ENV_FILE" <<EOF
# Generated by $SCRIPT_NAME
PATH=$(printf '%q' "$PROVIDER_PATH")
AGENT_SPACE_GOOGLE_WORKSPACE_EXECUTOR=$(printf '%q' "$GWS_COMMAND")
AGENT_SPACE_SERVER_URL=$(printf '%q' "$SERVER_URL")
AGENT_SPACE_DAEMON_TOKEN=$(printf '%q' "$DAEMON_TOKEN")
AGENT_SPACE_DAEMON_ID=$(printf '%q' "$DAEMON_ID")
AGENT_SPACE_DEVICE_NAME=$(printf '%q' "$DEVICE_NAME")
AGENT_SPACE_RUNTIME_NAME=$(printf '%q' "$RUNTIME_NAME")
AGENT_SPACE_DAEMON_STATE_DIR=$(printf '%q' "$STATE_DIR")
AGENT_SPACE_DAEMON_INSTALL_ROOT=$(printf '%q' "$INSTALL_ROOT")
AGENT_SPACE_DAEMON_BIN=$(printf '%q' "$BIN_PATH")
EOF
install -D -m 600 "$TMP_ENV_FILE" "$ENV_FILE"
rm -f "$TMP_ENV_FILE"

TMP_LAUNCHER="$(mktemp /tmp/agent-space-daemon-launcher.XXXXXX)"
cat >"$TMP_LAUNCHER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
source "$ENV_FILE"
export PATH
exec "\$AGENT_SPACE_DAEMON_BIN" start \\
  --state-dir "\$AGENT_SPACE_DAEMON_STATE_DIR" \\
  --server-url "\$AGENT_SPACE_SERVER_URL" \\
  --daemon-token "\$AGENT_SPACE_DAEMON_TOKEN" \\
  --daemon-id "\$AGENT_SPACE_DAEMON_ID" \\
  --device-name "\$AGENT_SPACE_DEVICE_NAME" \\
  --runtime-name "\$AGENT_SPACE_RUNTIME_NAME"
EOF
install -D -m 700 "$TMP_LAUNCHER" "$LAUNCHER_PATH"
rm -f "$TMP_LAUNCHER"

if [[ "$START_NOW" == "true" ]]; then
  log "Starting user-space daemon"
  "$LAUNCHER_PATH"
else
  log "Skipping daemon start because --no-start was provided"
fi

STATUS_JSON="$("$BIN_PATH" status --json --state-dir "$STATE_DIR" 2>/dev/null || true)"
READINESS_JSON="{\"agentSpaceOutput\":{\"available\":true,\"path\":\"$(json_escape "$AGENT_SPACE_OUTPUT_CLI_PATH")\"},\"gws\":{\"available\":$GWS_AVAILABLE,\"path\":\"$(json_escape "$GWS_CLI_PATH")\",\"version\":\"$(json_escape "$GWS_VERSION")\",\"error\":\"$(json_escape "$GWS_ERROR")\"},\"bwrap\":{\"available\":$BWRAP_AVAILABLE,\"path\":\"$(json_escape "$BWRAP_CLI_PATH")\",\"version\":\"$(json_escape "$BWRAP_VERSION")\",\"supportsPerms\":$BWRAP_SUPPORTS_PERMS,\"error\":\"$(json_escape "$BWRAP_ERROR")\"},\"executor\":\"$(json_escape "$GWS_COMMAND")\"}"

cat <<EOF

User-space remote daemon bootstrap completed.

Binary:
  $BIN_PATH

Version:
  $DAEMON_VERSION

State dir:
  $STATE_DIR

Env file:
  $ENV_FILE

Launcher:
  $LAUNCHER_PATH

Status:
  ${STATUS_JSON:-<unavailable>}

Readiness:
  $READINESS_JSON

Stop daemon:
  "$BIN_PATH" stop --state-dir "$STATE_DIR"
EOF
