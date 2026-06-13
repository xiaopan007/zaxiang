# we-mp-rss GHCR build

This directory contains the automation used to build a personal `we-mp-rss`
image from the upstream source.

The workflow:

1. Clones `https://github.com/rachelos/we-mp-rss`.
2. Checks whether upstream already includes the QR-code login fix.
3. Applies `patches/wx-qrcode.patch` only when the fix is still missing.
4. Builds the upstream Docker image.
5. Pushes it to GitHub Container Registry.

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

