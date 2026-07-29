/**
 * ClipForge job worker — runs pipeline OFF the HTTP event loop.
 * Parent talks via IPC: { type:'start', job } → progress/done/error
 */
// Mark as worker BEFORE requiring studio-jobs (via pipeline) so parent-only
// intervals (watchdog) never start in this process.
process.env.CLIPFORGE_WORKER = "1";

const { runPipeline } = require("./studio-pipeline");

let busy = false;

process.on("message", async (msg) => {
  if (!msg || msg.type !== "start" || !msg.job) return;
  if (busy) return;
  busy = true;
  const job = msg.job;
  try {
    await runPipeline(job, (patch) => {
      // Forward progress to parent (never block)
      try {
        if (process.connected) {
          process.send({ type: "progress", jobId: job.id, patch, job });
        }
      } catch {
        /* parent gone */
      }
    });
    if (process.connected) {
      process.send({
        type: "done",
        jobId: job.id,
        job: {
          outputPath: job.outputPath,
          previewPath: job.previewPath,
          result: job.result,
        },
      });
    }
  } catch (err) {
    try {
      if (process.connected) {
        process.send({
          type: "error",
          jobId: job.id,
          error: err && err.message ? err.message : String(err),
        });
      }
    } catch {
      /* ignore */
    }
  } finally {
    // Exit cleanly so parent never hangs waiting for IPC
    setTimeout(() => process.exit(0), 50);
  }
});

// Ready
try {
  if (process.connected) process.send({ type: "ready" });
} catch {
  /* ignore */
}

// Safety: if parent never sends start, exit
setTimeout(() => {
  if (!busy) process.exit(2);
}, 30000);
