/**
 * Main Arbiter Class
 * Orchestrates the self-editing workflow:
 * 1. Listens to messages from transports
 * 2. Decides whether/how to act
 * 3. Creates worktrees for self-editing tasks
 * 4. Manages commits and rebases
 * 5. Handles successive messages contributing to work
 */

import { EventEmitter } from 'events';
import {
  Transport,
  ChatMessage,
  ArbiterDecision,
  ArbiterConfig,
  WorkSession,
  MessageContext,
} from '../types.js';
import { WorktreeManager, MergeResult } from '../git/worktree.js';
import { MessageQueue, MessageAggregator, QueuedMessage } from '../queue/messageQueue.js';
import { makeDecision, detectErrorPatterns } from './decision.js';
import { generateResponse, getQuickAcknowledgment } from './respond.js';
import { ClaudeRunner, buildClaudePrompt, DiscordOutputStream } from '../claude/index.js';
import { createCheckpoint, buildContinuationPrompt } from './checkpoint.js';
import { getCoordinator, SessionCoordinator } from './coordinator.js';
import type { PromptContext } from '../claude/index.js';
import { DiscordTransport } from '../transports/discord.js';

/**
 * Events emitted by the arbiter
 */
export interface ArbiterEvents {
  'ready': () => void;
  'message': (message: ChatMessage) => void;
  'decision': (message: ChatMessage, decision: ArbiterDecision) => void;
  'session:created': (session: WorkSession) => void;
  'session:updated': (session: WorkSession) => void;
  'session:completed': (session: WorkSession) => void;
  'error': (error: Error) => void;
}

export class Arbiter extends EventEmitter {
  private transports: Map<string, Transport> = new Map();
  private worktreeManager: WorktreeManager;
  private messageQueue: MessageQueue;
  private messageAggregator: MessageAggregator;
  private config: ArbiterConfig;
  private coordinator: SessionCoordinator;
  private statusChannelId: string | null = null;

  constructor(config: ArbiterConfig) {
    super();
    this.config = config;

    // Initialize coordinator
    this.coordinator = getCoordinator();
    this.setupCoordinatorHandlers();

    // Initialize worktree manager
    this.worktreeManager = new WorktreeManager({
      repoPath: config.gitRepoPath,
      worktreeBase: config.worktreeBasePath,
      defaultBranch: config.defaultBranch,
    });

    // Initialize message queue
    this.messageQueue = new MessageQueue({
      processDelay: 100,
      batchWindow: 2000,
    });

    // Initialize message aggregator
    this.messageAggregator = new MessageAggregator(3000);

    // Set up queue processor
    this.messageQueue.setProcessor(this.processQueuedMessage.bind(this));
  }

  /**
   * Set up handlers for coordinator events
   */
  private setupCoordinatorHandlers(): void {
    // Handle notification events
    this.coordinator.on('notify', async (message: string, channelId?: string) => {
      const targetChannel = channelId || this.statusChannelId;
      if (!targetChannel) {
        console.log(`[Arbiter] Notification (no channel): ${message}`);
        return;
      }

      // Find a transport that can send to this channel
      for (const transport of this.transports.values()) {
        try {
          await transport.send(targetChannel, message);
          break;
        } catch {
          // Try next transport
        }
      }
    });

    // Log state changes
    this.coordinator.on('state:changed', (oldState, newState) => {
      console.log(`[Arbiter] Coordinator state: ${oldState} → ${newState}`);
    });
  }

  /**
   * Set the status channel for bot notifications
   */
  setStatusChannel(channelId: string): void {
    this.statusChannelId = channelId;
    this.coordinator.setStatusChannel(channelId);
    console.log(`[Arbiter] Status channel set to ${channelId}`);
  }

  /**
   * Add a transport (Discord, Slack, CLI, etc.)
   */
  addTransport(name: string, transport: Transport): void {
    this.transports.set(name, transport);

    // Set up event handlers
    transport.onMessage(async (message) => {
      await this.handleIncomingMessage(message, transport);
    });

    transport.onReady(() => {
      console.log(`[Arbiter] Transport '${name}' ready`);
    });

    transport.onError((error) => {
      console.error(`[Arbiter] Transport '${name}' error:`, error);
      this.emit('error', error);
    });
  }

