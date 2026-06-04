#!/usr/bin/env bash
# VPS 一键优化脚本（Ubuntu/Debian，systemd）
# 功能：
# 0) 将系统更新到最新（非交互，保留现有配置），并清理无用包
# 1) 设置系统时区为 Asia/Shanghai
# 2) 配置并启用 2G 交换分区（若已存在则跳过），设置 vm.swappiness=10 以减少换页
# 3) 限制 systemd-journald 日志占用（持久 <=200M，运行时 <=100M），并清理旧日志
# 4) 检测并启用 BBR + fq（若内核支持；已启用则跳过；失败不影响其它步骤）
# 5) 防火墙管理独立菜单：UFW、防全部 UDP 入站、Fail2Ban SSH 防护
# 6) 端口放行/删除独立菜单
# 7) 优化结束时如检测到需要重启，进行交互式确认（y 立即重启 / n 跳过），并给出 SSH 断连的安全提示

set -Eeuo pipefail
exec 2>&1  # 将 stderr 合并到 stdout，确保终端按顺序显示全部输出

FINISH_ENABLED=false
SHORTCUT_NAME="v"
SHORTCUT_PATH="/usr/local/bin/v"
SELF_UPDATE_URL="https://raw.githubusercontent.com/xiaopan007/zaxiang/main/vps-optimizer/vps%E4%BC%98%E5%8C%96%E8%84%9A%E6%9C%AC.sh"

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
  local script_path temp_path
  script_path="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
  temp_path="${script_path}.new"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$SELF_UPDATE_URL" -o "$temp_path"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$temp_path" "$SELF_UPDATE_URL"
  else
    echo "更新失败：未找到 curl 或 wget。"
    return 1
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
  else
    ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
    echo "Asia/Shanghai" >/etc/timezone
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

allow_port() {
  require_root
  if ! command -v ufw >/dev/null 2>&1; then
    echo "未找到 ufw，请先进入 2 防火墙管理，选择 1 安装 UFW 防火墙。"
    return 1
  fi

  local port
  read -r -p "请输入放行的端口号：" port
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

delete_allowed_port() {
  require_root
  echo "删除放行端口"
  echo
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
    return 0
  fi

  local i
  for i in "${!ports[@]}"; do
    printf "%d. %s\n" "$((i + 1))" "${ports[$i]}"
  done

  local selected
  read -r -p "输入要删除的序号，0 返回上一级菜单：" selected
  if [[ "$selected" == "0" ]]; then
    return 0
  fi
  if ! [[ "$selected" =~ ^[0-9]+$ ]] || (( selected < 1 || selected > ${#ports[@]} )); then
    echo "无效序号。"
    return 1
  fi

  local port="${ports[$((selected - 1))]}"
  ufw --force delete allow "$port" || true
  echo "已删除放行端口：$port"
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
      1) refresh_screen; install_base_firewall ;;
      2) refresh_screen; disable_base_firewall ;;
      0) refresh_screen; return 0 ;;
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
      1) refresh_screen; enable_udp_all_in ;;
      2) refresh_screen; disable_udp_all_in ;;
      0) refresh_screen; return 0 ;;
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
      1) refresh_screen; install_fail2ban_ssh_guard ;;
      2) refresh_screen; disable_fail2ban_ssh_guard ;;
      0) refresh_screen; return 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}

firewall_menu() {
  while true; do
    echo
    echo "1. UFW 防火墙管理"
    echo "2. 全部 UDP 入站放行管理"
    echo "3. SSH 防暴力破解管理"
    echo "0. 返回上一级菜单"
    local choice
    read -r -p "请选择：" choice

    case "$choice" in
      1) refresh_screen; manage_base_firewall ;;
      2) refresh_screen; manage_udp_all_in ;;
      3) refresh_screen; manage_fail2ban ;;
      0) refresh_screen; return 0 ;;
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
    echo "3. 加入放行端口"
    echo "4. 删除放行端口"
    echo "0. 退出脚本"
    local choice
    read -r -p "请选择：" choice

    case "$choice" in
      00) self_update ;;
      1)
        refresh_screen
        FINISH_ENABLED=true
        optimize_vps
        exit 0
        ;;
      2) refresh_screen; firewall_menu ;;
      3) refresh_screen; allow_port ;;
      4) refresh_screen; delete_allowed_port ;;
      0) exit 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}

main() {
  main_menu
}

main "$@"
