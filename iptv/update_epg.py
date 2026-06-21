#!/usr/bin/env python3
"""Build a Chinese XMLTV guide matched to the published IPTV playlist."""

import argparse
import copy
import gzip
import os
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence, Tuple


HAN_CHARACTER = re.compile(r"[\u3400-\u9fff]")
ASCII_LETTER = re.compile(r"[A-Za-z]")
SOURCE_CHANNEL_FILES = (
    "sites/tv.cctv.com/tv.cctv.com.channels.xml",
    "sites/nowplayer.now.com/nowplayer.now.com_zh.channels.xml",
    "sites/starhubtvplus.com/starhubtvplus.com_zh.channels.xml",
    "sites/mytvsuper.com/mytvsuper.com_zh.channels.xml",
    "sites/rthk.hk/rthk.hk_zh.channels.xml",
)


class EpgError(RuntimeError):
    """Raised when a safe Chinese EPG cannot be produced."""


def _playlist_channels(path: Path) -> Tuple[Dict[str, str], Mapping[str, List[str]]]:
    names: Dict[str, str] = {}
    by_base: Dict[str, List[str]] = defaultdict(list)
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.startswith("#EXTINF"):
            continue
        match = re.search(r'tvg-id="([^"]+)"', line)
        if not match or "," not in line:
            raise EpgError(f"无法解析播放列表频道：{line}")
        feed_id = match.group(1)
        title = line.rsplit(",", 1)[1]
        title = re.sub(r"（[^）]*）|\[[^]]*\]", "", title).strip()
        names[feed_id] = title
        by_base[feed_id.split("@", 1)[0]].append(feed_id)
    if not names:
        raise EpgError("播放列表中没有频道")
    return names, by_base


def build_channels_config(
    epg_dir: Path,
    playlist_path: Path,
    output_path: Path,
    source_paths: Sequence[str] = SOURCE_CHANNEL_FILES,
) -> int:
    _, playlist_by_base = _playlist_channels(playlist_path)
    output_root = ET.Element("channels")
    selected_bases = set()
    for relative_path in source_paths:
        source_path = epg_dir / relative_path
        if not source_path.exists():
            raise EpgError(f"EPG 数据源配置不存在：{relative_path}")
        for channel in ET.parse(source_path).getroot().findall("channel"):
            xmltv_id = channel.get("xmltv_id", "")
            base_id = xmltv_id.split("@", 1)[0]
            if not channel.get("lang", "").lower().startswith("zh"):
                continue
            if base_id not in playlist_by_base:
                continue
            if base_id in selected_bases:
                continue
            selected_bases.add(base_id)
            output_root.append(copy.deepcopy(channel))
    if not selected_bases:
        raise EpgError("没有找到与播放列表匹配的中文节目单频道")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(output_root).write(output_path, encoding="utf-8", xml_declaration=True)
    return len(selected_bases)


def _safe_chinese_text(element: ET.Element) -> bool:
    text = "".join(element.itertext()).strip()
    return bool(text and HAN_CHARACTER.search(text) and not ASCII_LETTER.search(text))


def _copy_safe_programme(programme: ET.Element, channel_id: str, title: ET.Element) -> ET.Element:
    result = ET.Element("programme", dict(programme.attrib))
    result.set("channel", channel_id)
    clean_title = ET.SubElement(result, "title", {"lang": "zh"})
    clean_title.text = (title.text or "").strip()
    for tag in ("sub-title", "desc", "category", "keyword"):
        for element in programme.findall(tag):
            if _safe_chinese_text(element):
                copied = copy.deepcopy(element)
                copied.set("lang", "zh")
                result.append(copied)
    for tag in ("date", "episode-num", "icon", "previously-shown", "premiere", "new", "live"):
        for element in programme.findall(tag):
            result.append(copy.deepcopy(element))
    return result


def finalize_guide(
    guide_path: Path,
    playlist_path: Path,
    output_path: Path,
    min_programmes: int = 1,
) -> Dict[str, int]:
    playlist_names, playlist_by_base = _playlist_channels(playlist_path)
    source_root = ET.parse(guide_path).getroot()
    programmes: List[ET.Element] = []
    covered_channels = set()
    seen = set()
    dropped_non_chinese = 0

    for programme in source_root.findall("programme"):
        source_id = programme.get("channel", "")
        target_ids = playlist_by_base.get(source_id.split("@", 1)[0], [])
        if not target_ids:
            continue
        title = next(
            (candidate for candidate in programme.findall("title") if _safe_chinese_text(candidate)),
            None,
        )
        if title is None:
            dropped_non_chinese += 1
            continue
        title_text = (title.text or "").strip()
        for target_id in target_ids:
            key = (
                target_id,
                programme.get("start", ""),
                programme.get("stop", ""),
                title_text,
            )
            if key in seen:
                continue
            seen.add(key)
            programmes.append(_copy_safe_programme(programme, target_id, title))
            covered_channels.add(target_id)

    if len(programmes) < min_programmes:
        raise EpgError(
            f"中文节目数量不足：{len(programmes)}，最低要求：{min_programmes}"
        )

    output_root = ET.Element("tv", {"generator-info-name": "中文节目单生成器"})
    for channel_id in sorted(covered_channels):
        channel = ET.SubElement(output_root, "channel", {"id": channel_id})
        display_name = ET.SubElement(channel, "display-name", {"lang": "zh"})
        display_name.text = playlist_names[channel_id]
    programmes.sort(key=lambda item: (item.get("start", ""), item.get("channel", "")))
    output_root.extend(programmes)

    xml_bytes = ET.tostring(output_root, encoding="utf-8", xml_declaration=True)
    compressed = gzip.compress(xml_bytes, compresslevel=9, mtime=0)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    temporary.write_bytes(compressed)
    os.replace(temporary, output_path)
    return {
        "channels": len(covered_channels),
        "programmes": len(programmes),
        "dropped_non_chinese": dropped_non_chinese,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 IPTV 中文节目单")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare", help="生成中文抓取频道配置")
    prepare.add_argument("--epg-dir", type=Path, required=True)
    prepare.add_argument("--playlist", type=Path, required=True)
    prepare.add_argument("--output", type=Path, required=True)

    finalize = subparsers.add_parser("finalize", help="整理并发布中文 XMLTV")
    finalize.add_argument("--guide", type=Path, required=True)
    finalize.add_argument("--playlist", type=Path, required=True)
    finalize.add_argument("--output", type=Path, required=True)
    finalize.add_argument("--min-programmes", type=int, default=100)

    args = parser.parse_args()
    if args.command == "prepare":
        count = build_channels_config(args.epg_dir, args.playlist, args.output)
        print(f"已选择 {count} 个中文节目单抓取配置")
    else:
        stats = finalize_guide(
            args.guide,
            args.playlist,
            args.output,
            min_programmes=args.min_programmes,
        )
        print(
            f"已生成 {stats['channels']} 个频道、{stats['programmes']} 条中文节目，"
            f"过滤 {stats['dropped_non_chinese']} 条非中文节目"
        )


if __name__ == "__main__":
    main()
