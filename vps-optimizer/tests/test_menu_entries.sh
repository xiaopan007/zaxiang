#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_FILE="$SCRIPT_DIR/vps优化脚本.sh"

grep -q 'echo "3. TG-bot系统监控预警"' "$SCRIPT_FILE"
grep -q '3) refresh_screen; setup_tg_monitoring ;;' "$SCRIPT_FILE"
grep -q 'echo "2. 加入放行端口"' "$SCRIPT_FILE"
grep -q '2) refresh_screen; manage_allow_port ;;' "$SCRIPT_FILE"
grep -q 'prompt_optional_threshold' "$SCRIPT_FILE"
grep -q 'cpu_threshold="$(prompt_optional_threshold "CPU 使用率预警阈值百分比")"' "$SCRIPT_FILE"
grep -q 'if (( $(echo "$THRESHOLD <= 0" | bc -l) )); then' "$SCRIPT_FILE"
grep -q 'NETWORK_THRESHOLD_GB > 0' "$SCRIPT_FILE"
