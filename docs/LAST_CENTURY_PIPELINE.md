# Last Century remaster pipeline

Order: **clean → stabilize → grade → DeOldify → Real-ESRGAN ×2 (animevideov3)**. No narrator.

| Stage | Before this PR | Now |
|---|---|---|
| Clean | `hqdn3d` + `deblock` inside polish (tied to denoise slider) | `lib/remaster.js` pre-pass: hqdn3d / nlmeans / atadenoise, deflicker, deblock |
| Stabilize | `stabilize` in creative FX (after upscale) | done in pre-pass before grade (downstream pass disabled) |
| Grade | eq/colorlevels/RGB polish | archival / warm / neutral presets, optional `remasterLut` (.cube via lut3d) |
| DeOldify | missing | `scripts/remaster/deoldify_frames.py` (PC Agent only) |
| Real-ESRGAN | existing, Windows .exe only | Linux binary name resolved on non-Windows |

Preset: UI "Remaster preset → Last Century" or `options.remasterPreset = "lastCentury"`.

## PC Agent setup (needed for DeOldify)
1. Python 3.8–3.10 + `pip install torch torchvision fastai==1.0.61 opencv-python pillow` and the DeOldify repo requirements.
2. Copy DeOldify repo to `%LOCALAPPDATA%\ClipForge-Agent\tools\DeOldify` (or set `DEOLDIFY_DIR`).
3. Put `models\ColorizeVideo_gen.pth` there (~870 MB). Optional `DEOLDIFY_PYTHON`.
If missing, the stage is skipped with a log line (job continues).

## Cloud (Render, Linux 1c/2G)
Short clips / chunked jobs only. nlmeans is slow on 1 CPU — prefer hqdn3d on cloud. DeOldify never runs on cloud.
For AI upscale on Linux, place the Linux `realesrgan-ncnn-vulkan` build in `tools/realesrgan/` (or `REALESRGAN_PATH`); Render has no Vulkan GPU so this is CPU fallback at best — keep upscale on PC Agent.
