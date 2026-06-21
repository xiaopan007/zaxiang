import tempfile
import unittest
from pathlib import Path

from iptv.update_zh_iptv import (
    LocalizationError,
    localize_playlist,
    write_localized_playlist,
)


SAMPLE = """#EXTM3U
#EXTINF:-1 tvg-id="CCTV1.cn@HD" tvg-logo="https://img.example/cctv.png" group-title="General;News",CCTV-1 (1080p) [Geo-blocked]
https://stream.example/live/cctv1.m3u8
"""


class LocalizePlaylistTests(unittest.TestCase):
    def test_localizes_visible_fields_and_preserves_technical_fields(self):
        result = localize_playlist(
            SAMPLE,
            channels={},
            names={"CCTV1.cn": "CCTV-1 综合频道"},
        )

        self.assertIn('tvg-id="CCTV1.cn@HD"', result)
        self.assertIn('tvg-logo="https://img.example/cctv.png"', result)
        self.assertIn('group-title="CCTV"', result)
        self.assertIn(',CCTV-1 综合频道（全高清）[有地区限制]', result)
        self.assertIn("https://stream.example/live/cctv1.m3u8", result)

    def test_uses_database_chinese_alias_when_curated_name_is_absent(self):
        source = SAMPLE.replace("CCTV1.cn@HD", "AnhuiMovie.cn@SD")
        channels = {"AnhuiMovie.cn": {"alt_names": ["Anhui Movie", "安徽影视"]}}

        result = localize_playlist(source, channels=channels, names={})

        self.assertIn(",安徽影视（全高清）[有地区限制]", result)

    def test_rejects_channel_without_chinese_name(self):
        with self.assertRaisesRegex(LocalizationError, "CCTV1.cn"):
            localize_playlist(SAMPLE, channels={}, names={})

    def test_ignores_upstream_alias_parentheses_and_keeps_resolution(self):
        source = SAMPLE.replace(
            "CCTV-1 (1080p) [Geo-blocked]",
            "CTi Variety (中天綜合台) (720p)",
        ).replace("CCTV1.cn@HD", "CTiVariety.tw@SD")

        result = localize_playlist(
            source,
            channels={},
            names={"CTiVariety.tw": "中天综合台"},
        )

        self.assertIn(",中天综合台（高清）", result)

    def test_rejects_english_other_than_cctv_brand(self):
        with self.assertRaisesRegex(LocalizationError, "英文字母"):
            localize_playlist(
                SAMPLE,
                channels={},
                names={"CCTV1.cn": "CCTV News频道"},
            )

    def test_failed_localization_does_not_replace_published_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "zho.m3u"
            output.write_text("旧订阅\n", encoding="utf-8")

            with self.assertRaises(LocalizationError):
                write_localized_playlist(SAMPLE, {}, {}, output)

            self.assertEqual(output.read_text(encoding="utf-8"), "旧订阅\n")


if __name__ == "__main__":
    unittest.main()
