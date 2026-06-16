#! /bin/bash

# "One button" deploy script to roll out new version
# Pull the new repo from Github
# Request credentials to read from private repo

# To run this script:
#   ssh deploy@...
#   cd /src/Cutie-network-
#   sudo bash deploy.sh

# add NVM so that yarn can find node (oh the tangled we we weave...)
# export NVM_DIR="$HOME/.nvm"
# [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm

# ensure that failures get handled/logged
if [ -z "${BASH_VERSION:-}" ]; then
	exec /bin/bash "$0" "$@"
fi

set -euo pipefail

# Ensure logs directory exists and trim to ten newest files before writing
logs_dir="logs"
mkdir -p "$logs_dir"

cleanup_old_logs() {
	local old_logs
  # find old log files
	# shellcheck disable=SC2012 # using ls -t for simple time-sorted pruning
	old_logs=$(ls -1t "$logs_dir" 2>/dev/null | tail -n +11)
	if [ -z "$old_logs" ]; then
		return
	fi
  # prune them
	printf '%s\n' "$old_logs" | while IFS= read -r log_name; do
		[ -n "$log_name" ] && rm -f "$logs_dir/$log_name"
	done
}

cleanup_old_logs

# Create timestamp in format yyyy-mm-dd-hh-mm-ss
timestamp=$(date +"%Y-%m-%d-%H-%M-%S")
# Log file name - save all the log files into the "logs" directory
logfile="$logs_dir/cutie-$timestamp.txt"

log_and_run() {
	local description=$1
	shift
	printf '\n==> %s\n' "$description" | tee -a "$logfile"
	"$@" 2>&1 | tee -a "$logfile"
}

find_existing_preview_pids() {
	local port=$1
	if command -v lsof >/dev/null 2>&1; then
		lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true
	elif command -v pgrep >/dev/null 2>&1; then
		pgrep -f "npm run preview" 2>/dev/null || true
	else
		printf ''
	fi
}

ensure_no_existing_preview() {
	local port=$1
	local existing_pids prompt_response
	existing_pids=$(find_existing_preview_pids "$port")
	if [ -z "$existing_pids" ]; then
		return
	fi

	echo "Detected Cutie preview already running on port $port (PID(s): $existing_pids)" | tee -a "$logfile"
	if ! read -r -p "Kill existing process(es) and continue? [y/N] " prompt_response; then
		prompt_response="n"
	fi

	case "$prompt_response" in
		[yY]|[yY][eE][sS])
			for pid in $existing_pids; do
				if kill "$pid" 2>/dev/null; then
					echo "Killed process $pid" | tee -a "$logfile"
				else
					echo "Failed to kill process $pid" | tee -a "$logfile"
				fi
			done
			;;
		*)
			echo "Aborting deploy; stop the existing instance and re-run." | tee -a "$logfile"
			exit 1
			;;
	esac
}

# Branch to deploy (default: main)
branch="${1:-main}"

# Check out the requested branch and pull latest
log_and_run "git checkout $branch" git checkout "$branch"
log_and_run "git pull origin $branch" git pull origin "$branch"

# pull in all the dependencies
log_and_run "npm install" npm install

# clean install:  use package-lock.json as reference to replace node_modules
log_and_run "npm ci" npm ci

# build the app
log_and_run "npm run build" npm run "build"

# get this host's IP address & and desired test port
detect_host_ip() {
	local candidate
	if command -v ip >/dev/null 2>&1; then
		candidate=$(
			ip -4 route get 1.1.1.1 2>/dev/null |
				awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }'
		)
		if [ -n "$candidate" ] && [ "$candidate" != "0.0.0.0" ] && [ "$candidate" != "0000" ]; then
			echo "$candidate"
			return
		fi
		candidate=$(
			ip -4 addr show scope global 2>/dev/null |
				awk '/inet / { sub(/\/.*/, "", $2); print $2; exit }'
		)
		if [ -n "$candidate" ]; then
			echo "$candidate"
			return
		fi
	elif command -v ipconfig >/dev/null 2>&1; then
		local default_iface
		default_iface=$(route -n get default 2>/dev/null | awk '/interface: /{ print $2; exit }')
		if [ -n "$default_iface" ]; then
			ipconfig getifaddr "$default_iface" 2>/dev/null
		fi
	fi
}

ip_address=l"ocalhost"
# if [ -z "$ip_address" ]; then
# 	echo "Warning: Could not determine host IP; defaulting to 127.0.0.1" | tee -a "$logfile"
# 	ip_address="127.0.0.1"
# fi

ip_port=4173

ensure_no_existing_preview "$ip_port"

nohup env LOG_LEVEL=2 npm run "preview" -- --host "$ip_address" --port "$ip_port" >> "$logfile" 2>&1 &

echo "All set! Check at http://$ip_address:$ip_port" | tee -a "$logfile"