  /**
   * Start the arbiter - connect all transports
   */
  async start(): Promise<void> {
    console.log('[Arbiter] Starting...');

    // Set up signal handlers for graceful shutdown
    this.coordinator.setupSignalHandlers();

    // Initialize worktree manager
    await this.worktreeManager.initialize();

    // Connect all transports
    for (const [name, transport] of this.transports) {
      try {
        console.log(`[Arbiter] Connecting transport '${name}'...`);
        await transport.connect();
      } catch (error) {
        console.error(`[Arbiter] Failed to connect transport '${name}':`, error);
        throw error;
      }
    }

    this.emit('ready');
    console.log('[Arbiter] Started successfully');

    // Notify startup (after a short delay to ensure Discord is ready)
    setTimeout(() => {
      this.coordinator.notifyStartup();
    }, 2000);
  }

  /**
   * Stop the arbiter - disconnect all transports
   */
  async stop(): Promise<void> {
    console.log('[Arbiter] Stopping...');

    this.messageQueue.stop();

    for (const [name, transport] of this.transports) {
      try {
        await transport.disconnect();
        console.log(`[Arbiter] Disconnected transport '${name}'`);
      } catch (error) {
        console.error(`[Arbiter] Error disconnecting transport '${name}':`, error);
      }
    }

    console.log('[Arbiter] Stopped');
  }

