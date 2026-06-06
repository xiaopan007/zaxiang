#!/usr/bin/env bash
# VPS 一键优化脚本（Ubuntu/Debian，systemd）
# 功能：
# 0) 将系统更新到最新（非交互，保留现有配置），并清理无用包
# 1) 设置系统时区为 Asia/Shanghai
# 2) 配置并启用 2G 交换分区（若已存在则跳过），设置 vm.swappiness=10 以减少换页
# 3) 限制 systemd-journald 日志占用（持久 <=200M，运行时 <=100M），并清理旧日志
# 4) 检测并启用 BBR + fq（若内核支持；已启用则跳过；失败不影响其它步骤）
# 5) 防火墙管理独立菜单：UFW、防全部 UDP 入站、Fail2Ban SSH 防护、端口放行/删除
# 6) 优化结束时如检测到需要重启，进行交互式确认（y 立即重启 / n 跳过），并给出 SSH 断连的安全提示

set -Eeuo pipefail
exec 2>&1  # 将 stderr 合并到 stdout，确保终端按顺序显示全部输出

FINISH_ENABLED=false
SHORTCUT_NAME="v"
SHORTCUT_PATH="/usr/local/bin/v"
SELF_UPDATE_URL="https://api.github.com/repos/xiaopan007/zaxiang/contents/vps-optimizer/vps%E4%BC%98%E5%8C%96%E8%84%9A%E6%9C%AC.sh?ref=main"

finish() {
  local ec=$?
  if [[ "${FINISH_ENABLED:-false}" != true ]]; then
    exit $ec
  fi
  if [[ $ec -eq 0 ]]; then
    echo -e "\n[OK] 全部完成。"
    # 交互式重启：仅当系统标记需要重启时询问
    if [[ -f /var/run/reboot-required ]]; then
      echo "[INFO] 检测到系统更新需要重启生效（可能包含内核/关键库）。"
      # 如果是交互式终端，询问用户；否则仅提示
      if [[ -t 0 ]]; then
        cat <<'SAFETY'
[SAFETY] 现在重启会立刻断开当前 SSH 会话。
SAFETY
        read -r -p "是否现在重启？[y/N]: " _ans
        case "${_ans,,}" in
          y|yes)
            echo "[INFO] 将在 5 秒后重启系统..."
            sleep 5
            # 避免触发 finish 的重复输出
            trap - EXIT
            reboot
            ;;
          *)
            echo "[INFO] 已跳过自动重启。需要时请手动执行：reboot"
            ;;
        esac
      else
        echo "[INFO] 非交互环境，已跳过自动重启。需要时请手动执行：reboot"
      fi
    fi
  else
    echo -e "\n[ERROR] 发生错误（退出码=$ec）。请查看上面的输出。"
  fi
  exit $ec
}
trap finish EXIT

require_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    echo "本脚本需 root 运行。" >&2
    exit 1
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令：$1" >&2
    exit 1
  }
}

refresh_screen() {
  if [[ -t 1 && -n "${TERM:-}" ]] && command -v clear >/dev/null 2>&1; then
    clear || true
  else
    echo
  fi
}

finish_menu_action() {
  sleep 1
  refresh_screen
}

shell_quote() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\"'\"'/g")"
}

install_shortcut_command() {
  local script_path
  script_path="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
  local wrapper
  wrapper="#!/bin/sh
exec $(shell_quote "$script_path") \"\$@\"
"

  if [[ -f "$SHORTCUT_PATH" ]]; then
    local existing
    existing="$(cat "$SHORTCUT_PATH" 2>/dev/null || true)"
    if [[ "$existing" == "$wrapper" && -x "$SHORTCUT_PATH" ]]; then
      return 0
    fi
    if ! grep -q "vps优化脚本.sh" "$SHORTCUT_PATH" 2>/dev/null && ! grep -q "$script_path" "$SHORTCUT_PATH" 2>/dev/null; then
      return 0
    fi
  fi

  printf "%s" "$wrapper" >"$SHORTCUT_PATH"
  chmod +x "$SHORTCUT_PATH"
}

self_update() {
  local script_path temp_path update_url
  script_path="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
  temp_path="${script_path}.new"
  if [[ "$SELF_UPDATE_URL" == *\?* ]]; then
    update_url="${SELF_UPDATE_URL}&t=$(date +%s)"
  else
    update_url="${SELF_UPDATE_URL}?t=$(date +%s)"
  fi

  if command -v curl >/dev/null 2>&1; then
    if ! curl -fsSL -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" "$update_url" -o "$temp_path"; then
      rm -f "$temp_path"
      echo "更新失败：无法下载最新版脚本。请根据上方错误信息检查网络、DNS、代理或 GitHub 访问。"
      return 1
    fi
  elif command -v wget >/dev/null 2>&1; then
    if ! wget --header="Accept: application/vnd.github.raw" --header="Cache-Control: no-cache" -O "$temp_path" "$update_url"; then
      rm -f "$temp_path"
      echo "更新失败：无法下载最新版脚本。请根据上方错误信息检查网络、DNS、代理或 GitHub 访问。"
      return 1
    fi
  else
    echo "更新失败：未找到 curl 或 wget。"
    return 1
  fi

  if cmp -s "$temp_path" "$script_path"; then
    rm -f "$temp_path"
    echo "当前已是最新版本，无需更新。"
    return 0
  fi

  chmod +x "$temp_path"
  mv "$temp_path" "$script_path"
  echo "更新完成，正在重新启动脚本..."
  exec "$script_path"
}

detect_pkg_mgr() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "apt"
  else
    echo "暂不支持的包管理器（需要 apt/apt-get）。" >&2
    exit 1
  fi
}

