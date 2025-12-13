module.exports = {
  apps: [
    {
      name: 'omega-arbiter',
      script: './node_modules/.bin/tsx',
      args: 'src/index.ts',
      cwd: '/home/claudeuser/omega-arbiter',
      autorestart: true,
      watch: false,
      max_restarts: 50,
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'omega-dashboard',
      script: './node_modules/.bin/next',
      args: 'dev -p 3000 -H 0.0.0.0',
      cwd: '/home/claudeuser/omega-arbiter/src/web',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 1000,
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
};
