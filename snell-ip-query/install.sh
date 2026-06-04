#!/bin/sh
set -eu

SCRIPT_URL="https://raw.githubusercontent.com/xiaopan007/zaxiang/main/snell-ip-query/%E6%9C%8D%E5%8A%A1%E5%99%A8%E4%BD%BF%E7%94%A8%E4%BA%BA%E6%95%B0%E6%9F%A5%E8%AF%A2"
SCRIPT_PATH="/root/服务器使用人数查询"

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
