// PM2 process file for a single VPS. One web process runs the background jobs inline
// (WORKER_MODE=inline) so live updates reach browsers; see docs/deploy-inmotion.md.
module.exports = {
  apps: [
    {
      name: "ses-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      instances: 1,
      env: { NODE_ENV: "production", WORKER_MODE: "inline" },
      max_memory_restart: "1G",
      time: true,
    },
  ],
};
