/**
 * Omega Arbiter - Entry Point
 * Self-editing agent that listens to chat transports and manages git worktrees
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Arbiter } from './arbiter/index.js';
import { DiscordTransport } from './transports/discord.js';
import { ArbiterConfig } from './types.js';

// Get directory of this file and load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '..', '.env');
console.log('Loading .env from:', envPath);
dotenv.config({ path: envPath });

// Validate required environment variables
function validateEnv(): void {
  const required = ['DISCORD_BOT_TOKEN', 'OPENAI_API_KEY'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log('=== Omega Arbiter ===');
  console.log('Self-editing agent with git worktree management\n');

  validateEnv();

  // Build configuration
  const config: ArbiterConfig = {
    model: process.env.ARBITER_MODEL ?? 'gpt-4o-mini',
    confidenceThreshold: parseInt(process.env.ARBITER_CONFIDENCE_THRESHOLD ?? '70', 10),
    gitRepoPath: process.env.GIT_REPO_PATH ?? process.cwd(),
    worktreeBasePath: process.env.GIT_WORKTREE_BASE ?? '/tmp/arbiter-worktrees',
    defaultBranch: process.env.GIT_DEFAULT_BRANCH ?? 'main',
  };

  console.log('Configuration:');
  console.log(`  Model: ${config.model}`);
  console.log(`  Confidence threshold: ${config.confidenceThreshold}%`);
  console.log(`  Git repo: ${config.gitRepoPath}`);
  console.log(`  Worktree base: ${config.worktreeBasePath}`);
  console.log(`  Default branch: ${config.defaultBranch}`);
  console.log('');

  // Create arbiter
  const arbiter = new Arbiter(config);

  // Add event listeners
  arbiter.on('ready', () => {
    console.log('[Main] Arbiter is ready and listening');

    // Configure status channel after Discord is connected
    const statusChannelId = process.env.STATUS_CHANNEL_ID;
    const statusChannelName = process.env.STATUS_CHANNEL_NAME;

    if (statusChannelId) {
      arbiter.setStatusChannel(statusChannelId);
      console.log(`[Main] Status channel set to ID: ${statusChannelId}`);
    } else if (statusChannelName) {
      const channelId = discordTransport.findChannelByName(statusChannelName);
      if (channelId) {
        arbiter.setStatusChannel(channelId);
        console.log(`[Main] Status channel set to #${statusChannelName} (${channelId})`);
      } else {
        console.warn(`[Main] Status channel #${statusChannelName} not found`);
      }
    }
  });

  arbiter.on('message', (message) => {
    console.log(`[Message] ${message.authorName} in #${message.channelName}: ${message.content}`);
  });

  arbiter.on('decision', (message, decision) => {
    console.log(`[Decision] ${decision.actionType} (${decision.confidence}%): ${decision.reason}`);
    if (decision.suggestedApproach) {
      console.log(`[Approach] ${decision.suggestedApproach}`);
    }
  });

  arbiter.on('session:created', (session) => {
    console.log(`[Session] Created: ${session.id}`);
    console.log(`  Branch: ${session.branchName}`);
    console.log(`  Worktree: ${session.worktreePath}`);
  });

  arbiter.on('session:updated', (session) => {
    console.log(`[Session] Updated: ${session.id} (${session.status})`);
    console.log(`  Messages: ${session.relatedMessages.length}`);
    console.log(`  Commits: ${session.commits.length}`);
  });

  arbiter.on('session:completed', (session) => {
    console.log(`[Session] Completed: ${session.id}`);
    console.log(`  Total commits: ${session.commits.length}`);
  });

  arbiter.on('error', (error) => {
    console.error('[Error]', error.message);
  });

  // Add Discord transport
  const discordToken = process.env.DISCORD_BOT_TOKEN!;
  const discordTransport = new DiscordTransport(discordToken);
  arbiter.addTransport('discord', discordTransport);

  // Start the arbiter
  await arbiter.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Main] Received ${signal}, shutting down...`);
    await arbiter.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (error) => {
    console.error('[Main] Unhandled rejection:', error);
  });
}

main().catch((error) => {
  console.error('[Main] Fatal error:', error);
  process.exit(1);
});
