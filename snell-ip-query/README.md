# Snell IP 使用人数查询

用于在 Snell 服务器上查询当前连接来源 IP、地区、运营商和活跃连接数，并支持按 IP 封禁/解除封禁。

## 一键安装并运行

```bash
bash -c "$(curl -fsSL https://github.com/xiaopan007/zaxiang/raw/refs/heads/main/snell-ip-query/install.sh)"
```

安装后可直接运行：

```bash
c
```

或：

```bash
/root/服务器使用人数查询
```

主菜单输入：

```text
00
```

会从 GitHub 下载最新版脚本并自动重启，便于测试更新。

## 菜单

```text
1. 查询 IP 连接情况
2. 按 IP 封禁
3. 解除 IP 封禁
0. 退出脚本
```

脚本会自动识别 Snell 端口，优先使用 UFW 进行封禁；如果没有 UFW，会尝试 iptables。
