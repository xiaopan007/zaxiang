# VPS 优化脚本

用于 Ubuntu/Debian VPS 的常用优化和防火墙管理。

## 一键安装并运行

```bash
bash -c "$(curl -fsSL -H 'Accept: application/vnd.github.raw' https://api.github.com/repos/xiaopan007/zaxiang/contents/vps-optimizer/install.sh?ref=main)"
```

安装后可直接运行：

```bash
v
```

或：

```bash
/root/vps优化脚本.sh
```

## 菜单

```text
1. 优化 VPS
2. 防火墙管理
3. TG-bot系统监控预警
0. 退出脚本
```

端口放行和删除在 `2. 防火墙管理` 子菜单中。

主菜单输入：

```text
00
```

会从 GitHub 下载最新版脚本并自动重启，便于测试更新。
