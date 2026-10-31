"""Colorize a folder of PNG frames with DeOldify (video model). Resumable.
Based on /workspace/nosferatu/deold_v3.py. Usage:
  python deoldify_frames.py --deoldify-dir C:/.../DeOldify --in frames --out colored [--render-factor 21] [--gpu]
"""
import argparse, glob, os, sys, warnings
warnings.filterwarnings("ignore")
ap = argparse.ArgumentParser()
ap.add_argument("--deoldify-dir", required=True)
ap.add_argument("--in", dest="inp", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--render-factor", type=int, default=21)
ap.add_argument("--gpu", action="store_true")
a = ap.parse_args()
inp, out = os.path.abspath(a.inp), os.path.abspath(a.out)
os.chdir(a.deoldify_dir); sys.path.insert(0, ".")
from deoldify import device
from deoldify.device_id import DeviceId
device.set(device=DeviceId.GPU0 if a.gpu else DeviceId.CPU)
from deoldify.visualize import get_video_colorizer
from PIL import Image
vis = get_video_colorizer(render_factor=a.render_factor)
fs = sorted(glob.glob(os.path.join(inp, "*.png")))
for i, f in enumerate(fs):
    o = os.path.join(out, os.path.basename(f))
    if os.path.exists(o):
        continue
    im = Image.open(f).convert("RGB")
    vis.vis.filter.filter(im, im, render_factor=a.render_factor, post_process=True).save(o)
    print(f"{i+1}/{len(fs)}", flush=True)