  /**
   * Handle an incoming message from any transport
   */
  private async handleIncomingMessage(
    message: ChatMessage,
    transport: Transport
  ): Promise<void> {
    this.emit('message', message);

    try {
      // Check if there's an active session for this channel
      const existingSession = this.worktreeManager.findSessionByChannel(message.channelId);

      if (existingSession) {
        // Add message to existing session's context
        this.worktreeManager.addMessageToSession(existingSession.id, message);
        this.messageQueue.associateWithSession(message.id, existingSession.id);

        // Add to pending messages for checkpoint & continue
        existingSession.pendingMessages.push(message);
        existingSession.shouldCheckpoint = true;

        // Notify Discord that message was received
        await transport.send(
          message.channelId,
          `📝 Got it! Will incorporate "${message.content.slice(0, 50)}${message.content.length > 50 ? '...' : ''}" after current operation completes.`
        );

        console.log(`[Arbiter] Added follow-up message to session ${existingSession.id}, flagged for checkpoint`);
        return;
      }

      // Get context and make a decision immediately - be responsive!
      const context = await this.buildMessageContext(message, transport);
      const decision = await makeDecision(message, context, this.config.model);

      this.emit('decision', message, decision);

      // Act on the decision - be eager to engage!
      if (decision.shouldAct && decision.confidence >= this.config.confidenceThreshold) {
        if (decision.actionType === 'self_edit') {
          // Start a self-edit session
          await this.startSelfEditSession([message], decision, transport);
        } else {
          // Process immediately - don't queue, just respond!
          await this.processMessageDirectly(message, decision, context, transport);
        }
      } else if (decision.confidence >= 40) {
        // Even with lower confidence, if there's some reason to engage, do it
        console.log(`[Arbiter] Low confidence (${decision.confidence}%) but considering response...`);
        if (decision.actionType !== 'ignore') {
          await this.processMessageDirectly(message, decision, context, transport);
        }
      }
    } catch (error) {
      console.error('[Arbiter] Error handling message:', error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Process a message directly without queueing
   */
  private async processMessageDirectly(
    message: ChatMessage,
    decision: ArbiterDecision,
    context: MessageContext,
    transport: Transport
  ): Promise<void> {
    console.log(`[Arbiter] Direct processing: ${decision.actionType} (${decision.confidence}%)`);

    switch (decision.actionType) {
      case 'acknowledge':
        const ack = getQuickAcknowledgment(message);
        await transport.send(message.channelId, ack);
        console.log(`[Arbiter] Acknowledged: "${ack}"`);
        break;

      case 'respond':
      case 'research':
        try {
          console.log(`[Arbiter] Generating response...`);
          const response = await generateResponse(message, context, this.config.model);
          await transport.send(message.channelId, response);
          console.log(`[Arbiter] Sent response:\n${response}`);
        } catch (error) {
          console.error('[Arbiter] Response generation failed:', error);
        }
        break;

      case 'defer':
        // Still acknowledge that we saw it
        await transport.send(message.channelId, "I'll look into that when I have a moment.");
        break;

      default:
        break;
    }
  }

  /**
   * Process aggregated messages
   */
  private async processAggregatedMessages(
    messages: ChatMessage[],
    transport: Transport
  ): Promise<void> {
    if (messages.length === 0) return;

    // Use the most recent message for decision making
    const primaryMessage = messages[messages.length - 1];
    const context = await this.buildMessageContext(primaryMessage, transport);

    // Add all messages to context
    context.messages = [...messages, ...context.messages];

    const decision = await makeDecision(primaryMessage, context, this.config.model);

    this.emit('decision', primaryMessage, decision);

    if (decision.shouldAct && decision.confidence >= this.config.confidenceThreshold) {
      if (decision.actionType === 'self_edit') {
        await this.startSelfEditSession(messages, decision, transport);
      } else {
        // Queue the primary message
        this.messageQueue.enqueue(primaryMessage, { priority: 'normal' });
      }
    }
  }

  /**
   * Start a self-editing session with Claude Code CLI
   */
  private async startSelfEditSession(
    messages: ChatMessage[],
    decision: ArbiterDecision,
    transport: Transport
  ): Promise<void> {
    const primaryMessage = messages[messages.length - 1];
    const taskDescription = decision.suggestedApproach ?? primaryMessage.content.slice(0, 50);
    const channelId = primaryMessage.channelId;

    // Check if we're accepting new sessions
    if (!this.coordinator.canStartSession()) {
      const pendingActions = this.coordinator.getPendingActions();
      const reason = pendingActions[0]?.reason || 'pending action';
      await transport.send(
        channelId,
        `⏳ **Cannot start new session**\n` +
        `Reason: ${reason}\n` +
        `Active sessions: ${this.coordinator.getActiveSessionCount()}\n\n` +
        `Please wait for the bot to restart and try again.`
      );
      return;
    }

    // Cast to DiscordTransport for edit capabilities
    const discordTransport = transport as DiscordTransport;

    let session: WorkSession | null = null;
    let outputStream: DiscordOutputStream | null = null;
    let sessionRegistered = false;

    try {
      // Create work session
      session = await this.worktreeManager.createSession(primaryMessage, taskDescription);

      // Register with coordinator
      this.coordinator.registerSession(session);
      sessionRegistered = true;

      // Note: status channel should be configured via STATUS_CHANNEL_NAME or STATUS_CHANNEL_ID env vars
      // This auto-setting is removed to prevent sessions in other channels from hijacking notifications

      // Add all related messages
      for (const msg of messages.slice(0, -1)) {
        this.worktreeManager.addMessageToSession(session.id, msg);
      }

      this.emit('session:created', session);

      console.log(`[Arbiter] Created self-edit session ${session.id}`);

      // Create output stream for Discord
      outputStream = new DiscordOutputStream(discordTransport, channelId, 2000);

      // Send initial status message
      await outputStream.start(
        `🔧 **Editing myself in worktree**\n` +
        `Branch: \`${session.branchName}\`\n` +
        `Task: ${taskDescription}\n\n` +
        `⏳ Building enhanced prompt...`
      );

      // Build context for Claude
      const context = await this.buildMessageContext(primaryMessage, transport);
      const promptContext: PromptContext = {
        userRequest: primaryMessage.content,
        channelName: primaryMessage.channelName || 'unknown',
        authorName: primaryMessage.authorName,
        conversationHistory: context.messages,
        repoPath: session.worktreePath,
        branchName: session.branchName,
      };

      // Build enhanced prompt using AI
      outputStream.append('\n\n🧠 Enhancing prompt with AI...');
      await outputStream.flush();

      const claudePrompt = await buildClaudePrompt(promptContext);

      // Update status
      outputStream.append('\n\n🚀 Running Claude Code CLI...\n');
      await outputStream.flush();

      // Run Claude Code CLI with checkpoint support
      let checkpointAborted = false;
      const runner = new ClaudeRunner();

      const result = await runner.run({
        workdir: session.worktreePath,
        prompt: claudePrompt,
        onOutput: async (event) => {
          await outputStream!.handleEvent(event);

          // Check for checkpoint after tool completion
          if (event.type === 'tool_result' && session!.shouldCheckpoint && !checkpointAborted) {
            console.log('[Arbiter] Checkpoint requested, aborting current Claude run...');
            checkpointAborted = true;
            runner.abort();
          }
        },
        onError: (error) => {
          console.error('[Arbiter] Claude error:', error);
        },
      });

      console.log(`[Arbiter] Claude finished with exit code ${result.exitCode}`);

      // Handle checkpoint continuation
      if (checkpointAborted) {
        await this.handleCheckpointContinuation(session, outputStream, discordTransport);
        return; // Continuation handles the rest
      }

      if (result.success) {
        // Commit the changes
        outputStream.append('\n\n📝 Committing changes...');
        await outputStream.flush();

        const commitHash = await this.worktreeManager.commitChanges(
          session.id,
          `Self-edit: ${taskDescription}\n\nRequested by: ${primaryMessage.authorName}`
        );

        if (commitHash) {
          // Merge to main
          outputStream.append('\n\n🔀 Merging to main...');
          await outputStream.flush();

          let mergeResult = await this.worktreeManager.mergeToMain(session.id);

          // If merge failed due to conflicts, spawn Claude to fix them
          if (!mergeResult.success && mergeResult.conflictType) {
            outputStream.append('\n\n⚠️ Merge conflict detected! Spawning Claude to resolve...');
            await outputStream.flush();

            const conflictResolved = await this.resolveConflictsWithClaude(
              session,
              mergeResult,
              outputStream,
              discordTransport
            );

            if (conflictResolved) {
              // Retry the merge
              outputStream.append('\n\n🔀 Retrying merge...');
              await outputStream.flush();
              mergeResult = await this.worktreeManager.mergeToMain(session.id);
            }
          }

          if (mergeResult.success) {
            // Send success summary
            await outputStream.finalize(
              `**Changes merged to main!**\n\n` +
              `Commit: \`${commitHash.slice(0, 8)}\`\n` +
              `Branch: \`${session.branchName}\`\n\n` +
              `**Summary:**\n${String(result.summary || 'No output').slice(0, 1500)}`,
              true
            );

            this.emit('session:completed', session);

            // Complete session with coordinator and request restart
            this.coordinator.completeSession(session.id, true, taskDescription);
            this.coordinator.requestRestart(
              `Code merged to main: ${taskDescription}`,
              primaryMessage.authorName,
              channelId
            );
          } else {
            // Merge failed even after conflict resolution attempt
            await outputStream.finalize(
              `**Changes committed but merge failed**\n\n` +
              `Error: ${mergeResult.error}\n\n` +
              `Branch \`${session.branchName}\` has been kept for manual resolution.\n` +
              `Commit: \`${commitHash.slice(0, 8)}\``,
              false
            );

            // Complete session as failed
            this.coordinator.completeSession(session.id, false, mergeResult.error);
          }
        } else {
          // No changes to commit
          await outputStream.finalize(
            `**No changes were made**\n\n` +
            `Claude completed but didn't modify any files.\n\n` +
            `Summary: ${String(result.summary || 'No output').slice(0, 1500)}`,
            true
          );

          // Complete session (no restart needed, no changes made)
          this.coordinator.completeSession(session.id, true, 'No changes made');
        }
      } else {
        // Claude failed
        await outputStream.finalize(
          `**Task failed**\n\n` +
          `Exit code: ${result.exitCode}\n\n` +
          `Branch \`${session.branchName}\` has been kept for debugging.\n\n` +
          `Output: ${String(result.summary || 'No output').slice(0, 1500)}`,
          false
        );

        // Complete session as failed
        this.coordinator.completeSession(session.id, false, `Exit code: ${result.exitCode}`);
      }

      // Clean up worktree
      try {
        await this.worktreeManager.completeSession(session.id);
      } catch (cleanupError) {
        console.error('[Arbiter] Worktree cleanup error:', cleanupError);
      }

    } catch (error) {
      console.error('[Arbiter] Self-edit session failed:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (outputStream) {
        await outputStream.finalize(`**Session failed**\n\nError: ${errorMessage}`, false);
      } else {
        await transport.send(
          channelId,
          `❌ Failed to start self-edit session: ${errorMessage}`
        );
      }

      // Complete session as failed (if it was registered)
      if (session && sessionRegistered) {
        this.coordinator.completeSession(session.id, false, errorMessage);
      }

      // Clean up if session was created
      if (session) {
        try {
          await this.worktreeManager.abandonSession(session.id);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Handle checkpoint and continuation when follow-up messages arrive
   */
  private async handleCheckpointContinuation(
    session: WorkSession,
    outputStream: DiscordOutputStream,
    transport: DiscordTransport
  ): Promise<void> {
    console.log(`[Arbiter] Handling checkpoint continuation for session ${session.id}`);

    try {
      // Notify user
      outputStream.append('\n\n🔄 Incorporating new instructions...');
      await outputStream.flush();

      // Get the current diff before committing
      const diff = await this.worktreeManager.getDiff(session.id);

      // Create checkpoint commit
      const commitHash = await createCheckpoint(session, this.worktreeManager);
      if (commitHash) {
        outputStream.append(`\n📝 Checkpoint ${session.checkpointCount} committed: \`${commitHash.slice(0, 8)}\``);
        await outputStream.flush();
      }

      // Build continuation prompt with pending messages
      const continuationPrompt = buildContinuationPrompt(session, diff);

      // Clear the checkpoint flags
      const pendingCount = session.pendingMessages.length;
      session.pendingMessages = [];
      session.shouldCheckpoint = false;

      outputStream.append(`\n🚀 Continuing with ${pendingCount} new instruction(s)...\n`);
      await outputStream.flush();

      // Run Claude again with continuation prompt
      let checkpointAborted = false;
      const runner = new ClaudeRunner();

      const result = await runner.run({
        workdir: session.worktreePath,
        prompt: continuationPrompt,
        onOutput: async (event) => {
          await outputStream.handleEvent(event);

          // Check for another checkpoint (user might send more follow-ups)
          if (event.type === 'tool_result' && session.shouldCheckpoint && !checkpointAborted) {
            console.log('[Arbiter] Another checkpoint requested during continuation...');
            checkpointAborted = true;
            runner.abort();
          }
        },
        onError: (error) => {
          console.error('[Arbiter] Claude continuation error:', error);
        },
      });

      // Handle nested checkpoint (recursive)
      if (checkpointAborted) {
        await this.handleCheckpointContinuation(session, outputStream, transport);
        return;
      }

      // Handle completion - same as original flow
      if (result.success) {
        outputStream.append('\n\n📝 Committing final changes...');
        await outputStream.flush();

        const finalCommitHash = await this.worktreeManager.commitChanges(
          session.id,
          `Self-edit: ${session.triggeredBy.content.slice(0, 50)}\n\nRequested by: ${session.triggeredBy.authorName}\nIncluded ${session.checkpointCount} checkpoint(s)`
        );

        if (finalCommitHash) {
          outputStream.append('\n\n🔀 Merging to main...');
          await outputStream.flush();

          let mergeResult = await this.worktreeManager.mergeToMain(session.id);

          if (!mergeResult.success && mergeResult.conflictType) {
            outputStream.append('\n\n⚠️ Merge conflict detected! Spawning Claude to resolve...');
            await outputStream.flush();

            const conflictResolved = await this.resolveConflictsWithClaude(
              session,
              mergeResult,
              outputStream,
              transport
            );

            if (conflictResolved) {
              outputStream.append('\n\n🔀 Retrying merge...');
              await outputStream.flush();
              mergeResult = await this.worktreeManager.mergeToMain(session.id);
            }
          }

          if (mergeResult.success) {
            await outputStream.finalize(
              `**Changes merged to main!**\n\n` +
              `Commit: \`${finalCommitHash.slice(0, 8)}\`\n` +
              `Branch: \`${session.branchName}\`\n` +
              `Checkpoints: ${session.checkpointCount}\n\n` +
              `**Summary:**\n${String(result.summary || 'No output').slice(0, 1500)}`,
              true
            );
            this.emit('session:completed', session);

            // Complete session and request restart
            const taskDescription = session.triggeredBy.content.slice(0, 50);
            this.coordinator.completeSession(session.id, true, taskDescription);
            this.coordinator.requestRestart(
              `Code merged to main: ${taskDescription}`,
              session.triggeredBy.authorName,
              session.triggeredBy.channelId
            );
          } else {
            await outputStream.finalize(
              `**Changes committed but merge failed**\n\n` +
              `Error: ${mergeResult.error}\n\n` +
              `Branch \`${session.branchName}\` has been kept for manual resolution.`,
              false
            );

            // Complete session as failed
            this.coordinator.completeSession(session.id, false, mergeResult.error);
          }
        } else {
          await outputStream.finalize(
            `**No additional changes made**\n\n` +
            `Summary: ${String(result.summary || 'No output').slice(0, 1500)}`,
            true
          );

          // Complete session (no restart needed)
          this.coordinator.completeSession(session.id, true, 'No additional changes');
        }
      } else {
        await outputStream.finalize(
          `**Continuation failed**\n\n` +
          `Exit code: ${result.exitCode}\n\n` +
          `Branch \`${session.branchName}\` has been kept for debugging.\n\n` +
          `Output: ${String(result.summary || 'No output').slice(0, 1500)}`,
          false
        );

        // Complete session as failed
        this.coordinator.completeSession(session.id, false, `Continuation failed (exit ${result.exitCode})`);
      }

      // Clean up worktree
      try {
        await this.worktreeManager.completeSession(session.id);
      } catch (cleanupError) {
        console.error('[Arbiter] Worktree cleanup error:', cleanupError);
      }

    } catch (error) {
      console.error('[Arbiter] Checkpoint continuation failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await outputStream.finalize(`**Continuation failed**\n\nError: ${errorMessage}`, false);

      // Complete session as failed
      this.coordinator.completeSession(session.id, false, errorMessage);

      try {
        await this.worktreeManager.abandonSession(session.id);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Resolve merge conflicts using Claude
   * Spawns Claude in the main repo to fix local changes, untracked files, or merge conflicts
   */
  private async resolveConflictsWithClaude(
    session: WorkSession,
    mergeResult: MergeResult,
    outputStream: DiscordOutputStream,
    transport: DiscordTransport
  ): Promise<boolean> {
    const repoPath = this.worktreeManager.getRepoPath();
    const defaultBranch = this.worktreeManager.getDefaultBranch();

    console.log(`[Arbiter] Resolving ${mergeResult.conflictType} conflict with Claude...`);

    // Build a prompt specifically for conflict resolution
    let conflictPrompt = `You are resolving a git merge conflict in the omega-arbiter repository.

## Situation
We're trying to merge branch \`${session.branchName}\` into \`${defaultBranch}\` but encountered an issue.

## Conflict Type: ${mergeResult.conflictType}

## Error Details:
${mergeResult.conflictDetails || mergeResult.error}

## Your Task
`;

    switch (mergeResult.conflictType) {
      case 'local_changes':
        conflictPrompt += `
There are uncommitted local changes that would be overwritten by the merge.

You need to:
1. First, run \`git status\` to see what files have local changes
2. Review the changes with \`git diff\`
3. Decide the best approach:
   - If the local changes should be kept: commit them first with an appropriate message
   - If the local changes can be discarded: run \`git checkout -- <file>\` to discard them
   - If changes should be stashed: run \`git stash\` to temporarily save them
4. After handling local changes, the merge will be retried automatically

Be careful to preserve any important work. If unsure, commit the changes rather than discarding them.
`;
        break;

      case 'untracked_files':
        conflictPrompt += `
There are untracked files that would be overwritten by the merge.

You need to:
1. Run \`git status\` to see the untracked files
2. Review if these files are important
3. Either:
   - Add and commit them: \`git add <file> && git commit -m "Add <file>"\`
   - Move them temporarily: \`mv <file> <file>.backup\`
   - Delete them if not needed: \`rm <file>\`
4. After handling untracked files, the merge will be retried automatically

Be careful - untracked files may contain important work that was created but not committed.
`;
        break;

      case 'merge_conflict':
        conflictPrompt += `
There's an actual merge conflict (both branches modified the same lines).

You need to:
1. Run \`git status\` to see conflicting files
2. The merge was already aborted, so you need to restart it
3. Run: \`git merge ${session.branchName}\`
4. For each conflicting file:
   - Read the file to see the conflict markers (<<<<<<< ======= >>>>>>>)
   - Decide how to resolve (keep ours, theirs, or combine)
   - Edit the file to resolve conflicts
   - Run \`git add <file>\` to mark as resolved
5. Complete the merge with \`git commit\`
6. After resolving, the process will continue automatically
`;
        break;

      default:
        conflictPrompt += `
An unexpected merge error occurred.

Please:
1. Run \`git status\` to understand the current state
2. Try to fix whatever is preventing the merge
3. The merge will be retried automatically after you're done
`;
    }

    conflictPrompt += `
## Important Notes
- You're working in the MAIN repo at: ${repoPath}
- The branch to merge is: ${session.branchName}
- The target branch is: ${defaultBranch}
- After you resolve the issue, just finish. The merge will be retried automatically.
- If you successfully complete the merge yourself, that's also fine.
`;

    try {
      outputStream.append(`\n\n🔧 Running Claude to fix ${mergeResult.conflictType} issue...\n`);
      await outputStream.flush();

      const runner = new ClaudeRunner();
      const result = await runner.run({
        workdir: repoPath,
        prompt: conflictPrompt,
        onOutput: async (event) => {
          await outputStream.handleEvent(event);
        },
        onError: (error) => {
          console.error('[Arbiter] Claude conflict resolution error:', error);
        },
      });

      console.log(`[Arbiter] Conflict resolution Claude exited with code ${result.exitCode}`);

      if (result.success) {
        outputStream.append('\n\n✅ Conflict resolution completed!');
        await outputStream.flush();
        return true;
      } else {
        outputStream.append(`\n\n❌ Conflict resolution failed: ${String(result.summary || 'Unknown error').slice(0, 500)}`);
        await outputStream.flush();
        return false;
      }
    } catch (error) {
      console.error('[Arbiter] Error during conflict resolution:', error);
      outputStream.append(`\n\n❌ Error resolving conflicts: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await outputStream.flush();
      return false;
    }
  }

  /**
   * Process a queued message
   */
  private async processQueuedMessage(qm: QueuedMessage): Promise<void> {
    const { message, sessionId } = qm;

    if (sessionId) {
      // Process within session context
      await this.processSessionMessage(message, sessionId);
    } else {
      // Standalone message processing
      await this.processStandaloneMessage(message);
    }
  }

  /**
   * Process a message within a work session context
   */
  private async processSessionMessage(
    message: ChatMessage,
    sessionId: string
  ): Promise<void> {
    const session = this.worktreeManager.getSession(sessionId);
    if (!session) {
      console.warn(`[Arbiter] Session ${sessionId} not found`);
      return;
    }

    // Get all messages for this session to build full context
    const sessionMessages = this.messageQueue.getSessionMessages(sessionId);

    console.log(`[Arbiter] Processing message in session ${sessionId}`);
    console.log(`[Arbiter] Session has ${sessionMessages.length} messages`);
    console.log(`[Arbiter] Worktree at: ${session.worktreePath}`);

    // Here you would integrate with your AI coding system
    // For now, we'll just log the work context
    console.log('[Arbiter] Work context:', {
      sessionId,
      branchName: session.branchName,
      worktreePath: session.worktreePath,
      messageCount: sessionMessages.length,
      latestMessage: message.content.slice(0, 100),
    });

    this.emit('session:updated', session);
  }

  /**
   * Process a standalone message (no session)
   */
  private async processStandaloneMessage(message: ChatMessage): Promise<void> {
    const transport = this.transports.get(message.transport);
    if (!transport) return;

    const context = await this.buildMessageContext(message, transport);
    const decision = await makeDecision(message, context, this.config.model);

    console.log(`[Arbiter] Processing: ${decision.actionType} (${decision.confidence}%) - ${decision.reason}`);

    switch (decision.actionType) {
      case 'acknowledge':
        // Send a quick text response instead of just emoji
        const ack = getQuickAcknowledgment(message);
        await transport.send(message.channelId, ack);
        console.log(`[Arbiter] Acknowledged: "${ack}"`);
        break;

      case 'respond':
        // Generate and send a full response
        try {
          console.log(`[Arbiter] Generating response to: ${message.content.slice(0, 50)}...`);
          const response = await generateResponse(message, context, this.config.model);
          await transport.send(message.channelId, response);
          console.log(`[Arbiter] Responded: "${response.slice(0, 100)}..."`);
        } catch (error) {
          console.error('[Arbiter] Failed to generate response:', error);
        }
        break;

      case 'research':
        // For now, respond that we're looking into it
        await transport.send(
          message.channelId,
          `Interesting question - let me think about that...`
        );
        console.log(`[Arbiter] Research mode for: ${message.content.slice(0, 50)}...`);
        break;

      case 'self_edit':
        // This shouldn't happen here (handled earlier), but just in case
        console.log(`[Arbiter] Self-edit request detected in standalone processing`);
        break;

      default:
        // ignore or defer - still log it
        console.log(`[Arbiter] Ignoring message: ${decision.reason}`);
        break;
    }
  }

  /**
   * Build message context for decision making
   */
  private async buildMessageContext(
    message: ChatMessage,
    transport: Transport
  ): Promise<MessageContext> {
    const history = await transport.getMessageHistory(message.channelId, 20);

    return {
      messages: history,
      botId: transport.getBotId(),
      botName: transport.getBotName(),
      channelName: message.channelName,
    };
  }

  /**
   * Commit changes in a session
   */
  async commitSession(
    sessionId: string,
    commitMessage: string
  ): Promise<string | null> {
    try {
      const commitHash = await this.worktreeManager.commitChanges(sessionId, commitMessage);

      const session = this.worktreeManager.getSession(sessionId);
      if (session) {
        this.emit('session:updated', session);
      }

      return commitHash;
    } catch (error) {
      console.error(`[Arbiter] Commit failed for session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Rebase a session onto main
   */
  async rebaseSession(sessionId: string): Promise<boolean> {
    try {
      const success = await this.worktreeManager.rebaseOntoMain(sessionId);

      const session = this.worktreeManager.getSession(sessionId);
      if (session) {
        this.emit('session:updated', session);
      }

      return success;
    } catch (error) {
      console.error(`[Arbiter] Rebase failed for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Complete a session and optionally push
   */
  async completeSession(
    sessionId: string,
    push: boolean = false
  ): Promise<void> {
    const session = this.worktreeManager.getSession(sessionId);
    if (!session) return;

    if (push) {
      await this.worktreeManager.pushBranch(sessionId);
    }

    await this.worktreeManager.completeSession(sessionId);
    this.emit('session:completed', session);
  }

  /**
   * Get active work sessions
   */
  getActiveSessions(): WorkSession[] {
    return this.worktreeManager.getActiveSessions();
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): WorkSession | undefined {
    return this.worktreeManager.getSession(sessionId);
  }
}

export { makeDecision, detectErrorPatterns } from './decision.js';
