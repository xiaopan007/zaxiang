# IPTV 中文频道订阅

这是 [iptv-org/iptv](https://github.com/iptv-org/iptv) 中文频道播放列表 `languages/zho.m3u` 的中文名称派生版本，包含中国大陆、港澳台及海外中文频道。除 `CCTV` 品牌名称外，频道名称、频道分组、清晰度和状态提示已经中文化；所有 CCTV 频道统一归入 `CCTV` 分组。频道标识、台标和直播地址保持上游原值。

## 订阅地址

```text
https://raw.githubusercontent.com/xiaopan007/zaxiang/main/iptv/zho.m3u
```

将该地址添加到支持远程播放列表的播放器即可。直播源由上游社区收集，频道可用性、地区限制和网络质量可能随时变化。

## 中文节目单

播放列表已经内置以下 XMLTV 节目单地址，支持 `url-tvg` 的播放器会自动关联：

```text
https://raw.githubusercontent.com/xiaopan007/zaxiang/main/iptv/epg.xml.gz
```

节目单使用 `iptv-org/epg` 的中文配置抓取，并将节目单频道 ID 自动映射到本订阅的不同清晰度版本。只发布包含中文且不含英文字母的节目标题；纯英文或中英混合标题会被过滤。当前主要覆盖 CCTV、主要卫视、凤凰、港台及部分港澳台频道，没有可靠中文数据源的频道不会显示节目单。

## 自动更新

GitHub Actions 每天北京时间约 06:20 拉取上游，重新生成三天中文节目单和频道订阅。只有内容发生变化时才提交。若上游新增频道却没有可靠中文名、中文节目数量异常，或出现无法翻译的新分组和状态，更新会安全失败并保留上一版，避免发布中英文混杂或空节目单。

手动更新：

```bash
python3 iptv/update_zh_iptv.py
```

## 声明

本仓库不存储、代理或转播任何视频，只转换公开播放列表中的显示名称。该订阅不是 iptv-org 官方中文版本；原始数据及相关说明以其项目为准。
