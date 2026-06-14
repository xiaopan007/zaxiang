#!/usr/bin/env python3
import base64
import json
import os
import platform
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


SCRIPT_COMMIT_API_URL = "https://api.github.com/repos/xiaopan007/zaxiang/commits/main"
SCRIPT_RAW_URL_TEMPLATE = "https://raw.githubusercontent.com/xiaopan007/zaxiang/{sha}/cookie-fetch.py"


SERVICES = {
    "1": {
        "name": "什么值得买",
        "login_url": "https://zhiyou.smzdm.com/user/login",
        "cookie_domains": ["smzdm.com"],
        "env_key": "SMZDM_COOKIE",
        "env_comment": "#下方是什么值得买的COOKIE",
        "important_cookie_names": ["sess", "user", "smzdm_id"],
        "login_hint": "",
    },
    "2": {
        "name": "知乎",
        "login_url": "https://www.zhihu.com/signin?next=%2F",
        "cookie_domains": ["zhihu.com"],
        "env_key": "ZHIHU_COOKIES",
        "env_comment": "#下方是知乎的COOKIE",
        "important_cookie_names": ["z_c0", "d_c0"],
        "login_hint": "",
    },
    "3": {
        "name": "小红书",
        "login_url": "https://www.xiaohongshu.com/explore",
        "cookie_domains": ["xiaohongshu.com"],
        "env_key": "XIAOHONGSHU_COOKIE",
        "env_comment": "#下方是小红书的COOKIE",
        "important_cookie_names": ["web_session"],
        "login_hint": "如果页面没有自动弹出登录框，请在网页右上角手动点击登录。",
    },
    "4": {
        "name": "微博",
        "login_url": "https://passport.weibo.cn/signin/login?entry=mweibo&r=https%3A%2F%2Fm.weibo.cn%2F",
        "cookie_domains": ["weibo.cn"],
        "env_key": "WEIBO_COOKIES",
        "env_comment": "#下方是微博的COOKIE",
        "important_cookie_names": ["SUB"],
        "login_hint": "不用下载微博 App；请在移动网页版完成登录，登录后能打开 m.weibo.cn 即可。",
    },
    "5": {
        "name": "Twitter / X",
        "login_url": "https://x.com/i/flow/login",
        "cookie_domains": ["x.com", "twitter.com"],
        "env_key": "TWITTER_AUTH_TOKEN",
        "env_comment": "#下方是Twitter/X的AUTH_TOKEN",
        "important_cookie_names": ["auth_token"],
        "value_cookie_name": "auth_token",
        "login_hint": "请确认网页已经显示登录后的 X/Twitter 首页，再回到此窗口按回车。",
    },
}


def update_env_content(content, env_key, env_comment, cookie_value):
    lines = content.splitlines(keepends=True)
    replacement = f"{env_key}={cookie_value}\n"
    changed = False
    updated = []

    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith(f"{env_key}=") and not stripped.startswith("#"):
            updated.append(replacement)
            changed = True
        else:
            updated.append(line)

    if changed:
        return "".join(updated)

    result = "".join(updated)
    if result and not result.endswith("\n"):
        result += "\n"
    if result:
        result += "\n"
    result += f"{env_comment}\n{replacement}"
    return result


def choose_service():
    print("请选择要获取登录凭证的网站：")
    for key in sorted(SERVICES):
        print(f"{key}. {SERVICES[key]['name']}")
    print("0. 退出")
    print("00. 更新脚本")

    choice = input("请输入序号后回车（0 退出，00 更新脚本）：").strip()
    if choice == "0":
        clear_screen()
        sys.exit(0)
    if choice == "00":
        update_script()
        sys.exit(0)
    if choice not in SERVICES:
        raise RuntimeError("选择无效，请输入 0、00、" + "、".join(sorted(SERVICES)) + "。")
    return SERVICES[choice]


