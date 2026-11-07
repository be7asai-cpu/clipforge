# Last Century remaster pipeline

Order: **clean → stabilize → grade → DeOldify → Real-ESRGAN ×2 (animevideov3)**. No narrator.

| Stage | Before this PR | Now |
|---|---|---|
| Clean | `hqdn3d` + `deblock` inside polish (tied to denoise slider) | `lib/remaster.js` pre-pass: hqdn3d / nlmeans / atadenoise, deflicker, deblock |
| Stabilize | `stabilize` in creative FX (after upscale) | done in pre-pass before grade (downstream pass disabled) |
| Grade | eq/colorlevels/RGB polish | archival / warm / neutral presets, optional `remasterLut` (.cube via lut3d) |
| DeOldify | auto-detect + instalacja z PC setup | `scripts/remaster/deoldify_frames.py` — `DEOLDIFY_DIR`, `%LOCALAPPDATA%\ClipForge-Agent-data\deoldify` (przetrwa reinstalację), `tools\DeOldify`, venv `Scripts\python.exe`, `/workspace/nosferatu/DeOldify`. Gdy CUDA jest w tym venv, skrypt dostaje `--gpu`. |
| Real-ESRGAN | existing, Windows .exe only | Linux binary name resolved on non-Windows |

Preset: UI "Remaster preset → Last Century" or `options.remasterPreset = "lastCentury"`.

## PC Agent setup (needed for DeOldify)

After this update is on the server, the PC must pick up the new agent. On the machine that renders:

1. In Studio (logged in), download a fresh **PC** file (`/api/studio/pc-setup.cmd`) and run it. Leave the window open. Setup is **setup11**.
2. The same window installs DeOldify on its own (idempotent — finished steps are skipped):
   - Python 3.10 (`py -3.10`, then winget `Python.Python.3.10`, then the python.org 3.10.11 x64 installer into `%LOCALAPPDATA%\ClipForge-Agent-data\python310`). If all three fail, the log says so and names the installer URL.
   - venv at `%LOCALAPPDATA%\ClipForge-Agent-data\deoldify\venv` (`Scripts\python.exe`). This folder is **outside** `ClipForge-Agent`, so reinstall does not delete the weights.
   - DeOldify source pinned to commit `5f86c28923799036ad4b1bf7af8c629ac65efd75` (git if present, otherwise the GitHub zip).
   - torch 1.11.0 + torchvision 0.12.0 for CPython 3.10 win_amd64: CUDA 11.3 wheels when `nvidia-smi` works, otherwise CPU wheels. `fastai==1.0.60` (no-deps) and `Pillow==9.3.0`.
   - `ColorizeVideo_gen.pth` from `https://data.deepai.org/deoldify/ColorizeVideo_gen.pth`, downloaded to a temp file, checked for size **874066230**, then moved into `models\`.
   - `DEOLDIFY_DIR` and `DEOLDIFY_PYTHON` saved as user environment variables and in `%LOCALAPPDATA%\ClipForge-Agent\data\agent-config.json`.
   - One-frame import/inference smoke test.
3. To retry only the colorizer: `%LOCALAPPDATA%\ClipForge-Agent\SETUP-DEOLDIFY.bat` (log: `%TEMP%\clipforge-deoldify-setup.log`).
4. Restart the agent window after setup so it reads the new paths, then turn on **DeOldify koloryzacja (tylko PC Agent)**.

If DeOldify is checked and the install is not ready, the job **stops** with that log path and the two commands above. It does not finish a black-and-white file as if colorization had run.

`scripts/reinstall-agent-from-cloud.ps1` does not delete `%LOCALAPPDATA%\ClipForge-Agent-data` and puts back `tools\DeOldify` / `tools\venv_deoldify` if they were inside the agent folder.

## Cloud (Render, Linux 1c/2G)
Short clips / chunked jobs only. nlmeans is slow on 1 CPU — prefer hqdn3d on cloud. DeOldify runs where the pinned Python env and `ColorizeVideo_gen.pth` are present (PC Agent after setup, or a box with `/workspace/nosferatu/DeOldify`). On Render the checkbox stops the job with setup instructions, because the free instance does not carry the weights.
For AI upscale on Linux, place the Linux `realesrgan-ncnn-vulkan` build in `tools/realesrgan/` (or `REALESRGAN_PATH`); Render has no Vulkan GPU so this is CPU fallback at best — keep upscale on PC Agent.
