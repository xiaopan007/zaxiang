#!/usr/bin/env python3
"""Generate a fully Chinese-labelled playlist from iptv-org's Chinese playlist."""

import argparse
import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, Mapping


SOURCE_URL = "https://iptv-org.github.io/iptv/languages/zho.m3u"
CHANNELS_URL = "https://iptv-org.github.io/api/channels.json"
EPG_URL = "https://raw.githubusercontent.com/xiaopan007/zaxiang/main/iptv/epg.xml.gz"
ASCII_LETTER = re.compile(r"[A-Za-z]")
HAN_CHARACTER = re.compile(r"[\u3400-\u9fff]")

GROUP_NAMES = {
    "Animation": "动画",
    "Business": "财经",
    "Classic": "经典",
    "Culture": "文化",
    "Documentary": "纪录",
    "Education": "教育",
    "Entertainment": "综艺",
    "Family": "家庭",
    "General": "综合",
    "Kids": "少儿",
    "Legislative": "政务",
    "Lifestyle": "生活",
    "Movies": "电影",
    "Music": "音乐",
    "News": "新闻",
    "Outdoor": "户外",
    "Religious": "宗教",
    "Science": "科学",
    "Series": "剧集",
    "Shop": "购物",
    "Sports": "体育",
    "Travel": "旅游",
    "Undefined": "未分类",
    "Weather": "气象",
}

STATUS_NAMES = {
    "Geo-blocked": "有地区限制",
    "Not 24/7": "非全天播出",
}


class LocalizationError(RuntimeError):
    """Raised when publishing would expose incomplete localization."""


def _channel_index(channels: Iterable[dict]) -> Dict[str, dict]:
    if isinstance(channels, Mapping):
        return dict(channels)
    return {channel["id"]: channel for channel in channels}


def _chinese_alias(channel: dict) -> str:
    for alias in channel.get("alt_names", []):
        if HAN_CHARACTER.search(alias) and not ASCII_LETTER.search(alias):
            return alias
    return ""


def _translate_groups(value: str) -> str:
    translated = []
    for group in value.split(";"):
        if group not in GROUP_NAMES:
            raise LocalizationError(f"未知频道分组：{group}")
        translated.append(GROUP_NAMES[group])
    return ";".join(translated)


def _translate_resolution(value: str) -> str:
    match = re.fullmatch(r"(\d+)([pi])", value)
    if not match:
        raise LocalizationError(f"未知清晰度标记：{value}")
    height, scan = match.groups()
    common = {
        ("2160", "p"): "超高清",
        ("1080", "p"): "全高清",
        ("720", "p"): "高清",
    }
    return common.get((height, scan), f"{height}{'逐行' if scan == 'p' else '隔行'}")


def _translated_suffix(title: str) -> str:
    parts = []
    for resolution in re.findall(r"\((\d+[pi])\)", title):
        parts.append(f"（{_translate_resolution(resolution)}）")
    for status in re.findall(r"\[([^]]*)\]", title):
        if status not in STATUS_NAMES:
            raise LocalizationError(f"未知状态标记：{status}")
        parts.append(f"[{STATUS_NAMES[status]}]")
    return "".join(parts)


def _assert_chinese_visible(value: str, context: str) -> None:
    value_without_allowed_brand = value.replace("CCTV", "")
    if ASCII_LETTER.search(value_without_allowed_brand):
        raise LocalizationError(f"{context}仍包含英文字母：{value}")


def localize_playlist(
    m3u_text: str,
    channels: Iterable[dict],
    names: Mapping[str, str],
) -> str:
    if not m3u_text.startswith("#EXTM3U"):
        raise LocalizationError("上游内容不是有效的 M3U 播放列表")

    indexed_channels = _channel_index(channels)
    output = []
    entry_count = 0
    for line in m3u_text.splitlines():
        if line.startswith("#EXTM3U"):
            output.append(f'#EXTM3U url-tvg="{EPG_URL}"')
            continue
        if not line.startswith("#EXTINF"):
            output.append(line)
            continue

        id_match = re.search(r'tvg-id="([^"]+)"', line)
        group_match = re.search(r'group-title="([^"]+)"', line)
        if not id_match or not group_match or "," not in line:
            raise LocalizationError(f"无法解析频道条目：{line}")

        feed_id = id_match.group(1)
        channel_id = feed_id.split("@", 1)[0]
        chinese_name = names.get(channel_id) or _chinese_alias(
            indexed_channels.get(channel_id, {})
        )
        if not chinese_name:
            raise LocalizationError(f"频道缺少中文名称：{channel_id}")
        _assert_chinese_visible(chinese_name, channel_id)

        attributes, upstream_title = line.rsplit(",", 1)
        chinese_group = (
            "CCTV"
            if channel_id.startswith("CCTV")
            else _translate_groups(group_match.group(1))
        )
        _assert_chinese_visible(chinese_group, f"{channel_id} 分组")
        attributes = re.sub(
            r'group-title="[^"]+"',
            f'group-title="{chinese_group}"',
            attributes,
        )
        chinese_title = chinese_name + _translated_suffix(upstream_title)
        _assert_chinese_visible(chinese_title, channel_id)
        output.append(f"{attributes},{chinese_title}")
        entry_count += 1

    if entry_count == 0:
        raise LocalizationError("上游播放列表没有频道条目")
    return "\n".join(output) + "\n"


def write_localized_playlist(
    m3u_text: str,
    channels: Iterable[dict],
    names: Mapping[str, str],
    output_path: Path,
) -> None:
    localized = localize_playlist(m3u_text, channels, names)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    temporary.write_text(localized, encoding="utf-8")
    os.replace(temporary, output_path)


def _download_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "zaxiang-iptv-updater"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def main() -> None:
    directory = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="更新 IPTV 中文频道订阅")
    parser.add_argument("--source-url", default=SOURCE_URL)
    parser.add_argument("--channels-url", default=CHANNELS_URL)
    parser.add_argument("--names", type=Path, default=directory / "channel_names_zh.json")
    parser.add_argument("--output", type=Path, default=directory / "zho.m3u")
    args = parser.parse_args()

    m3u_text = _download_text(args.source_url)
    channels = json.loads(_download_text(args.channels_url))
    names = json.loads(args.names.read_text(encoding="utf-8"))
    write_localized_playlist(m3u_text, channels, names, args.output)


if __name__ == "__main__":
    main()
