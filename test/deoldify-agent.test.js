const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const remaster = require(path.join(root, "lib", "remaster.js"));
const { collectAgentFiles } = require(path.join(root, "lib", "zip-pack.js"));

function withEnv(extra, fn) {
  const keys = Object.keys(extra);
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  try {
    for (const k of keys) {
      if (extra[k] == null) delete process.env[k];
      else process.env[k] = extra[k];
    }
    return fn();
  } finally {
    for (const k of keys) {
      if (prev[k] == null) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("agent bundle includes the DeOldify remaster scripts and installer", () => {
  const names = new Set(collectAgentFiles(root).map((f) => f.name));
  for (const rel of [
    "scripts/remaster/deoldify_frames.py",
    "scripts/remaster/deoldify_prep.py",
    "scripts/remaster/deoldify_smoke.py",
    "scripts/setup-deoldify.ps1",
    "scripts/SETUP-DEOLDIFY.bat",
    "SETUP-DEOLDIFY.bat",
  ]) {
    assert.equal(names.has(rel), true, rel);
  }
});

test("findDeOldify and findDeOldifyPython see the persistent Windows venv", () => {
  const la = fs.mkdtempSync(path.join(os.tmpdir(), "cf-la-"));
  const dir = path.join(la, "ClipForge-Agent-data", "deoldify");
  const py = path.join(dir, "venv", "Scripts", "python.exe");
  fs.mkdirSync(path.join(dir, "models"), { recursive: true });
  fs.writeFileSync(path.join(dir, "models", "ColorizeVideo_gen.pth"), "weights");
  fs.mkdirSync(path.dirname(py), { recursive: true });
  fs.writeFileSync(py, "");
  withEnv({ LOCALAPPDATA: la, DEOLDIFY_DIR: "", DEOLDIFY_PYTHON: "" }, () => {
    assert.equal(remaster.findDeOldify(), dir);
    assert.equal(remaster.findDeOldifyPython(), py);
  });
});

test("agent-config.json supplies DEOLDIFY_DIR and DEOLDIFY_PYTHON", () => {
  const la = fs.mkdtempSync(path.join(os.tmpdir(), "cf-cfg-"));
  const dir = path.join(la, "custom-deoldify");
  const py = path.join(dir, "venv", "Scripts", "python.exe");
  fs.mkdirSync(path.join(dir, "models"), { recursive: true });
  fs.writeFileSync(path.join(dir, "models", "ColorizeVideo_gen.pth"), "weights");
  fs.mkdirSync(path.dirname(py), { recursive: true });
  fs.writeFileSync(py, "");
  const cfgDir = path.join(la, "ClipForge-Agent", "data");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "agent-config.json"),
    JSON.stringify({ DEOLDIFY_DIR: dir, DEOLDIFY_PYTHON: py })
  );
  withEnv({ LOCALAPPDATA: la, DEOLDIFY_DIR: "", DEOLDIFY_PYTHON: "" }, () => {
    assert.equal(remaster.findDeOldify(), dir);
    assert.equal(remaster.findDeOldifyPython(), py);
  });
});

test("requested DeOldify that is not installed fails with setup instructions", async () => {
  const la = fs.mkdtempSync(path.join(os.tmpdir(), "cf-miss-"));
  const logs = [];
  await withEnv(
    {
      LOCALAPPDATA: la,
      DEOLDIFY_DIR: path.join(la, "missing"),
      DEOLDIFY_PYTHON: "",
    },
    async () => {
      await assert.rejects(
        () =>
          remaster.runRemaster({
            ffmpeg: "ffmpeg",
            input: path.join(la, "in.mp4"),
            work: la,
            opts: { deoldify: true },
            onUpdate: (p) => logs.push(p),
          }),
        (err) => {
          assert.equal(err.code, "DEOLDIFY_NOT_READY");
          assert.match(err.message, /SETUP-DEOLDIFY\.bat/);
          assert.match(err.message, /pc-setup\.cmd/);
          assert.match(err.message, /874066230/);
          assert.match(err.message, /ClipForge-Agent-data/);
          return true;
        }
      );
    }
  );
  assert.equal(logs.some((l) => l.stage === "DeOldify niegotowy"), true);
  assert.equal(remaster.remasterErrorIsFatal({ code: "DEOLDIFY_NOT_READY" }, {}), true);
  assert.equal(remaster.remasterErrorIsFatal({ code: "DEOLDIFY_FAILED" }, {}), true);
  assert.equal(remaster.remasterErrorIsFatal(new Error("grade"), {}), false);
});

test("buildDeoldifyArgs adds --gpu only when CUDA is available", () => {
  const base = remaster.buildDeoldifyArgs({
    script: "deoldify_frames.py",
    dir: "D",
    fin: "in",
    fout: "out",
    renderFactor: 21,
    gpu: false,
  });
  assert.equal(base.includes("--gpu"), false);
  const gpu = remaster.buildDeoldifyArgs({
    script: "deoldify_frames.py",
    dir: "D",
    fin: "in",
    fout: "out",
    renderFactor: 21,
    gpu: true,
  });
  assert.equal(gpu[gpu.length - 1], "--gpu");
});

test("probeDeoldifyCuda reads the venv python, not a hard-coded CPU", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-py-"));
  const py = path.join(dir, "python");
  fs.writeFileSync(py, "#!/bin/sh\necho 1\n");
  fs.chmodSync(py, 0o755);
  assert.equal(remaster.probeDeoldifyCuda(py), true);
  const cpu = path.join(dir, "python-cpu");
  fs.writeFileSync(cpu, "#!/bin/sh\necho 0\n");
  fs.chmodSync(cpu, 0o755);
  assert.equal(remaster.probeDeoldifyCuda(cpu), false);
});