def update_script():
    script_path = Path(__file__).resolve()
    request = urllib.request.Request(
        SCRIPT_COMMIT_API_URL,
        headers={"User-Agent": "cookie-fetch-updater"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.loads(response.read().decode("utf-8"))
    update_url = SCRIPT_RAW_URL_TEMPLATE.format(sha=data["sha"])
    with urllib.request.urlopen(update_url, timeout=30) as response:
        content = response.read()
    if not content.startswith(b"#!/usr/bin/env python3"):
        raise RuntimeError("更新失败：下载到的内容不是脚本。")
    script_path.write_bytes(content)
    os.chmod(script_path, script_path.stat().st_mode | 0o700)
    print(f"已更新脚本：{script_path}")
    input("更新完成，请重新运行脚本。按回车退出。")


def clear_screen():
    if platform.system() == "Windows":
        os.system("cls")
    else:
        sys.stdout.write("\033[2J\033[H")
        sys.stdout.flush()


def find_browser():
    system = platform.system()
    candidates = []

    if system == "Darwin":
        candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
    elif system == "Windows":
        roots = [
            os.environ.get("PROGRAMFILES"),
            os.environ.get("PROGRAMFILES(X86)"),
            os.environ.get("LOCALAPPDATA"),
        ]
        names = [
            r"Google\Chrome\Application\chrome.exe",
            r"Microsoft\Edge\Application\msedge.exe",
            r"Chromium\Application\chrome.exe",
        ]
        candidates = [str(Path(root) / name) for root in roots if root for name in names]
    else:
        for name in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]:
            path = shutil.which(name)
            if path:
                candidates.append(path)

    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate

    raise RuntimeError("没有找到 Chrome / Edge / Chromium。请先安装其中一个浏览器后再运行。")


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for_json(url, timeout=20):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            time.sleep(0.2)
    raise RuntimeError(f"浏览器调试接口没有启动：{last_error}")


class DevToolsWebSocket:
    def __init__(self, websocket_url):
        parsed = urllib.parse.urlparse(websocket_url)
        self.host = parsed.hostname
        self.port = parsed.port or 80
        self.path = parsed.path
        if parsed.query:
            self.path += "?" + parsed.query
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        self.next_id = 1
        self._handshake()

    def _handshake(self):
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        self.sock.sendall(request.encode("ascii"))
        response = b""
        while b"\r\n\r\n" not in response:
            response += self.sock.recv(4096)
        if b" 101 " not in response.split(b"\r\n", 1)[0]:
            raise RuntimeError("无法连接浏览器 DevTools WebSocket。")

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass

    def send_json(self, payload):
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        header = bytearray([0x81])
        length = len(data)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        mask = os.urandom(4)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        self.sock.sendall(bytes(header) + mask + masked)

    def recv_json(self):
        while True:
            first = self.sock.recv(2)
            if len(first) < 2:
                raise RuntimeError("浏览器 DevTools WebSocket 已断开。")
            opcode = first[0] & 0x0F
            length = first[1] & 0x7F
            masked = first[1] & 0x80
            if length == 126:
                length = struct.unpack("!H", self._recv_exact(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._recv_exact(8))[0]
            mask = self._recv_exact(4) if masked else b""
            payload = self._recv_exact(length)
            if masked:
                payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
            if opcode == 8:
                raise RuntimeError("浏览器 DevTools WebSocket 已关闭。")
            if opcode in (1, 2):
                return json.loads(payload.decode("utf-8"))

    def _recv_exact(self, length):
        data = b""
        while len(data) < length:
            chunk = self.sock.recv(length - len(data))
            if not chunk:
                raise RuntimeError("浏览器 DevTools WebSocket 已断开。")
            data += chunk
        return data

    def call(self, method, params=None, timeout=10):
        message_id = self.next_id
        self.next_id += 1
        self.send_json({"id": message_id, "method": method, "params": params or {}})
        deadline = time.time() + timeout
        while time.time() < deadline:
            message = self.recv_json()
            if message.get("id") == message_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message.get("result", {})
        raise RuntimeError(f"调用 DevTools 方法超时：{method}")


def page_websocket_url(port):
    targets = wait_for_json(f"http://127.0.0.1:{port}/json", timeout=20)
    for target in targets:
        if target.get("type") == "page" and target.get("webSocketDebuggerUrl"):
            return target["webSocketDebuggerUrl"]
    raise RuntimeError("没有找到可读取 cookie 的浏览器页面。")


def collect_service_cookie(port, service):
    websocket = DevToolsWebSocket(page_websocket_url(port))
    try:
        result = websocket.call("Network.getAllCookies")
    finally:
        websocket.close()

    domains = service["cookie_domains"]
    cookies = [
        cookie
        for cookie in result.get("cookies", [])
        if any(domain in cookie.get("domain", "") for domain in domains)
    ]
    if not cookies:
        domains_text = "、".join(domains)
        raise RuntimeError(f"没有读取到 {domains_text} 的 cookie。请确认已经在打开的浏览器窗口里完成登录。")

    cookies.sort(key=lambda c: (c.get("domain", ""), c.get("path", ""), c.get("name", "")))
    found_names = {cookie.get("name", "") for cookie in cookies}
    missing_important = [name for name in service["important_cookie_names"] if name not in found_names]

    value_cookie_name = service.get("value_cookie_name")
    if value_cookie_name:
        for cookie in cookies:
            if cookie.get("name") == value_cookie_name:
                return cookie["value"], missing_important
        raise RuntimeError(f"没有读取到 {value_cookie_name}。请确认已经在打开的浏览器窗口里完成登录。")

    cookie_value = "; ".join(f"{cookie['name']}={cookie['value']}" for cookie in cookies)
    return cookie_value, missing_important


def write_cookie_to_env(service, cookie_value):
    env_path = Path.home() / ".env"
    original = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    env_path.write_text(
        update_env_content(original, service["env_key"], service["env_comment"], cookie_value),
        encoding="utf-8",
    )
    return env_path


def launch_browser(browser_path, port, user_data_dir, login_url):
    command = [
        browser_path,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={user_data_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        login_url,
    ]
    return subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    service = choose_service()
    browser_path = find_browser()
    port = free_port()
    with tempfile.TemporaryDirectory(prefix="rsshub-cookie-browser-") as profile_dir:
        process = launch_browser(browser_path, port, profile_dir, service["login_url"])
        try:
            wait_for_json(f"http://127.0.0.1:{port}/json/version", timeout=20)
            print(f"已打开{service['name']}登录页。")
            if service["login_hint"]:
                print(service["login_hint"])
            print("请在打开的浏览器窗口中完成登录，登录成功后回到此窗口按回车。")
            input()

            cookie_value, missing_important = collect_service_cookie(port, service)
            env_path = write_cookie_to_env(service, cookie_value)
            print(f"已更新：{env_path}")
            print(f"{service['env_key']} 已替换或新增。")
            if missing_important:
                print(
                    "提醒：没有检测到关键登录字段 "
                    + "、".join(missing_important)
                    + "。如果 RSSHub 仍提示未登录，请重新运行并确认网页已经显示登录状态。"
                )
        finally:
            try:
                process.terminate()
                process.wait(timeout=5)
            except Exception:
                process.kill()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已取消。", file=sys.stderr)
        sys.exit(130)
    except Exception as exc:
        print(f"错误：{exc}", file=sys.stderr)
        sys.exit(1)