ensure_systemd() {
  if ! pidof systemd >/dev/null 2>&1; then
    echo "未检测到 systemd，本脚本依赖 systemd-journald / systemctl。" >&2
    exit 1
  fi
}

# -----------------------------
# 0) 系统更新（非交互）
# -----------------------------
system_update() {
  echo "更新系统软件包到最新（非交互）..."
  export DEBIAN_FRONTEND=noninteractive
  require_cmd apt-get

  apt-get update
  # 保留已有配置文件（--force-confdef --force-confold），避免交互阻塞
  apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold dist-upgrade
  # 清理
  apt-get -y autoremove
  apt-get -y autoclean
}

# -----------------------------
# 1) 时区
# -----------------------------
set_timezone_shanghai() {
  echo "设置系统时区为 Asia/Shanghai..."
  if command -v timedatectl >/dev/null 2>&1; then
    timedatectl set-timezone Asia/Shanghai
  fi

  ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
  echo "Asia/Shanghai" >/etc/timezone

  local timezone
  timezone=$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || true)
  if [[ "$timezone" != "Asia/Shanghai" ]]; then
    echo "警告：时区校验异常，当前识别为：${timezone:-未知}"
  fi
  date
}

# -----------------------------
# 2) 交换分区（swap）
# -----------------------------
setup_swap() {
  # 说明：优先使用 fallocate；若不支持则回退 dd。仅当系统没有任何 swap 时创建。
  local active_swaps
  active_swaps=$(swapon --show --noheadings 2>/dev/null | awk '{print $1}' || true)
  local swapfile_active=false

  if grep -qxF "/swapfile" <<<"$active_swaps"; then
    echo "检测到 /swapfile 已启用，跳过创建。"
    swapfile_active=true
  elif [[ -n "$active_swaps" ]]; then
    echo "检测到已有 swap："
    echo "$active_swaps"
    echo "跳过创建新的 /swapfile。"
  elif [[ -e /swapfile ]]; then
    echo "/swapfile 文件存在但未启用，尝试启用..."
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    swapfile_active=true
  else
    echo "创建 2G 交换分区..."
    if ! fallocate -l 2G /swapfile 2>/dev/null; then
      dd if=/dev/zero of=/swapfile bs=1M count=2048 status=progress
    fi
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    swapfile_active=true
  fi

  # /etc/fstab 持久化：仅在使用 /swapfile 时写入。
  if [[ "$swapfile_active" == true ]] && ! grep -qE '^\s*/swapfile\s+' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi

  # 设置 swappiness：降低内存换页倾向（10 为常用温和值）
  echo "vm.swappiness=10" > /etc/sysctl.d/99-swap.conf
  sysctl -w vm.swappiness=10
  sysctl -p /etc/sysctl.d/99-swap.conf >/dev/null
}

# -----------------------------
# 3) 限制 journald 日志占用
# -----------------------------
tune_journald() {
  # 说明：SystemMaxUse 限制持久化日志上限；RuntimeMaxUse 限制内存中日志上限
  mkdir -p /etc/systemd/journald.conf.d
  cat >/etc/systemd/journald.conf.d/size.conf <<'CONF'
[Journal]
SystemMaxUse=200M
RuntimeMaxUse=100M
CONF
  systemctl restart systemd-journald

  # 清理归档日志至 200M 左右（不会截断当前活动日志）
  journalctl --vacuum-size=200M
}

# -----------------------------
# 4) 检测并启用 BBR + fq
# -----------------------------
enable_bbr_fq() {
  echo "检测并启用 BBR + fq..."
  local CONF="/etc/sysctl.d/90-bbr-fq.conf"

  # 尝试加载内核模块（若内建则不会有可加载模块，忽略失败即可）
  if command -v modprobe >/dev/null 2>&1; then
    modprobe tcp_bbr 2>/dev/null || true
    modprobe sch_fq  2>/dev/null || true
  fi

  # 检查内核是否提供 BBR（内核 >= 4.9 通常提供；容器/特殊虚拟化可能不支持）
  local avail_cc
  avail_cc=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || echo "")
  if [[ "$avail_cc" != *bbr* ]]; then
    echo "警告：未检测到 BBR 支持（tcp_available_congestion_control: '$avail_cc'）。跳过启用 BBR。"
    return 0
  fi

  local cur_cc cur_qdisc
  cur_cc=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo "")
  cur_qdisc=$(sysctl -n net.core.default_qdisc 2>/dev/null || echo "")

  if [[ "$cur_cc" == "bbr" && "$cur_qdisc" == "fq" ]]; then
    echo "已启用：tcp_congestion_control=bbr，default_qdisc=fq。"
    return 0
  fi

  # 写入持久化配置并即时加载
  cat >"$CONF" <<'SYS'
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
SYS

  if ! sysctl -p "$CONF"; then
    echo "警告：加载 $CONF 失败。将继续执行其它优化步骤。"
    return 0
  fi

  # 验证最终状态（若不成功，多为宿主限制或老旧内核）
  cur_cc=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo "")
  cur_qdisc=$(sysctl -n net.core.default_qdisc 2>/dev/null || echo "")
  if [[ "$cur_cc" == "bbr" && "$cur_qdisc" == "fq" ]]; then
    echo "BBR+fq 已启用并持久化（$CONF）。"
  else
    echo "警告：尝试启用后状态为 cc='$cur_cc' qdisc='$cur_qdisc'，可能是内核/宿主限制。"
  fi
}

