# Snell IP 使用人数查询

用于在 Snell 服务器上查询当前连接来源 IP、地区、运营商和活跃连接数，并支持按 IP 封禁/解除封禁。

## 一键安装并运行

```bash
bash -c "$(curl -fsSL -H 'Accept: application/vnd.github.raw' https://api.github.com/repos/xiaopan007/zaxiang/contents/snell-ip-query/install.sh?ref=main)"
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
4. 新来源自动通知
0. 退出脚本
```

脚本会自动识别 Snell 端口，优先使用 UFW 进行封禁；如果没有 UFW，会尝试 iptables。

## 新来源自动通知

主菜单输入 `4` 后会显示当前状态，并固定提供：

```text
1. 开启自动扫描
2. 关闭自动扫描
0. 返回
```

开启时会逐项输入服务器名称、Telegram Bot Token、Telegram Chat ID 和扫描间隔。第一次开启会静默记录当前已有的“地区+运营商”来源，之后发现新的“地区+运营商”组合才发送 Telegram 通知。

通知示例：

```text
香港中转1 有新的 河北石家庄电信 加入
```

公网 IP 只用于查询归属地和运营商，不会出现在通知文案里，也不会作为重复通知的判断依据。
