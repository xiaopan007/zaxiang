#!/bin/sh
set -eu

SCRIPT_URL="https://github.com/xiaopan007/zaxiang/raw/refs/heads/main/vps-optimizer/vps%E4%BC%98%E5%8C%96%E8%84%9A%E6%9C%AC.sh"
SCRIPT_PATH="/root/vps优化脚本.sh"

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 用户运行，或用 sudo 执行。"
  exit 1
fi

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$SCRIPT_URL" -o "$SCRIPT_PATH"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$SCRIPT_PATH" "$SCRIPT_URL"
else
  echo "未找到 curl 或 wget，无法下载脚本。"
  exit 1
fi

chmod +x "$SCRIPT_PATH"
exec "$SCRIPT_PATH"