detect_ssh_ports() {
  local -a SSH_PORTS=()
  mapfile -t SSH_PORTS < <( (sshd -T 2>/dev/null | awk '/^port /{print $2}' | sort -n | uniq) || true )
  if [[ ${#SSH_PORTS[@]} -eq 0 ]]; then
    mapfile -t SSH_PORTS < <(
      { grep -iE '^\s*Port\s+' /etc/ssh/sshd_config 2>/dev/null || true; \
        grep -h -iE '^\s*Port\s+' /etc/ssh/sshd_config.d/*.conf 2>/dev/null || true; } \
      | awk '{print $2}' | grep -E '^[0-9]+$' | sort -n | uniq
    )
  fi
  if [[ ${#SSH_PORTS[@]} -eq 0 ]]; then
    SSH_PORTS=(22)
  fi
  printf "%s\n" "${SSH_PORTS[@]}"
}

# -----------------------------
# 4) 防火墙 + 入侵防护
# -----------------------------
install_base_firewall() {
  require_root
  detect_pkg_mgr >/dev/null

  echo "安装/校验 UFW 防火墙..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ufw

  # 配置 UFW：设置默认策略 -> 放行 SSH/HTTP/HTTPS/自定义端口 -> 启用
  sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw || true
  ufw default deny incoming
  ufw default allow outgoing

  local -a SSH_PORTS=()
  mapfile -t SSH_PORTS < <(detect_ssh_ports)
  echo "检测到 SSH 端口：${SSH_PORTS[*]}"
  for p in "${SSH_PORTS[@]}"; do ufw limit "${p}/tcp"; done
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
  ufw status verbose || true

  # 保证 UFW 启用后 Docker 规则能自动重建
  if systemctl is-active --quiet docker; then
    echo "[INFO] 已检测到 Docker，正在重启以应用防火墙规则..."
    systemctl restart docker
  fi
}

base_firewall_status() {
  if ! command -v ufw >/dev/null 2>&1; then
    echo "未安装"
    return
  fi

  local status
  status=$(ufw status 2>/dev/null | awk -F': ' '/^Status:/{print $2}')
  case "$status" in
    active) echo "开启" ;;
    inactive) echo "关闭" ;;
    *) echo "${status:-未知}" ;;
  esac
}

disable_base_firewall() {
  require_root
  if ! command -v ufw >/dev/null 2>&1; then
    echo "未找到 ufw，UFW 防火墙未安装。"
    return 0
  fi

  ufw --force disable
  echo "已关闭 UFW 防火墙。"
}

udp_all_in_status() {
  if ufw status numbered 2>/dev/null | grep -Eq 'ALLOW IN[[:space:]]+Anywhere/udp'; then
    echo "开启"
  else
    echo "关闭"
  fi
}

enable_udp_all_in() {
  require_root
  if ! command -v ufw >/dev/null 2>&1; then
    echo "未找到 ufw，请先安装 UFW 防火墙。"
    return 1
  fi

  # Surge Ponte/Snell 穿透场景：保留 TCP 入站限制，只开放全部 UDP 入站。
  ufw allow in proto udp from any to any
  ufw --force enable >/dev/null
  echo "已开启全部 UDP 入站放行。"
}

disable_udp_all_in() {
  require_root
  if ! command -v ufw >/dev/null 2>&1; then
    echo "未找到 ufw，请先安装 UFW 防火墙。"
    return 1
  fi

  ufw --force delete allow in proto udp from any to any || true
  echo "已关闭全部 UDP 入站放行。"
}

fail2ban_status_text() {
  if ! command -v fail2ban-client >/dev/null 2>&1; then
    echo "未安装"
  elif systemctl is-active --quiet fail2ban; then
    echo "已安装并运行"
  else
    echo "已安装但未运行"
  fi
}

install_fail2ban_ssh_guard() {
  require_root
  detect_pkg_mgr >/dev/null

  echo "安装/启用 Fail2Ban SSH 防暴力破解..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y fail2ban python3-systemd

  local -a SSH_PORTS=()
  mapfile -t SSH_PORTS < <(detect_ssh_ports)
  local SSH_PORT_LIST
  SSH_PORT_LIST=$(IFS=,; echo "${SSH_PORTS[*]}")

  # Fail2Ban：systemd 后端（journal）优先；必要时设置 journalmatch
  mkdir -p /etc/fail2ban/jail.d

  local JM=""
  systemctl status ssh  >/dev/null 2>&1 && JM="_SYSTEMD_UNIT=ssh.service"
  systemctl status sshd >/dev/null 2>&1 && JM="_SYSTEMD_UNIT=sshd.service"

  cat >/etc/fail2ban/jail.d/ssh-hardening.local <<EOF
[sshd]
enabled = true
backend = systemd
port = ${SSH_PORT_LIST}
maxretry = 10
findtime = 5m
bantime = 24h
banaction = ufw
EOF

  if [[ -n "$JM" ]]; then
    sed -i "/^\[sshd\]/a journalmatch = ${JM}" /etc/fail2ban/jail.d/ssh-hardening.local
  fi

  # 自检与回退：若使用 systemd 后端测试失败，则回退至 auth.log（需要 rsyslog）
  if fail2ban-client -t; then
    systemctl enable fail2ban
    systemctl restart fail2ban
  else
    echo "Fail2Ban 自检失败，启用 rsyslog 并回退到文件日志后端..."
    apt-get install -y rsyslog
    systemctl enable --now rsyslog
    cat >/etc/fail2ban/jail.d/ssh-hardening.local <<EOF
[sshd]
enabled = true
backend = auto
port = ${SSH_PORT_LIST}
logpath = /var/log/auth.log
maxretry = 10
findtime = 5m
bantime = 24h
banaction = ufw
EOF
    fail2ban-client -t
    systemctl enable fail2ban
    systemctl restart fail2ban
  fi

  # 展示最终状态（等待 fail2ban 套接字就绪，避免竞态报错）
  for i in {1..10}; do
    if systemctl is-active --quiet fail2ban && [[ -S /var/run/fail2ban/fail2ban.sock ]]; then
      break
    fi
    sleep 0.5
  done
  fail2ban-client ping || true
  fail2ban-client status || true
  fail2ban-client status sshd || true
}

disable_fail2ban_ssh_guard() {
  require_root
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "未找到 systemctl，无法关闭 Fail2Ban。"
    return 1
  fi

  systemctl disable --now fail2ban 2>/dev/null || true
  echo "已关闭 Fail2Ban SSH 防护。"
}

optimize_vps() {
  require_root
  require_cmd awk
  require_cmd grep
  require_cmd sysctl
  ensure_systemd

  system_update
  set_timezone_shanghai
  setup_swap
  tune_journald
  enable_bbr_fq
}

validate_port() {
  local port="${1:-}"
  [[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1 && port <= 65535 ))
}

prompt_required_value() {
  local prompt="$1"
  local value
  while true; do
    read -r -p "$prompt" value
    if [[ -n "$value" ]]; then
      printf "%s" "$value"
      return 0
    fi
    echo "不能为空，请重新输入。"
  done
}

prompt_optional_threshold() {
  local prompt="$1"
  local value
  while true; do
    read -r -p "$prompt，直接回车不启用 [0]: " value
    value="${value:-0}"
    if [[ "$value" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
      printf "%s" "$value"
      return 0
    fi
    echo "请输入数字，或直接回车不启用。"
  done
}

download_file() {
  local url="$1"
  local output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$output" "$url"
  else
    echo "未找到 curl 或 wget，无法下载文件。"
    return 1
  fi
}

write_tg_notify_script() {
  local output="$1"
  local bot_token="$2"
  local chat_id="$3"
  local server_name="$4"
  local cpu_threshold="$5"
  local memory_threshold="$6"
  local disk_threshold="$7"
  local network_threshold="$8"

  cat >"$output" <<EOF
#!/usr/bin/env bash
set -euo pipefail

TELEGRAM_BOT_TOKEN=$(shell_quote "$bot_token")
CHAT_ID=$(shell_quote "$chat_id")
SERVER_DISPLAY_NAME=$(shell_quote "$server_name")

CPU_THRESHOLD=$cpu_threshold
MEMORY_THRESHOLD=$memory_threshold
DISK_THRESHOLD=$disk_threshold
NETWORK_THRESHOLD_GB=$network_threshold

get_machine_label() {
  if [[ -n "\${SERVER_DISPLAY_NAME:-}" ]]; then
    echo "\$SERVER_DISPLAY_NAME"
    return 0
  fi
  hostname 2>/dev/null || echo "服务器"
}

send_tg_notification() {
  local message="\$1"
  curl -fsS -X POST "https://api.telegram.org/bot\$TELEGRAM_BOT_TOKEN/sendMessage" \\
    -d "chat_id=\$CHAT_ID" \\
    -d "text=\$message" >/dev/null 2>&1 || true
}

get_cpu_usage() {
  awk '{u=\$2+\$4; t=\$2+\$4+\$5; if (NR==1){u1=u; t1=t;} else printf "%.0f\\n", ((\$2+\$4-u1) * 100 / (t-t1))}' \\
    <(grep 'cpu ' /proc/stat) <(sleep 1; grep 'cpu ' /proc/stat)
}

get_memory_usage() {
  free | awk '/Mem/ {printf("%.0f"), \$3/\$2 * 100}'
}

get_disk_usage() {
  df / | awk 'NR==2 {print \$5}' | sed 's/%//'
}

get_rx_bytes() {
  awk 'BEGIN { rx_total = 0 }
    \$1 ~ /^(eth|ens|enp|eno)[0-9]+/ { rx_total += \$2 }
    END { printf("%.2f", rx_total / (1024 * 1024 * 1024)); }' /proc/net/dev
}

get_tx_bytes() {
  awk 'BEGIN { tx_total = 0 }
    \$1 ~ /^(eth|ens|enp|eno)[0-9]+/ { tx_total += \$10 }
    END { printf("%.2f", tx_total / (1024 * 1024 * 1024)); }' /proc/net/dev
}

check_and_notify() {
  local usage="\$1"
  local type="\$2"
  local threshold="\$3"
  local machine_label="\$4"
  if (( \$(echo "\$threshold <= 0" | bc -l) )); then
    return 0
  fi
  if (( \$(echo "\$usage > \$threshold" | bc -l) )); then
    send_tg_notification "警告：\${machine_label} \${type}已达到 \${usage}%，超过阈值 \${threshold}%。"
  fi
}

monitor_loop() {
  while true; do
    local machine_label cpu_usage memory_usage disk_usage rx_gb tx_gb
    machine_label=\$(get_machine_label)
    cpu_usage=\$(get_cpu_usage)
    memory_usage=\$(get_memory_usage)
    disk_usage=\$(get_disk_usage)
    rx_gb=\$(get_rx_bytes)
    tx_gb=\$(get_tx_bytes)

    check_and_notify "\$cpu_usage" "CPU 使用情况" "\$CPU_THRESHOLD" "\$machine_label"
    check_and_notify "\$memory_usage" "内存使用情况" "\$MEMORY_THRESHOLD" "\$machine_label"
    check_and_notify "\$disk_usage" "硬盘使用情况" "\$DISK_THRESHOLD" "\$machine_label"

    if (( \$(echo "\$NETWORK_THRESHOLD_GB > 0 && \$rx_gb > \$NETWORK_THRESHOLD_GB" | bc -l) )); then
      send_tg_notification "警告：\${machine_label} 入站流量使用情况已达到 \${rx_gb}GB，超过阈值 \${NETWORK_THRESHOLD_GB}GB。"
    fi
    if (( \$(echo "\$NETWORK_THRESHOLD_GB > 0 && \$tx_gb > \$NETWORK_THRESHOLD_GB" | bc -l) )); then
      send_tg_notification "警告：\${machine_label} 出站流量使用情况已达到 \${tx_gb}GB，超过阈值 \${NETWORK_THRESHOLD_GB}GB。"
    fi

    sleep 300
  done
}

send_login_notification() {
  local ip username location message
  ip=\$(echo "\${SSH_CONNECTION:-}" | awk '{print \$1}')
  [[ -n "\$ip" ]] || return 0
  username=\$(whoami)
  location=\$(curl -fsS "http://opendata.baidu.com/api.php?query=\$ip&co=&resource_id=6006&oe=utf8&format=json" 2>/dev/null | jq -r '.data[0].location // "未知"' 2>/dev/null || echo "未知")
  message="ℹ️ \${SERVER_DISPLAY_NAME} 有人登录
登录用户：\$username
登录IP：\$ip
登录地区为：\$location"
  send_tg_notification "\$message"
}

case "\${1:-monitor}" in
  monitor) monitor_loop ;;
  login) send_login_notification ;;
  *) echo "用法: \$0 [monitor|login]" >&2; exit 1 ;;
esac
EOF
  chmod +x "$output"
}

tg_notify_file() {
  printf "%s\n" "$HOME/服务器告警.sh"
}

notify_threshold_value() {
  local file="$1"
  local name="$2"
  local default="${3:-0}"
  local value
  value="$(grep -E "^${name}=" "$file" 2>/dev/null | head -n 1 | cut -d= -f2- || true)"
  if [[ "$value" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    printf "%s" "$value"
  else
    printf "%s" "$default"
  fi
}

tg_config_value() {
  local file="$1"
  local name="$2"
  local value
  value="$(grep -E "^${name}=" "$file" 2>/dev/null | head -n 1 | cut -d= -f2- || true)"
  value="${value#\'}"
  value="${value%\'}"
  printf "%s" "$value"
}

ensure_tg_notify_dependencies() {
  require_root
  detect_pkg_mgr >/dev/null
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y curl tmux bc jq cron
  systemctl enable --now cron >/dev/null 2>&1 || true
}

configure_tg_notify_script() {
  local configure_monitor="${1:-false}"
  local notify_file
  notify_file="$(tg_notify_file)"

  local bot_token chat_id server_name existing_token existing_chat_id existing_server_name cpu_threshold memory_threshold disk_threshold network_threshold
  existing_token="$(tg_config_value "$notify_file" TELEGRAM_BOT_TOKEN)"
  existing_chat_id="$(tg_config_value "$notify_file" CHAT_ID)"
  existing_server_name="$(tg_config_value "$notify_file" SERVER_DISPLAY_NAME)"
  if [[ -n "$existing_server_name" ]]; then
    server_name="$existing_server_name"
  else
    server_name="$(prompt_required_value "请输入服务器显示名称：")"
    echo
  fi
  if [[ -n "$existing_token" && -n "$existing_chat_id" ]]; then
    bot_token="$existing_token"
    chat_id="$existing_chat_id"
    echo "已检测到现有 Telegram 配置，将直接沿用。"
  else
    echo "你需要提前准备 Telegram Bot Token 和接收通知的 Chat ID。"
    echo
    bot_token="$(prompt_required_value "请输入 Telegram Bot Token：")"
    echo
    chat_id="$(prompt_required_value "请输入接收通知的 Chat ID：")"
    echo
  fi

  if [[ "$configure_monitor" == true ]]; then
    cpu_threshold="$(prompt_optional_threshold "CPU 使用率预警阈值百分比")"
    memory_threshold="$(prompt_optional_threshold "内存使用率预警阈值百分比")"
    disk_threshold="$(prompt_optional_threshold "硬盘使用率预警阈值百分比")"
    network_threshold="$(prompt_optional_threshold "入站/出站流量预警阈值 GB")"
  else
    cpu_threshold="$(notify_threshold_value "$notify_file" CPU_THRESHOLD 0)"
    memory_threshold="$(notify_threshold_value "$notify_file" MEMORY_THRESHOLD 0)"
    disk_threshold="$(notify_threshold_value "$notify_file" DISK_THRESHOLD 0)"
    network_threshold="$(notify_threshold_value "$notify_file" NETWORK_THRESHOLD_GB 0)"
  fi

  write_tg_notify_script "$notify_file" "$bot_token" "$chat_id" "$server_name" "$cpu_threshold" "$memory_threshold" "$disk_threshold" "$network_threshold"
}

tg_monitor_status_text() {
  if tmux has-session -t TG-check-notify >/dev/null 2>&1 || crontab -l 2>/dev/null | grep -Eq '服务器告警\.sh.*monitor|TG-notify\.sh.*monitor|TG-check-notify\.sh'; then
    echo "已开启"
  else
    echo "已关闭"
  fi
}

tg_login_status_text() {
  if grep -Eq '服务器告警\.sh login|TG-notify\.sh login' "$HOME/.profile" 2>/dev/null; then
    echo "已开启"
  else
    echo "已关闭"
  fi
}

enable_tg_monitor() {
  ensure_tg_notify_dependencies
  configure_tg_notify_script true

  local notify_file
  notify_file="$(tg_notify_file)"

  tmux kill-session -t TG-check-notify >/dev/null 2>&1 || true
  tmux new -d -s TG-check-notify "$notify_file" monitor

  crontab -l 2>/dev/null | grep -Ev '服务器告警\.sh.*monitor|TG-notify\.sh.*monitor|TG-check-notify\.sh' | crontab - 2>/dev/null || true
  (crontab -l 2>/dev/null; echo "@reboot tmux new -d -s TG-check-notify '$notify_file' monitor") | crontab -

  echo "系统资源/流量报警已开启。"
}

disable_tg_monitor() {
  require_root
  tmux kill-session -t TG-check-notify >/dev/null 2>&1 || true
  crontab -l 2>/dev/null | grep -Ev '服务器告警\.sh.*monitor|TG-notify\.sh.*monitor|TG-check-notify\.sh' | crontab - 2>/dev/null || true
  echo "系统资源/流量报警已关闭。"
}

enable_tg_login_notify() {
  ensure_tg_notify_dependencies
  configure_tg_notify_script false

  local notify_file
  notify_file="$(tg_notify_file)"
  sed -i '/TG-SSH-check-notify.sh/d; /TG-notify.sh login/d; /服务器告警.sh login/d' "$HOME/.profile" 2>/dev/null || true
  if ! grep -qF "bash $notify_file login" "$HOME/.profile" 2>/dev/null; then
    echo "bash $notify_file login" >> "$HOME/.profile"
  fi

  echo "SSH 登录通知已开启。"
}

disable_tg_login_notify() {
  require_root
  sed -i '/TG-SSH-check-notify.sh/d; /TG-notify.sh login/d; /服务器告警.sh login/d' "$HOME/.profile" 2>/dev/null || true
  echo "SSH 登录通知已关闭。"
}

clear_telegram_config() {
  require_root
  tmux kill-session -t TG-check-notify >/dev/null 2>&1 || true
  crontab -l 2>/dev/null | grep -Ev '服务器告警\.sh.*monitor|TG-notify\.sh.*monitor|TG-check-notify\.sh' | crontab - 2>/dev/null || true
  sed -i '/TG-SSH-check-notify.sh/d; /TG-notify.sh login/d; /服务器告警.sh login/d' "$HOME/.profile" 2>/dev/null || true
  rm -f "$(tg_notify_file)" "$HOME/TG-notify.sh" "$HOME/TG-check-notify.sh" "$HOME/TG-SSH-check-notify.sh"
  echo "Telegram 配置信息已清除。"
}

manage_tg_monitor() {
  while true; do
    echo
    echo "系统资源/流量报警"
    echo "当前状态：$(tg_monitor_status_text)"
    echo "1. 开启系统资源/流量报警"
    echo "2. 关闭系统资源/流量报警"
    echo "0. 返回上一级菜单"
    local choice
    read -r -p "请选择：" choice

    case "$choice" in
      1) refresh_screen; enable_tg_monitor; finish_menu_action ;;
      2) refresh_screen; disable_tg_monitor; finish_menu_action ;;
      0) return 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}

manage_tg_login_notify() {
  while true; do
    echo
    echo "SSH 登录通知"
    echo "当前状态：$(tg_login_status_text)"
    echo "1. 开启 SSH 登录通知"
    echo "2. 关闭 SSH 登录通知"
    echo "0. 返回上一级菜单"
    local choice
    read -r -p "请选择：" choice

    case "$choice" in
      1) refresh_screen; enable_tg_login_notify; finish_menu_action ;;
      2) refresh_screen; disable_tg_login_notify; finish_menu_action ;;
      0) return 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}

tg_notify_menu() {
  while true; do
    echo
    echo "TG-bot通知管理"
    echo "通知脚本：$(tg_notify_file)"
    echo "1. 系统资源/流量报警"
    echo "2. SSH 登录通知"
    echo "3. Telegram 清除配置信息"
    echo "0. 返回上一级菜单"
    local choice
    read -r -p "请选择：" choice

    case "$choice" in
      1) refresh_screen; manage_tg_monitor ;;
      2) refresh_screen; manage_tg_login_notify ;;
      3) refresh_screen; clear_telegram_config; finish_menu_action ;;
      0) return 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}

install_test_tool() {
  local cmd="$1"
  local package="${2:-$1}"
  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi
  require_root
  detect_pkg_mgr >/dev/null
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y "$package"
}

ensure_benchmark_swap() {
  local swap_total
  swap_total="$(free -m | awk 'NR==3{print $2}')"
  if [[ "${swap_total:-0}" =~ ^[0-9]+$ ]] && (( swap_total > 0 )); then
    return 0
  fi
  echo "未检测到 swap，正在创建用于性能测试的 swap..."
  setup_swap
}

run_test_script_action() {
  local title="$1"
  shift
  echo "$title"
  "$@"
}

finish_test_script_action() {
  echo
  read -n 1 -s -r -p "按任意键返回上一级菜单..."
  echo
  refresh_screen
}

test_choice_action() {
  refresh_screen
  run_test_script_action "$@"
  finish_test_script_action
}

test_scripts_menu() {
  while true; do
    echo
    echo "测试脚本合集"
    echo "------------------------"
    echo "IP及解锁状态检测"
    echo "1. ChatGPT 解锁状态检测"
    echo "2. Region 流媒体解锁测试"
    echo "3. yeahwu 流媒体解锁检测"
    echo "4. xykt IP质量体检脚本"
    echo "------------------------"
    echo "网络线路测速"
    echo "11. besttrace 三网回程延迟路由测试"
    echo "12. mtr_trace 三网回程线路测试"
    echo "13. Superspeed 三网测速"
    echo "14. nxtrace 快速回程测试脚本"
    echo "15. nxtrace 指定IP回程测试脚本"
    echo "16. ludashi2020 三网线路测试"
    echo "17. i-abc 多功能测速脚本"
    echo "18. NetQuality 网络质量体检脚本"
    echo "------------------------"
    echo "硬件性能测试"
    echo "21. yabs 性能测试"
    echo "22. icu/gb5 CPU性能测试脚本"
    echo "------------------------"
    echo "综合性测试"
    echo "31. bench 性能测试"
    echo "32. spiritysdx 融合怪测评"
    echo "33. nodequality 融合怪测评"
    echo "------------------------"
    echo "0. 返回上一级菜单"
    local choice
    read -r -p "请选择：" choice

    case "$choice" in
      1) test_choice_action "ChatGPT 解锁状态检测" bash -c 'bash <(curl -Ls https://cdn.jsdelivr.net/gh/missuo/OpenAI-Checker/openai.sh)' ;;
      2) test_choice_action "Region 流媒体解锁测试" bash -c 'bash <(curl -L -s check.unlock.media)' ;;
      3) install_test_tool wget; test_choice_action "yeahwu 流媒体解锁检测" bash -c 'wget -qO- https://github.com/yeahwu/check/raw/main/check.sh | bash' ;;
      4) test_choice_action "xykt IP质量体检脚本" bash -c 'bash <(curl -Ls IP.Check.Place)' ;;
      11) install_test_tool wget; test_choice_action "besttrace 三网回程延迟路由测试" bash -c 'wget -qO- git.io/besttrace | bash' ;;
      12) test_choice_action "mtr_trace 三网回程线路测试" bash -c 'curl https://raw.githubusercontent.com/zhucaidan/mtr_trace/main/mtr_trace.sh | bash' ;;
      13) test_choice_action "Superspeed 三网测速" bash -c 'bash <(curl -Lso- https://git.io/superspeed_uxh)' ;;
      14) test_choice_action "nxtrace 快速回程测试脚本" bash -c 'curl nxtrace.org/nt | bash && nexttrace --fast-trace --tcp' ;;
      15)
        refresh_screen
        echo "可参考的 IP 列表"
        echo "北京电信: 219.141.136.12"
        echo "北京联通: 202.106.50.1"
        echo "北京移动: 221.179.155.161"
        echo "上海电信: 202.96.209.133"
        echo "上海联通: 210.22.97.1"
        echo "上海移动: 211.136.112.200"
        echo "广州电信: 58.60.188.222"
        echo "广州联通: 210.21.196.6"
        echo "广州移动: 120.196.165.24"
        echo "成都电信: 61.139.2.69"
        echo "成都联通: 119.6.6.6"
        echo "成都移动: 211.137.96.205"
        echo "湖南电信: 36.111.200.100"
        echo "湖南联通: 42.48.16.100"
        echo "湖南移动: 39.134.254.6"
        local testip
        read -r -p "输入一个指定 IP：" testip
        if [[ -n "$testip" ]]; then
          curl nxtrace.org/nt | bash
          nexttrace "$testip"
        fi
        finish_test_script_action
        ;;
      16) test_choice_action "ludashi2020 三网线路测试" sh -c 'curl https://raw.githubusercontent.com/ludashi2020/backtrace/main/install.sh -sSf | sh' ;;
      17) test_choice_action "i-abc 多功能测速脚本" bash -c 'bash <(curl -sL https://raw.githubusercontent.com/i-abc/Speedtest/main/speedtest.sh)' ;;
      18) test_choice_action "NetQuality 网络质量体检脚本" bash -c 'bash <(curl -sL Net.Check.Place)' ;;
      21) ensure_benchmark_swap; test_choice_action "yabs 性能测试" bash -c 'curl -sL yabs.sh | bash -s -- -i -5' ;;
      22) ensure_benchmark_swap; test_choice_action "icu/gb5 CPU性能测试脚本" bash -c 'bash <(curl -sL bash.icu/gb5)' ;;
      31) test_choice_action "bench 性能测试" bash -c 'curl -Lso- bench.sh | bash' ;;
      32) test_choice_action "spiritysdx 融合怪测评" bash -c 'curl -L https://github.com/spiritLHLS/ecs/raw/main/ecs.sh -o ecs.sh && chmod +x ecs.sh && bash ecs.sh' ;;
      33) test_choice_action "nodequality 融合怪测评" bash -c 'bash <(curl -sL https://run.NodeQuality.com)' ;;
      0) return 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}

allow_port() {
  require_root
  if ! command -v ufw >/dev/null 2>&1; then
    echo "未找到 ufw，请先进入 2 防火墙管理，选择 1 安装 UFW 防火墙。"
    return 1
  fi

  local port
  read -r -p "请输入放行的端口号，0 返回上一级菜单：" port
  if [[ "$port" == "0" ]]; then
    return 2
  fi
  if ! validate_port "$port"; then
    echo "端口号无效，必须是 1-65535。"
    return 1
  fi

  ufw allow "$port"
  ufw --force enable >/dev/null
  echo "已放行端口：$port"
}

list_allowed_ports() {
  ufw status numbered 2>/dev/null | awk '
    /^\[[[:space:]]*[0-9]+\]/ && /ALLOW IN/ {
      line=$0
      sub(/^\[[[:space:]]*[0-9]+\][[:space:]]+/, "", line)
      split(line, fields)
      target=fields[1]
      if ($0 ~ /\(v6\)/) next
      if (target !~ /^[0-9]+(\/(tcp|udp))?$/) next
      if (!seen[target]++) print target
    }
  '
}

print_allowed_ports() {
  local -a ports=()
  local line
  while IFS= read -r line; do
    [[ -n "$line" ]] && ports+=("$line")
  done < <(list_allowed_ports)

  if [[ ${#ports[@]} -eq 0 ]]; then
    echo "当前没有放行端口规则。"
    return 0
  fi

  local i
  for i in "${!ports[@]}"; do
    printf "%d. %s\n" "$((i + 1))" "${ports[$i]}"
  done
}

manage_allow_port() {
  while true; do
    echo
    echo "当前放行端口："
    print_allowed_ports
    echo
    local result=0
    if allow_port; then
      result=0
    else
      result=$?
    fi
    if [[ $result -eq 2 ]]; then
      return 0
    fi
    finish_menu_action
  done
}

delete_allowed_port() {
  require_root
  if ! command -v ufw >/dev/null 2>&1; then
    echo "未找到 ufw，请先进入 2 防火墙管理，选择 1 安装 UFW 防火墙。"
    return 1
  fi

  local -a ports=()
  local line
  while IFS= read -r line; do
    [[ -n "$line" ]] && ports+=("$line")
  done < <(list_allowed_ports)

  if [[ ${#ports[@]} -eq 0 ]]; then
    echo "当前没有可删除的放行端口规则。"
    read -r -p "0 返回上一级菜单：" _back
    return 2
  fi

  local i
  for i in "${!ports[@]}"; do
    printf "%d. %s\n" "$((i + 1))" "${ports[$i]}"
  done

  local selected
  read -r -p "输入要删除的序号，0 返回上一级菜单：" selected
  if [[ "$selected" == "0" ]]; then
    return 2
  fi
  if ! [[ "$selected" =~ ^[0-9]+$ ]] || (( selected < 1 || selected > ${#ports[@]} )); then
    echo "无效序号。"
    return 1
  fi

  local port="${ports[$((selected - 1))]}"
  ufw --force delete allow "$port" || true
  echo "已删除放行端口：$port"
}

manage_delete_allowed_port() {
  while true; do
    echo
    echo "删除放行端口"
    echo
    if ! command -v ufw >/dev/null 2>&1; then
      echo "未找到 ufw，请先进入 2 防火墙管理，选择 1 安装 UFW 防火墙。"
      read -r -p "0 返回上一级菜单：" _back
      return 0
    fi

    local result=0
    if delete_allowed_port; then
      result=0
    else
      result=$?
    fi
    if [[ $result -eq 2 ]]; then
      return 0
    fi
    finish_menu_action
  done
}

manage_base_firewall() {
  while true; do
    echo
    echo "当前状态：$(base_firewall_status)"
    echo "1. 开启 UFW 防火墙"
    echo "2. 关闭 UFW 防火墙"
    echo "0. 返回上一级菜单"
    local choice
    read -r -p "请选择：" choice

    case "$choice" in
      1) refresh_screen; install_base_firewall; finish_menu_action ;;
      2) refresh_screen; disable_base_firewall; finish_menu_action ;;
      0) return 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}

manage_udp_all_in() {
  while true; do
    echo
    echo "当前状态：$(udp_all_in_status)"
    echo "1. 开启全部 UDP 入站放行"
    echo "2. 关闭全部 UDP 入站放行"
    echo "0. 返回上一级菜单"
    local choice
    read -r -p "请选择：" choice

    case "$choice" in
      1) refresh_screen; enable_udp_all_in; finish_menu_action ;;
      2) refresh_screen; disable_udp_all_in; finish_menu_action ;;
      0) return 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}

manage_fail2ban() {
  while true; do
    echo
    echo "当前状态：$(fail2ban_status_text)"
    echo "1. 安装并启用 SSH 防暴力破解"
    echo "2. 关闭 SSH 防暴力破解"
    echo "0. 返回上一级菜单"
    local choice
    read -r -p "请选择：" choice

    case "$choice" in
      1) refresh_screen; install_fail2ban_ssh_guard; finish_menu_action ;;
      2) refresh_screen; disable_fail2ban_ssh_guard; finish_menu_action ;;
      0) return 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}

firewall_menu() {
  while true; do
    echo
    echo "1. UFW 防火墙管理"
    echo "2. 加入放行端口"
    echo "3. 删除放行端口"
    echo "4. 全部 UDP 入站放行管理"
    echo "5. SSH 防暴力破解管理"
    echo "0. 返回上一级菜单"
    local choice
    read -r -p "请选择：" choice

    case "$choice" in
      1) refresh_screen; manage_base_firewall ;;
      2) refresh_screen; manage_allow_port ;;
      3) refresh_screen; manage_delete_allowed_port ;;
      4) refresh_screen; manage_udp_all_in ;;
      5) refresh_screen; manage_fail2ban ;;
      0) return 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}

main_menu() {
  require_root
  install_shortcut_command
  while true; do
    echo
    echo "1. 优化 VPS"
    echo "2. 防火墙管理"
    echo "3. TG-bot通知管理"
    echo "4. 测试脚本合集"
    echo "0. 退出脚本"
    echo "00. 更新脚本"
    local choice
    read -r -p "请选择：" choice

    case "$choice" in
      00) self_update ;;
      1)
        refresh_screen
        FINISH_ENABLED=true
        optimize_vps
        FINISH_ENABLED=false
        echo "优化完成，返回主菜单。"
        finish_menu_action
      ;;
      2) refresh_screen; firewall_menu ;;
      3) refresh_screen; tg_notify_menu ;;
      4) refresh_screen; test_scripts_menu ;;
      0) refresh_screen; exit 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}

main() {
  main_menu
}

main "$@"
