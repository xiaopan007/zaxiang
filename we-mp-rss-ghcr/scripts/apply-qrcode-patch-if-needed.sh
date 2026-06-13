#!/usr/bin/env bash
set -euo pipefail

repo_dir="${1:-.}"
patch_file="${2:-we-mp-rss-ghcr/patches/wx-qrcode.patch}"
wx_file="$repo_dir/driver/wx.py"

if [[ ! -f "$wx_file" ]]; then
  echo "ERROR: $wx_file not found" >&2
  exit 1
fi

has_domcontentloaded=0
has_wait_for_selector=0
has_login_guard=0

grep -q 'wait_for_load_state("domcontentloaded"' "$wx_file" && has_domcontentloaded=1
grep -q 'wait_for_selector(qr_tag, state="visible"' "$wx_file" && has_wait_for_selector=1
grep -q 'if NeedExit and not self.HasLogin():' "$wx_file" && has_login_guard=1

if [[ "$has_domcontentloaded" == 1 && "$has_wait_for_selector" == 1 && "$has_login_guard" == 1 ]]; then
  echo "Upstream already contains the QR code fix. Skipping patch."
  exit 0
fi

echo "Upstream does not contain the complete QR code fix. Applying local patch..."

WX_FILE="$wx_file" python3 <<'PY'
import os
from pathlib import Path

path = Path(os.environ["WX_FILE"])
text = path.read_text(encoding="utf-8")
newline = "\r\n" if "\r\n" in text else "\n"

old_qr = """            # 等待页面完全加载
            print_info("正在加载登录页面...")
            await page.wait_for_load_state("networkidle")

            # 定位二维码区域
            qr_tag = ".login__type__container__scan__qrcode"
            # 获取二维码图片URL
            qrcode = await page.query_selector(qr_tag)
            code_src = await qrcode.get_attribute("src")
            print("正在生成二维码图片...")
            print(f"code_src:{code_src}")
"""

new_qr = """            # 定位二维码区域
            qr_tag = ".login__type__container__scan__qrcode"
            # 微信公众平台登录页可能会持续发起后台请求，等待 networkidle 容易不稳定。
            # 这里以 DOM 加载完成和二维码元素可见作为截图条件。
            print_info("正在加载登录页面...")
            await page.wait_for_load_state("domcontentloaded", timeout=60 * 1000)
            await page.wait_for_selector(qr_tag, state="visible", timeout=60 * 1000)

            # 获取二维码图片URL
            qrcode = await page.query_selector(qr_tag)
            if qrcode is None:
                raise Exception("未找到微信授权二维码元素")
            code_src = await qrcode.get_attribute("src")
            print("正在生成二维码图片...")
            print(f"code_src:{code_src}")
"""

old_cleanup = """            if NeedExit:
                self.Clean()
"""

new_cleanup = """            if NeedExit and not self.HasLogin():
                self.Clean()
"""

def normalize(s: str) -> str:
    return s.replace("\n", newline)

old_qr_n = normalize(old_qr)
old_cleanup_n = normalize(old_cleanup)

if old_qr_n not in text:
    raise SystemExit("ERROR: expected QR-code wait block not found; upstream changed, review patch manually")
if old_cleanup_n not in text:
    raise SystemExit("ERROR: expected cleanup block not found; upstream changed, review patch manually")

text = text.replace(old_qr_n, normalize(new_qr), 1)
text = text.replace(old_cleanup_n, normalize(new_cleanup), 1)
with path.open("w", encoding="utf-8", newline="") as f:
    f.write(text)
PY

echo "Patch applied."
