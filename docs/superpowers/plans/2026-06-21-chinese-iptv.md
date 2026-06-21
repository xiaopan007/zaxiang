# Chinese IPTV Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布每日自动同步、用户可见字段完全中文化的 IPTV 中文频道 M3U 订阅。

**Architecture:** Python 标准库脚本拉取官方 M3U 与频道数据库，以审校映射和中文别名转换可见字段，并在验证失败时拒绝写入。GitHub Actions 定时运行脚本、测试和验证，仅在产物变化时提交。

**Tech Stack:** Python 3.11 标准库、`unittest`、GitHub Actions、M3U/XMLTV 标识约定。

## Global Constraints

- 保留上游 `tvg-id`、`tvg-logo` 和直播 URL。
- 频道名、分组、清晰度与状态标签不得残留英文字母。
- 未知频道或无效上游必须安全失败，不覆盖现有发布文件。
- 不增加第三方 Python 依赖。

---

### Task 1: 中文转换核心

**Files:**
- Create: `iptv/test_update_zh_iptv.py`
- Create: `iptv/update_zh_iptv.py`
- Create: `iptv/channel_names_zh.json`

**Interfaces:**
- Consumes: 上游 M3U 文本、channels.json 数据和 ID 映射。
- Produces: `localize_playlist(m3u_text, channels, names) -> str`。

- [ ] 先编写频道名、分组、标签、技术字段保留和失败行为测试。
- [ ] 运行 `python3 -m unittest iptv/test_update_zh_iptv.py -v`，确认因实现不存在而失败。
- [ ] 实现最小转换逻辑和当前频道审校映射。
- [ ] 再次运行单元测试，确认全部通过。

### Task 2: 发布产物和定时更新

**Files:**
- Create: `iptv/zho.m3u`
- Create: `iptv/README.md`
- Create: `.github/workflows/update-iptv.yml`

**Interfaces:**
- Consumes: `iptv/update_zh_iptv.py`。
- Produces: 可直接订阅的 `iptv/zho.m3u` 和每日更新工作流。

- [ ] 用实时上游 `languages/zho.m3u` 生成 `iptv/zho.m3u`。
- [ ] 增加使用说明、来源声明和订阅 URL。
- [ ] 增加每日及手动 GitHub Actions，测试通过后才提交变化。
- [ ] 验证本地生成结果与上游条目及 URL 一致。

### Task 3: 发布

**Files:**
- Modify: 以上全部文件。

**Interfaces:**
- Consumes: 完成的实现和验证结果。
- Produces: `origin/main` 上的可用订阅和自动更新流程。

- [ ] 运行完整单元测试、实时生成、英文残留检查和 `git diff --check`。
- [ ] 审查 `git diff`，确认无无关改动或凭据。
- [ ] 提交并推送 `main`。
- [ ] 检查远端分支与工作流状态。
