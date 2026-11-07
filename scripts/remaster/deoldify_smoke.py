"""Import DeOldify and colorize one gray frame. Prints SMOKE_OK on success."""
import os
import sys

import matplotlib

matplotlib.use("Agg")

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
from deoldify_prep import prepare_deoldify_runtime


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: deoldify_smoke.py DEOLDIFY_DIR")
    root = os.path.abspath(sys.argv[1])
    prepare_deoldify_runtime(root)
    os.chdir(root)
    sys.path.insert(0, root)
    import torch
    from deoldify import device
    from deoldify.device_id import DeviceId
    from PIL import Image

    device.set(device=DeviceId.GPU0 if torch.cuda.is_available() else DeviceId.CPU)
    from deoldify.visualize import get_video_colorizer

    vis = get_video_colorizer(render_factor=21)
    im = Image.new("RGB", (256, 256), (32, 32, 32))
    out = vis.vis.filter.filter(im, im, render_factor=21, post_process=True)
    if out.size[0] < 1 or out.size[1] < 1:
        raise SystemExit("empty colorization result")
    flag = "1" if torch.cuda.is_available() else "0"
    print("SMOKE_OK cuda=%s torch=%s" % (flag, torch.__version__), flush=True)


if __name__ == "__main__":
    main()
