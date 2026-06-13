# we-mp-rss GHCR build

This directory contains the automation used to build a personal patched
`we-mp-rss` image.

The workflow:

1. Resolves the current digest of the official
   `ghcr.io/rachelos/we-mp-rss:latest` image.
2. Extracts `/app/driver/wx.py` from that exact official image.
3. Checks whether the official image already includes the QR-code login fix.
4. Applies `patches/wx-qrcode.patch` only when the fix is still missing.
5. Builds a small overlay image from the same official image digest and
   replaces only `/app/driver/wx.py`.
6. Pushes it to GitHub Container Registry.

This keeps the final image aligned with the official runtime image while adding
only a tiny patch layer. The patch is checked against the file that the official
image actually runs, not against a separate source checkout.

Image:

```text
ghcr.io/xiaopan007/we-mp-rss:latest
```

Use it in Docker Compose:

```yaml
image: ghcr.io/xiaopan007/we-mp-rss:latest
```

When this image is used, the old host-file mount for `/app/driver/wx.py` is no
longer needed.
