import importlib.util
import importlib.machinery
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("服务器使用人数查询")
LOADER = importlib.machinery.SourceFileLoader("snell_usage_query", str(SCRIPT_PATH))
SPEC = importlib.util.spec_from_loader("snell_usage_query", LOADER)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SnellUsageQueryTests(unittest.TestCase):
    def test_location_and_isp_display_are_compact_chinese(self):
        self.assertEqual(MODULE.normalize_location("中国", "河北省", "石家庄市"), "河北石家庄")
        self.assertEqual(MODULE.normalize_location("中国", "上海市", "上海"), "上海")
        self.assertEqual(MODULE.normalize_location("中国", "江西", "Taohua"), "江西")
        self.assertEqual(MODULE.normalize_location("中国", "广东", "UnknownCity"), "广东")
        self.assertEqual(MODULE.normalize_location("美国", "加州", "洛杉矶"), "美国加州洛杉矶")
        self.assertEqual(MODULE.normalize_isp("China Mobile Communications Corporation"), "移动")
        self.assertEqual(MODULE.normalize_isp("CNC Group CHINA169 Hebei Province Network"), "联通")
        self.assertEqual(MODULE.normalize_isp("DMIT Cloud Services"), "DMIT云")
        self.assertEqual(MODULE.normalize_isp("OVH SAS"), "OVH")
        self.assertEqual(MODULE.format_summary_line(("河北石家庄", "电信"), 2), "河北石家庄电信：2")

    def test_china_fallback_location_uses_chinese_ip_database_shape(self):
        data = {"pro": "江西省", "city": "南昌市", "addr": "江西省南昌市 电信"}

        self.assertTrue(MODULE.needs_china_location_fallback("中国", "江西", "Taohua"))
        self.assertEqual(MODULE.normalize_pconline_location(data), "江西南昌")

    def test_ufw_block_commands_use_insert_before_allow_rules(self):
        commands = MODULE.build_block_commands("1.2.3.4", "49376", "ufw")

        self.assertEqual(
            commands,
            [
                ["ufw", "--force", "insert", "1", "deny", "from", "1.2.3.4", "to", "any", "port", "49376", "proto", "tcp"],
                ["ufw", "--force", "insert", "1", "deny", "from", "1.2.3.4", "to", "any", "port", "49376", "proto", "udp"],
            ],
        )

    def test_block_menu_lines_include_ip_for_precise_selection(self):
        details = {
            "111.227.67.210": {"location": "河北石家庄", "isp": "电信", "connections": 31},
            "112.22.88.74": {"location": "江苏无锡", "isp": "移动", "connections": 8},
        }

        lines = MODULE.format_block_menu_lines(details)

        self.assertEqual(
            lines,
            [
                "1. 河北石家庄电信 111.227.67.210 当前连接数：31",
                "2. 江苏无锡移动 112.22.88.74 当前连接数：8",
            ],
        )

    def test_query_detail_lines_reuse_precise_ip_display(self):
        details = {
            "111.227.67.210": {"location": "河北石家庄", "isp": "电信", "connections": 31},
            "106.119.211.135": {"location": "河北石家庄", "isp": "电信", "connections": 7},
            "112.22.88.74": {"location": "江苏无锡", "isp": "移动", "connections": 8},
        }

        self.assertEqual(
            MODULE.format_query_detail_lines(details),
            [
                "河北石家庄电信 111.227.67.210 当前连接数：31",
                "江苏无锡移动 112.22.88.74 当前连接数：8",
                "河北石家庄电信 106.119.211.135 当前连接数：7",
            ],
        )

    def test_parse_ufw_denies_groups_tcp_and_udp_by_ip(self):
        output = """
Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 49376/tcp                  DENY IN     1.2.3.4
[ 2] 49376/udp                  DENY IN     1.2.3.4
[ 3] 49376/tcp                  DENY IN     5.6.7.8
[ 4] 443/tcp                    ALLOW IN    Anywhere
"""

        self.assertEqual(
            MODULE.parse_ufw_denies(output, "49376"),
            {
                "1.2.3.4": {"rules": [1, 2], "protocols": ["tcp", "udp"]},
                "5.6.7.8": {"rules": [3], "protocols": ["tcp"]},
            },
        )

    def test_ufw_unblock_deletes_numbered_rules_descending(self):
        commands = MODULE.build_unblock_commands({"rules": [1, 2], "protocols": ["tcp", "udp"]}, "ufw")

        self.assertEqual(commands, [["ufw", "--force", "delete", "2"], ["ufw", "--force", "delete", "1"]])

    def test_alias_line_uses_current_script_path(self):
        self.assertEqual(
            MODULE.build_alias_line("/root/服务器使用人数查询", "c"),
            "alias c='/root/服务器使用人数查询'",
        )

    def test_append_alias_once_does_not_duplicate(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            profile = Path(temp_dir) / ".bashrc"

            self.assertTrue(MODULE.append_alias_once(str(profile), "/root/服务器使用人数查询", "c"))
            self.assertFalse(MODULE.append_alias_once(str(profile), "/root/服务器使用人数查询", "c"))

            self.assertEqual(profile.read_text(encoding="utf-8").count("alias c="), 1)

    def test_build_shortcut_wrapper_runs_script(self):
        self.assertEqual(
            MODULE.build_shortcut_wrapper("/root/服务器使用人数查询"),
            "#!/bin/sh\nexec '/root/服务器使用人数查询' \"$@\"\n",
        )

    def test_install_shortcut_command_skips_when_unchanged(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            shortcut = Path(temp_dir) / "c"

            self.assertTrue(MODULE.install_shortcut_command("/root/服务器使用人数查询", str(shortcut)))
            self.assertFalse(MODULE.install_shortcut_command("/root/服务器使用人数查询", str(shortcut)))


if __name__ == "__main__":
    unittest.main()
