/**
 * Core types for the Omega Arbiter system
 */

/**
 * Represents a message from any chat transport
 */
export interface ChatMessage {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  channelId: string;
  channelName?: string;
  timestamp: Date;
  transport: TransportType;

  // Optional metadata
  replyToId?: string;
  mentionsBotId?: boolean;
  attachments?: Attachment[];

  // Raw transport-specific data
  raw?: unknown;
}

export interface Attachment {
  id: string;
  filename: string;
  url: string;
  contentType?: string;
  size?: number;
}

export type TransportType = 'discord' | 'slack' | 'cli' | 'webhook';

/**
 * Decision from the arbiter about whether/how to act
 */
export interface ArbiterDecision {
  shouldAct: boolean;
  confidence: number;
  reason: string;
  actionType: ActionType;
  suggestedApproach?: string;
}

export type ActionType =
  | 'ignore'           // Do nothing
  | 'acknowledge'      // Simple acknowledgment (emoji, short reply)
  | 'respond'          // Generate a response
  | 'self_edit'        // Create worktree and edit own code
  | 'research'         // Gather information before acting
  | 'defer';           // Queue for later processing

/**
 * Represents a work session in a git worktree
 */
export interface WorkSession {
  id: string;
  worktreePath: string;
  branchName: string;
  triggeredBy: ChatMessage;
  relatedMessages: ChatMessage[];
  status: WorkSessionStatus;
  createdAt: Date;
  updatedAt: Date;
  commits: string[];

  // Checkpoint & Continue fields
  pendingMessages: ChatMessage[];    // Follow-up messages awaiting delivery
  shouldCheckpoint: boolean;         // Flag to trigger checkpoint on next tool_result
  checkpointCount: number;           // Number of checkpoints in this session
}

export type WorkSessionStatus =
  | 'creating'
  | 'active'
  | 'committing'
  | 'rebasing'
  | 'completed'
  | 'failed'
  | 'abandoned';

/**
 * Message history context for decision making
 */
export interface MessageContext {
  messages: ChatMessage[];
  botId: string;
  botName: string;
  channelName?: string;
}

/**
 * Event emitted by transports
 */
export interface TransportEvent {
  type: 'message' | 'ready' | 'error' | 'disconnect';
  message?: ChatMessage;
  error?: Error;
}

/**
 * Transport interface - all chat sources implement this
 */
export interface Transport {
  type: TransportType;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Event handlers
  onMessage(handler: (message: ChatMessage) => Promise<void>): void;
  onReady(handler: () => void): void;
  onError(handler: (error: Error) => void): void;

  // Sending
  send(channelId: string, content: string): Promise<void>;
  react(messageId: string, channelId: string, emoji: string): Promise<void>;

  // Context
  getMessageHistory(channelId: string, limit?: number): Promise<ChatMessage[]>;
  getBotId(): string;
  getBotName(): string;
}

/**
 * Configuration for the arbiter
 */
export interface ArbiterConfig {
  model: string;
  confidenceThreshold: number;
  gitRepoPath: string;
  worktreeBasePath: string;
  defaultBranch: string;
}
