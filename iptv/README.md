# IPTV 中文频道订阅

这是 [iptv-org/iptv](https://github.com/iptv-org/iptv) 中文频道播放列表 `languages/zho.m3u` 的中文名称派生版本，包含中国大陆、港澳台及海外中文频道。频道名称、频道分组、清晰度和状态提示已经中文化；频道标识、台标和直播地址保持上游原值。

## 订阅地址

```text
https://raw.githubusercontent.com/xiaopan007/zaxiang/main/iptv/zho.m3u
```

将该地址添加到支持远程播放列表的播放器即可。直播源由上游社区收集，频道可用性、地区限制和网络质量可能随时变化。

## 自动更新

GitHub Actions 每天北京时间约 06:20 拉取上游并重新生成。只有内容发生变化时才提交。若上游新增频道却没有可靠中文名，或出现无法翻译的新分组和状态，更新会安全失败并保留上一版，避免发布中英文混杂的列表。

手动更新：

```bash
python3 iptv/update_zh_iptv.py
```

运行测试：

```bash
python3 -m unittest iptv/test_update_zh_iptv.py -v
```

## 声明

本仓库不存储、代理或转播任何视频，只转换公开播放列表中的显示名称。该订阅不是 iptv-org 官方中文版本；原始数据及相关说明以其项目为准。
