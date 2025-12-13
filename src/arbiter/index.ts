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
import { WorktreeManager } from '../git/worktree.js';
import { MessageQueue, MessageAggregator, QueuedMessage } from '../queue/messageQueue.js';
import { makeDecision, detectErrorPatterns } from './decision.js';
import { generateResponse, getQuickAcknowledgment } from './respond.js';
import { ClaudeRunner, buildClaudePrompt, DiscordOutputStream } from '../claude/index.js';
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

  constructor(config: ArbiterConfig) {
    super();
    this.config = config;

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

        // Queue for processing within session context
        this.messageQueue.enqueue(message, {
          sessionId: existingSession.id,
          priority: 'high',
        });

        console.log(`[Arbiter] Added message to existing session ${existingSession.id}`);
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

    // Cast to DiscordTransport for edit capabilities
    const discordTransport = transport as DiscordTransport;

    let session: WorkSession | null = null;
    let outputStream: DiscordOutputStream | null = null;

    try {
      // Create work session
      session = await this.worktreeManager.createSession(primaryMessage, taskDescription);

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

      // Run Claude Code CLI
      const runner = new ClaudeRunner();
      const result = await runner.run({
        workdir: session.worktreePath,
        prompt: claudePrompt,
        onOutput: async (event) => {
          await outputStream!.handleEvent(event);
        },
        onError: (error) => {
          console.error('[Arbiter] Claude error:', error);
        },
      });

      console.log(`[Arbiter] Claude finished with exit code ${result.exitCode}`);

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

          const mergeResult = await this.worktreeManager.mergeToMain(session.id);

          if (mergeResult.success) {
            // Send success summary
            await outputStream.finalize(
              `**Changes merged to main!**\n\n` +
              `Commit: \`${commitHash.slice(0, 8)}\`\n` +
              `Branch: \`${session.branchName}\`\n\n` +
              `**Summary:**\n${result.summary.slice(0, 1500)}`,
              true
            );

            this.emit('session:completed', session);
          } else {
            // Merge failed
            await outputStream.finalize(
              `**Changes committed but merge failed**\n\n` +
              `Error: ${mergeResult.error}\n\n` +
              `Branch \`${session.branchName}\` has been kept for manual resolution.\n` +
              `Commit: \`${commitHash.slice(0, 8)}\``,
              false
            );
          }
        } else {
          // No changes to commit
          await outputStream.finalize(
            `**No changes were made**\n\n` +
            `Claude completed but didn't modify any files.\n\n` +
            `Summary: ${result.summary.slice(0, 1500)}`,
            true
          );
        }
      } else {
        // Claude failed
        await outputStream.finalize(
          `**Task failed**\n\n` +
          `Exit code: ${result.exitCode}\n\n` +
          `Branch \`${session.branchName}\` has been kept for debugging.\n\n` +
          `Output: ${result.summary.slice(0, 1500)}`,
          false
        );
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
