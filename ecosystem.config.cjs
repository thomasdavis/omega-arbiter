module.exports = {
  apps: [
    {
      name: 'omega-arbiter',
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      cwd: '/home/claudeuser/omega-arbiter',

      // Let the app load .env itself - just set NODE_ENV
      env: {
        NODE_ENV: 'development',
      },

      // Auto-restart on crash
      autorestart: true,

      // Watch for file changes in src (restarts on code changes)
      watch: ['src'],
      watch_delay: 1000,
      ignore_watch: ['node_modules', 'logs', 'dist', '.git'],

      // Restart if memory exceeds 500MB
      max_memory_restart: '500M',

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/home/claudeuser/omega-arbiter/logs/error.log',
      out_file: '/home/claudeuser/omega-arbiter/logs/out.log',
      merge_logs: true,

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Restart strategy
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      restart_delay: 1000,
    },
  ],
};
