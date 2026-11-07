"""Make a fresh DeOldify checkout able to load the video colorizer.

The pinned upstream dataset helper samples 0.1% of ./dummy and then
holds out 10% for validation. A fresh tree has no dummy images, so
get_video_colorizer() crashes before any frame is colored. This keeps
that fix next to the frame script (no edit of upstream sources is
required for the keep_pct default — we patch the checkout in place).
"""
import base64
import os

# 1x1 JPEG. Fastai only needs real image files in ./dummy; Pillow is not required to write them.
_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAgACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5MooooAKKKKACiiigAooooA//2Q=="
)


def prepare_deoldify_runtime(root):
    root = os.path.abspath(root)
    dataset = os.path.join(root, "deoldify", "dataset.py")
    if os.path.isfile(dataset):
        with open(dataset, "r", encoding="utf-8") as f:
            text = f.read()
        old = "keep_pct: float = 0.001"
        new = "keep_pct: float = 1.0"
        if old in text:
            with open(dataset, "w", encoding="utf-8", newline="\n") as f:
                f.write(text.replace(old, new))
    dummy = os.path.join(root, "dummy")
    os.makedirs(dummy, exist_ok=True)
    # split_by_rand_pct(0.1) needs >=10 files to leave a non-empty valid set.
    for i in range(16):
        path = os.path.join(dummy, "d%02d.jpg" % i)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            continue
        with open(path, "wb") as f:
            f.write(_JPEG)
    return root
