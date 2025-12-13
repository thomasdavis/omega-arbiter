/**
 * Next.js Server - Programmatic server for the dashboard
 */

import next from 'next';
import { createServer, Server } from 'http';
import { parse } from 'url';
import { join } from 'path';
import { log } from '../logs/index.js';

export interface WebServerConfig {
  port: number;
  hostname?: string;
  dev?: boolean;
}

export interface WebServerInstance {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startWebServer(config: WebServerConfig): Promise<WebServerInstance> {
  const { port, hostname = 'localhost', dev = true } = config;

  // Next.js app directory is src/web
  const dir = join(process.cwd(), 'src', 'web');

  log('info', 'WebServer', `Starting Next.js server (dev=${dev}) at ${dir}`);

  const app = next({
    dev,
    dir,
    hostname,
    port,
  });

  const handle = app.getRequestHandler();

  await app.prepare();

  const server: Server = createServer((req, res) => {
    const parsedUrl = parse(req.url || '/', true);
    handle(req, res, parsedUrl);
  });

  return new Promise((resolve, reject) => {
    server.listen(port, hostname, () => {
      const url = `http://${hostname}:${port}`;
      log('info', 'WebServer', `Dashboard running at ${url}`);

      resolve({
        url,
        port,
        close: async () => {
          return new Promise((res, rej) => {
            server.close((err) => {
              if (err) rej(err);
              else res();
            });
          });
        },
      });
    });

    server.on('error', (err) => {
      log('error', 'WebServer', `Failed to start: ${err.message}`);
      reject(err);
    });
  });
}