test("setup script pins commit, weight size, Python 3.10, and both torch wheels", () => {
  const ps1 = fs.readFileSync(path.join(root, "scripts", "setup-deoldify.ps1"), "utf8");
  assert.equal(/[^\n\r\t\x20-\x7E]/.test(ps1), false, "setup-deoldify.ps1 must stay ASCII");
  assert.match(ps1, /5f86c28923799036ad4b1bf7af8c629ac65efd75/);
  assert.match(ps1, /874066230/);
  assert.match(ps1, /https:\/\/data\.deepai\.org\/deoldify\/ColorizeVideo_gen\.pth/);
  assert.match(ps1, /3\.10\.11/);
  assert.match(ps1, /Python\.Python\.3\.10/);
  assert.match(ps1, /torch-1\.11\.0\+cu113-cp310-cp310-win_amd64\.whl/);
  assert.match(ps1, /torch-1\.11\.0\+cpu-cp310-cp310-win_amd64\.whl/);
  assert.match(ps1, /fastai==1\.0\.60/);
  assert.match(ps1, /Pillow==9\.3\.0/);
  assert.match(ps1, /ClipForge-Agent-data/);
  assert.match(ps1, /SetEnvironmentVariable\('DEOLDIFY_DIR'/);
  assert.match(ps1, /SetEnvironmentVariable\('DEOLDIFY_PYTHON'/);
  assert.match(ps1, /agent-config\.json/);
  assert.match(ps1, /\[IO\.File\]::Replace/);
  assert.match(ps1, /SMOKE|deoldify_smoke\.py/);
});

test("PC setup PowerShell runs DeOldify setup and keeps the install across wipe", () => {
  const src = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const start = src.indexOf("function buildPcSetupPs1");
  const end = src.indexOf("function resolvePcSetupCloud");
  assert.ok(start > 0 && end > start);
  const build = new Function(src.slice(start, end) + "\nreturn buildPcSetupPs1;")();
  const ps1 = build({ cloud: "https://example.test", token: "tok", label: "Moj PC" });
  assert.match(ps1, /setup11-deoldify/);
  assert.match(ps1, /scripts\\setup-deoldify\.ps1/);
  assert.match(ps1, /deoldify\.env\.cmd/);
  assert.match(ps1, /tools\\DeOldify/);
  assert.match(ps1, /ClipForge-Agent-data\\deoldify/);
  assert.equal(/[^\n\r\t\x20-\x7E]/.test(ps1), false);
  assert.match(src, /ClipForge PC Agent {2}\(setup11\)/);
});

test("reinstall script preserves DeOldify data and the in-tree tools folder", () => {
  const text = fs.readFileSync(path.join(root, "scripts", "reinstall-agent-from-cloud.ps1"), "utf8");
  assert.match(text, /ClipForge-Agent-data/);
  assert.match(text, /tools\\DeOldify/);
  assert.match(text, /tools\\venv_deoldify/);
  assert.match(text, /setup-deoldify\.ps1/);
  assert.match(text, /deoldify\.env\.cmd/);
});

test("prepare_deoldify_runtime patches keep_pct and writes 16 dummy frames", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-prep-"));
  fs.mkdirSync(path.join(dir, "deoldify"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "deoldify", "dataset.py"),
    "def get_colorize_data(keep_pct: float = 0.001):\n    return keep_pct\n"
  );
  const r = spawnSync(
    "python3",
    [
      "-c",
      "import sys; sys.path.insert(0, sys.argv[1]); from deoldify_prep import prepare_deoldify_runtime; prepare_deoldify_runtime(sys.argv[2])",
      path.join(root, "scripts", "remaster"),
      dir,
    ],
    { encoding: "utf8" }
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const patched = fs.readFileSync(path.join(dir, "deoldify", "dataset.py"), "utf8");
  assert.match(patched, /keep_pct: float = 1\.0/);
  assert.doesNotMatch(patched, /0\.001/);
  const frames = fs.readdirSync(path.join(dir, "dummy")).filter((n) => n.endsWith(".jpg"));
  assert.equal(frames.length, 16);
  assert.ok(fs.statSync(path.join(dir, "dummy", "d00.jpg")).size > 100);
});
