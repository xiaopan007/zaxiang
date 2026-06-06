import importlib.util
import importlib.machinery
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock
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

    def test_query_ip_details_prints_screen_title_before_details(self):
        output = io.StringIO()

        with mock.patch.object(MODULE, "print_summary") as print_summary, \
            mock.patch.object(MODULE, "wait_return"), \
            redirect_stdout(output):
            MODULE.query_ip_details("49376")

        print_summary.assert_called_once_with("49376")
        self.assertTrue(output.getvalue().startswith("查询 IP 连接情况\n\n"))

    def test_filter_blocked_ip_details_hides_already_blocked_users(self):
        details = {
            "1.2.3.4": {"location": "河北石家庄", "isp": "电信", "connections": 31},
            "5.6.7.8": {"location": "江苏无锡", "isp": "移动", "connections": 8},
        }
        blocked = {"1.2.3.4": {"rules": [1, 2], "protocols": ["tcp", "udp"]}}

        self.assertEqual(MODULE.filter_blocked_ip_details(details, blocked), {"5.6.7.8": details["5.6.7.8"]})

    def test_conntrack_cleanup_commands_are_limited_to_selected_ip_and_port(self):
        commands = MODULE.build_conntrack_cleanup_commands("1.2.3.4", "49376")

        self.assertEqual(
            commands,
            [
                ["conntrack", "-D", "-s", "1.2.3.4", "-p", "tcp", "--dport", "49376"],
                ["conntrack", "-D", "-s", "1.2.3.4", "-p", "udp", "--dport", "49376"],
            ],
        )

    def test_block_menu_blocks_without_confirmation_and_refreshes_list(self):
        first_details = {
            "1.2.3.4": {"location": "河北石家庄", "isp": "电信", "connections": 31},
            "5.6.7.8": {"location": "江苏无锡", "isp": "移动", "connections": 8},
        }
        second_details = {"5.6.7.8": first_details["5.6.7.8"]}
        output = io.StringIO()

        with mock.patch.object(MODULE, "get_visible_ip_details", side_effect=[first_details, second_details]), \
            mock.patch.object(MODULE, "run_block_commands", return_value=(True, "已封禁：1.2.3.4")) as run_block, \
            mock.patch.object(MODULE, "refresh_screen"), \
            mock.patch.object(MODULE.time, "sleep"), \
            mock.patch("builtins.input", side_effect=["1", "0"]), \
            redirect_stdout(output):
            MODULE.block_by_ip("49376")

        run_block.assert_called_once_with("1.2.3.4", "49376")
        self.assertNotIn("确认封禁", output.getvalue())
        self.assertIn("1. 河北石家庄电信 1.2.3.4 当前连接数：31", output.getvalue())
        self.assertIn("1. 江苏无锡移动 5.6.7.8 当前连接数：8", output.getvalue())

    def test_unblock_menu_unblocks_without_confirmation_and_refreshes_list(self):
        first_blocked = {
            "1.2.3.4": {"rules": [1, 2], "protocols": ["tcp", "udp"]},
            "5.6.7.8": {"rules": [3], "protocols": ["tcp"]},
        }
        second_blocked = {"5.6.7.8": first_blocked["5.6.7.8"]}
        active_details = {
            "1.2.3.4": {"location": "河北石家庄", "isp": "电信", "connections": 31},
            "5.6.7.8": {"location": "江苏无锡", "isp": "移动", "connections": 8},
        }
        output = io.StringIO()

        with mock.patch.object(MODULE, "get_blocked_ip_entries", side_effect=[first_blocked, second_blocked]), \
            mock.patch.object(MODULE, "get_active_ip_details", return_value=active_details), \
            mock.patch.object(MODULE, "run_unblock_commands", return_value=(True, "已解除封禁")) as run_unblock, \
            mock.patch.object(MODULE, "refresh_screen"), \
            mock.patch.object(MODULE.time, "sleep"), \
            mock.patch("builtins.input", side_effect=["1", "0"]), \
            redirect_stdout(output):
            MODULE.unblock_by_ip("49376")

        run_unblock.assert_called_once_with(first_blocked["1.2.3.4"])
        self.assertNotIn("确认解除封禁", output.getvalue())
        self.assertIn("1. 河北石家庄电信 1.2.3.4 已封禁协议：tcp/udp", output.getvalue())
        self.assertIn("1. 江苏无锡移动 5.6.7.8 已封禁协议：tcp", output.getvalue())

    def test_unblock_menu_looks_up_location_for_inactive_blocked_ips(self):
        blocked = {"1.2.3.4": {"rules": [1, 2], "protocols": ["tcp", "udp"]}}
        output = io.StringIO()

        with mock.patch.object(MODULE, "get_blocked_ip_entries", return_value=blocked), \
            mock.patch.object(MODULE, "get_active_ip_details", return_value={}), \
            mock.patch.object(MODULE, "lookup_location_and_isp", return_value=("广东广州", "移动")) as lookup, \
            mock.patch("builtins.input", return_value="0"), \
            redirect_stdout(output):
            MODULE.unblock_by_ip("49376")

        lookup.assert_called_once_with("1.2.3.4")
        self.assertIn("1. 广东广州移动 1.2.3.4 已封禁协议：tcp/udp", output.getvalue())

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

    def test_self_update_reports_latest_when_download_matches_current_script(self):
        class FakeResponse:
            def __init__(self, data):
                self.data = data

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return self.data

        with tempfile.TemporaryDirectory() as temp_dir:
            script = Path(temp_dir) / "服务器使用人数查询"
            script.write_bytes(b"#!/usr/bin/env python3\nprint('same')\n")
            output = io.StringIO()

            with mock.patch.object(MODULE.sys, "argv", [str(script)]), \
                mock.patch.object(MODULE.urllib.request, "urlopen", return_value=FakeResponse(script.read_bytes())), \
                mock.patch.object(MODULE.os, "execv") as execv, \
                redirect_stdout(output):
                result = MODULE.self_update()

            self.assertEqual(result, MODULE.UPDATE_ALREADY_LATEST)
            self.assertEqual(output.getvalue().strip(), "当前已是最新版本")
            execv.assert_not_called()
            self.assertFalse(Path(str(script) + ".new").exists())

    def test_self_update_pauses_before_restart_after_successful_update(self):
        class FakeResponse:
            def __init__(self, data):
                self.data = data

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self):
                return self.data

        with tempfile.TemporaryDirectory() as temp_dir:
            script = Path(temp_dir) / "服务器使用人数查询"
            script.write_bytes(b"old")
            output = io.StringIO()

            with mock.patch.object(MODULE.sys, "argv", [str(script)]), \
                mock.patch.object(MODULE.urllib.request, "urlopen", return_value=FakeResponse(b"new")), \
                mock.patch.object(MODULE.time, "sleep") as sleep, \
                mock.patch.object(MODULE, "refresh_screen") as refresh, \
                mock.patch.object(MODULE.os, "execv") as execv, \
                redirect_stdout(output):
                result = MODULE.self_update()

            self.assertEqual(result, MODULE.UPDATE_RESTARTED)
            self.assertEqual(script.read_bytes(), b"new")
            self.assertIn("更新完成，正在重新启动脚本...", output.getvalue())
            sleep.assert_called_once_with(1)
            refresh.assert_called_once()
            self.assertEqual(MODULE.os.environ.get("SNELL_QUERY_CLEAR_ON_START"), "1")
            execv.assert_called_once_with(str(script), [str(script)])

    def test_main_clears_screen_after_update_restart_marker(self):
        with mock.patch.dict(MODULE.os.environ, {"SNELL_QUERY_CLEAR_ON_START": "1"}, clear=False), \
            mock.patch.object(MODULE, "get_snell_port", return_value="49376"), \
            mock.patch.object(MODULE.sys.stdin, "isatty", return_value=True), \
            mock.patch.object(MODULE, "ensure_shortcut_installed"), \
            mock.patch.object(MODULE, "refresh_screen") as refresh, \
            mock.patch.object(MODULE, "show_menu", return_value=0) as show_menu:
            result = MODULE.main()

        self.assertEqual(result, 0)
        refresh.assert_called_once()
        show_menu.assert_called_once_with("49376")
        self.assertNotIn("SNELL_QUERY_CLEAR_ON_START", MODULE.os.environ)

    def test_source_key_ignores_ip_and_uses_location_and_isp(self):
        self.assertEqual(MODULE.build_source_key("河北石家庄", "电信"), "河北石家庄|电信")

    def test_scan_new_source_notification_initializes_existing_sources_silently(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            state_path = Path(temp_dir) / "state.json"
            MODULE.save_monitor_config(
                str(config_path),
                {
                    "server_name": "香港中转1",
                    "telegram_bot_token": "token",
                    "telegram_chat_id": "chat",
                    "scan_interval": 60,
                },
            )
            details = {
                "1.1.1.1": {"location": "河北石家庄", "isp": "电信", "connections": 1},
                "2.2.2.2": {"location": "河北石家庄", "isp": "联通", "connections": 1},
            }

            with mock.patch.object(MODULE, "get_active_ip_details", return_value=details), \
                mock.patch.object(MODULE, "send_telegram_message") as send:
                ok, message = MODULE.scan_new_source_notifications("49376", str(config_path), str(state_path))

            self.assertTrue(ok)
            self.assertEqual(message, "已初始化当前来源")
            send.assert_not_called()
            state = MODULE.load_monitor_state(str(state_path))
            self.assertIn("河北石家庄|电信", state["seen_sources"])
            self.assertIn("河北石家庄|联通", state["seen_sources"])

    def test_scan_new_source_notification_sends_only_new_location_and_isp_sources(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            state_path = Path(temp_dir) / "state.json"
            MODULE.save_monitor_config(
                str(config_path),
                {
                    "server_name": "香港中转1",
                    "telegram_bot_token": "token",
                    "telegram_chat_id": "chat",
                    "scan_interval": 60,
                },
            )
            MODULE.save_monitor_state(
                str(state_path),
                {
                    "initialized": True,
                    "seen_sources": {
                        "河北石家庄|电信": {
                            "location": "河北石家庄",
                            "isp": "电信",
                            "first_seen_at": "2026-06-05 22:00:00",
                            "last_seen_at": "2026-06-05 22:00:00",
                            "seen_count": 1,
                        }
                    },
                },
            )
            details = {
                "1.1.1.1": {"location": "河北石家庄", "isp": "电信", "connections": 1},
                "2.2.2.2": {"location": "河北石家庄", "isp": "联通", "connections": 1},
            }

            with mock.patch.object(MODULE, "get_active_ip_details", return_value=details), \
                mock.patch.object(MODULE, "send_telegram_message", return_value=(True, "已发送")) as send:
                ok, message = MODULE.scan_new_source_notifications("49376", str(config_path), str(state_path))

            self.assertTrue(ok)
            self.assertEqual(message, "已发送新来源通知")
            send.assert_called_once_with("token", "chat", "香港中转1 有新的 河北石家庄联通 加入")

    def test_enable_new_source_monitor_blank_telegram_clears_config_and_disables_notification(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            state_path = Path(temp_dir) / "state.json"

            with mock.patch.object(MODULE, "MONITOR_CONFIG_PATH", str(config_path)), \
                mock.patch.object(MODULE, "MONITOR_STATE_PATH", str(state_path)), \
                mock.patch.object(MODULE, "disable_monitor_timer", return_value=(True, "自动扫描已关闭。")) as disable, \
                mock.patch.object(MODULE, "scan_new_source_notifications") as scan, \
                mock.patch.object(MODULE, "install_monitor_timer") as install:
                ok, message = MODULE.enable_new_source_monitor("49376", "家宽", "", "", 60)

            self.assertTrue(ok)
            self.assertEqual(message, "未填写 Telegram 信息，已关闭通知。")
            disable.assert_called_once()
            scan.assert_not_called()
            install.assert_not_called()
            config = MODULE.load_monitor_config(str(config_path))
            self.assertEqual(config["server_name"], "家宽")
            self.assertEqual(config["telegram_bot_token"], "")
            self.assertEqual(config["telegram_chat_id"], "")
            self.assertEqual(config["scan_interval"], 60)

    def test_new_source_menu_uses_fixed_options_and_collects_enable_inputs_separately(self):
        output = io.StringIO()

        with mock.patch.object(MODULE, "is_monitor_enabled", return_value=False), \
            mock.patch.object(MODULE, "enable_new_source_monitor", return_value=(True, "自动扫描已开启。")) as enable, \
            mock.patch.object(MODULE, "refresh_screen"), \
            mock.patch("builtins.input", side_effect=["1", "香港中转1", "token", "chat", "", "0", "0"]), \
            redirect_stdout(output):
            MODULE.new_source_notify_menu("49376")

        enable.assert_called_once_with("49376", "香港中转1", "token", "chat", 60)
        text = output.getvalue()
        self.assertIn("当前状态：已关闭", text)
        self.assertIn("1. 开启自动扫描", text)
        self.assertIn("2. 关闭自动扫描", text)
        self.assertIn("正在开启自动扫描...", text)

    def test_new_source_menu_allows_blank_telegram_inputs_to_disable_notification(self):
        output = io.StringIO()

        with mock.patch.object(MODULE, "is_monitor_enabled", return_value=True), \
            mock.patch.object(MODULE, "enable_new_source_monitor", return_value=(True, "未填写 Telegram 信息，已关闭通知。")) as enable, \
            mock.patch.object(MODULE, "refresh_screen"), \
            mock.patch("builtins.input", side_effect=["1", "家宽", "", "", "", "0", "0"]), \
            redirect_stdout(output):
            MODULE.new_source_notify_menu("49376")

        enable.assert_called_once_with("49376", "家宽", "", "", 60)
        self.assertIn("未填写 Telegram 信息，已关闭通知。", output.getvalue())

    def test_refresh_screen_uses_clear_when_terminal_supports_it(self):
        class FakeTTY(io.StringIO):
            def isatty(self):
                return True

        output = FakeTTY()

        with mock.patch.object(MODULE.sys, "stdout", output), \
            mock.patch.dict(MODULE.os.environ, {"TERM": "xterm"}, clear=False), \
            mock.patch.object(MODULE.shutil, "which", return_value="/usr/bin/clear"), \
            mock.patch.object(MODULE.subprocess, "call") as call:
            MODULE.refresh_screen()

        call.assert_called_once_with(["clear"], stderr=MODULE.subprocess.DEVNULL)

    def test_clear_screen_on_exit_uses_clear_when_terminal_supports_it(self):
        class FakeTTY(io.StringIO):
            def isatty(self):
                return True

        output = FakeTTY()

        with mock.patch.object(MODULE.sys, "stdout", output), \
            mock.patch.dict(MODULE.os.environ, {"TERM": "xterm"}, clear=False), \
            mock.patch.object(MODULE.shutil, "which", return_value="/usr/bin/clear"), \
            mock.patch.object(MODULE.subprocess, "call") as call:
            MODULE.clear_screen_on_exit()

        call.assert_called_once_with(["clear"], stderr=MODULE.subprocess.DEVNULL)

    def test_main_menu_exit_clears_screen(self):
        output = io.StringIO()

        with mock.patch.object(MODULE, "clear_screen_on_exit") as clear, \
            mock.patch("builtins.input", return_value="0"), \
            redirect_stdout(output):
            result = MODULE.show_menu("49376")

        self.assertEqual(result, 0)
        clear.assert_called_once()

    def test_main_menu_returns_immediately_after_latest_update_check(self):
        output = io.StringIO()

        with mock.patch.object(MODULE, "self_update", return_value=MODULE.UPDATE_ALREADY_LATEST) as update, \
            mock.patch.object(MODULE, "refresh_screen"), \
            mock.patch.object(MODULE, "wait_return") as wait_return, \
            mock.patch.object(MODULE.time, "sleep") as sleep, \
            mock.patch.object(MODULE, "clear_screen_on_exit") as clear, \
            mock.patch("builtins.input", side_effect=["00", "0"]), \
            redirect_stdout(output):
            result = MODULE.show_menu("49376")

        self.assertEqual(result, 0)
        update.assert_called_once()
        wait_return.assert_not_called()
        sleep.assert_called_once_with(1)
        clear.assert_called_once()


if __name__ == "__main__":
    unittest.main()
