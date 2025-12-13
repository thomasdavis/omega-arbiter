/**
 * Message Queue System
 * Handles successive messages that contribute to ongoing work sessions
 * Allows multiple chat messages to influence self-editing workflows
 */

import { EventEmitter } from 'events';
import { ChatMessage, WorkSession } from '../types.js';

/**
 * Queued message with metadata
 */
export interface QueuedMessage {
  message: ChatMessage;
  sessionId?: string;       // Associated work session if any
  priority: MessagePriority;
  enqueuedAt: Date;
  processedAt?: Date;
  status: QueuedMessageStatus;
}

export type MessagePriority = 'low' | 'normal' | 'high' | 'urgent';
export type QueuedMessageStatus = 'queued' | 'processing' | 'completed' | 'failed';

/**
 * Events emitted by the queue
 */
export interface QueueEvents {
  'message:queued': (qm: QueuedMessage) => void;
  'message:processing': (qm: QueuedMessage) => void;
  'message:completed': (qm: QueuedMessage) => void;
  'message:failed': (qm: QueuedMessage, error: Error) => void;
  'session:updated': (sessionId: string, messages: ChatMessage[]) => void;
}

/**
 * Message queue for managing chat message flow
 */
export class MessageQueue extends EventEmitter {
  private queue: QueuedMessage[] = [];
  private sessionMessages: Map<string, QueuedMessage[]> = new Map();
  private processing = false;
  private processor?: (qm: QueuedMessage) => Promise<void>;

  // Configuration
  private maxQueueSize: number;
  private processDelay: number; // ms between processing messages
  private batchWindow: number;  // ms to wait for related messages

  constructor(options: {
    maxQueueSize?: number;
    processDelay?: number;
    batchWindow?: number;
  } = {}) {
    super();
    this.maxQueueSize = options.maxQueueSize ?? 1000;
    this.processDelay = options.processDelay ?? 100;
    this.batchWindow = options.batchWindow ?? 2000; // 2 seconds to batch related messages
  }

  /**
   * Set the message processor function
   */
  setProcessor(processor: (qm: QueuedMessage) => Promise<void>): void {
    this.processor = processor;
  }

  /**
   * Add a message to the queue
   */
  enqueue(
    message: ChatMessage,
    options: {
      sessionId?: string;
      priority?: MessagePriority;
    } = {}
  ): QueuedMessage {
    if (this.queue.length >= this.maxQueueSize) {
      // Remove oldest low-priority message
      const lowPriorityIndex = this.queue.findIndex((m) => m.priority === 'low');
      if (lowPriorityIndex !== -1) {
        this.queue.splice(lowPriorityIndex, 1);
      } else {
        throw new Error('Queue is full');
      }
    }

    const queuedMessage: QueuedMessage = {
      message,
      sessionId: options.sessionId,
      priority: options.priority ?? 'normal',
      enqueuedAt: new Date(),
      status: 'queued',
    };

    // Insert based on priority
    const insertIndex = this.findInsertIndex(queuedMessage.priority);
    this.queue.splice(insertIndex, 0, queuedMessage);

    // Track session messages
    if (options.sessionId) {
      const sessionMsgs = this.sessionMessages.get(options.sessionId) ?? [];
      sessionMsgs.push(queuedMessage);
      this.sessionMessages.set(options.sessionId, sessionMsgs);
    }

    this.emit('message:queued', queuedMessage);

    // Start processing if not already
    if (!this.processing && this.processor) {
      this.startProcessing();
    }

    return queuedMessage;
  }

  /**
   * Associate a message with a work session
   */
  associateWithSession(messageId: string, sessionId: string): void {
    const qm = this.queue.find((m) => m.message.id === messageId);
    if (qm) {
      qm.sessionId = sessionId;

      const sessionMsgs = this.sessionMessages.get(sessionId) ?? [];
      sessionMsgs.push(qm);
      this.sessionMessages.set(sessionId, sessionMsgs);

      this.emit('session:updated', sessionId, sessionMsgs.map((m) => m.message));
    }
  }

  /**
   * Get all messages for a session
   */
  getSessionMessages(sessionId: string): ChatMessage[] {
    const sessionMsgs = this.sessionMessages.get(sessionId) ?? [];
    return sessionMsgs.map((m) => m.message);
  }

  /**
   * Get pending messages for a session
   */
  getPendingSessionMessages(sessionId: string): ChatMessage[] {
    const sessionMsgs = this.sessionMessages.get(sessionId) ?? [];
    return sessionMsgs
      .filter((m) => m.status === 'queued')
      .map((m) => m.message);
  }

  /**
   * Wait for batch window to collect related messages
   */
  async waitForBatch(channelId: string): Promise<ChatMessage[]> {
    const startTime = Date.now();
    const collected: ChatMessage[] = [];

    // Collect messages from the same channel within the batch window
    while (Date.now() - startTime < this.batchWindow) {
      const pending = this.queue.filter(
        (m) =>
          m.status === 'queued' &&
          m.message.channelId === channelId
      );

      if (pending.length > collected.length) {
        collected.push(...pending.slice(collected.length).map((m) => m.message));
      }

      await this.sleep(100);
    }

    return collected;
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    total: number;
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    byPriority: Record<MessagePriority, number>;
  } {
    const stats = {
      total: this.queue.length,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      byPriority: {
        urgent: 0,
        high: 0,
        normal: 0,
        low: 0,
      },
    };

    for (const qm of this.queue) {
      stats[qm.status]++;
      stats.byPriority[qm.priority]++;
    }

    return stats;
  }

  /**
   * Clear completed messages older than specified age
   */
  cleanup(maxAgeMs: number = 3600000): number {
    const cutoff = Date.now() - maxAgeMs;
    const initialLength = this.queue.length;

    this.queue = this.queue.filter((qm) => {
      if (qm.status === 'completed' || qm.status === 'failed') {
        const completedTime = qm.processedAt?.getTime() ?? qm.enqueuedAt.getTime();
        return completedTime > cutoff;
      }
      return true;
    });

    return initialLength - this.queue.length;
  }

  /**
   * Start the processing loop
   */
  private async startProcessing(): Promise<void> {
    if (this.processing || !this.processor) return;

    this.processing = true;

    while (this.processing) {
      const next = this.queue.find((m) => m.status === 'queued');
      if (!next) {
        // No more messages to process
        await this.sleep(this.processDelay);
        continue;
      }

      next.status = 'processing';
      this.emit('message:processing', next);

      try {
        await this.processor(next);
        next.status = 'completed';
        next.processedAt = new Date();
        this.emit('message:completed', next);
      } catch (error) {
        next.status = 'failed';
        next.processedAt = new Date();
        this.emit('message:failed', next, error instanceof Error ? error : new Error(String(error)));
      }

      await this.sleep(this.processDelay);
    }
  }

  /**
   * Stop processing
   */
  stop(): void {
    this.processing = false;
  }

  /**
   * Find insert index based on priority
   */
  private findInsertIndex(priority: MessagePriority): number {
    const priorityOrder: MessagePriority[] = ['urgent', 'high', 'normal', 'low'];
    const priorityLevel = priorityOrder.indexOf(priority);

    for (let i = 0; i < this.queue.length; i++) {
      const qmLevel = priorityOrder.indexOf(this.queue[i].priority);
      if (qmLevel > priorityLevel) {
        return i;
      }
    }

    return this.queue.length;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Message aggregator for combining related messages
 */
export class MessageAggregator {
  private channelBuffers: Map<string, {
    messages: ChatMessage[];
    lastUpdate: Date;
  }> = new Map();

  private aggregationWindow: number;

  constructor(aggregationWindowMs: number = 3000) {
    this.aggregationWindow = aggregationWindowMs;
  }

  /**
   * Add a message and check if we should aggregate
   */
  addMessage(message: ChatMessage): {
    shouldAggregate: boolean;
    messages: ChatMessage[];
  } {
    const buffer = this.channelBuffers.get(message.channelId) ?? {
      messages: [],
      lastUpdate: new Date(),
    };

    buffer.messages.push(message);
    buffer.lastUpdate = new Date();
    this.channelBuffers.set(message.channelId, buffer);

    // Check if we're past the aggregation window
    const oldestMessage = buffer.messages[0];
    const timeSinceFirst = Date.now() - oldestMessage.timestamp.getTime();

    if (timeSinceFirst >= this.aggregationWindow) {
      // Time to aggregate
      const messages = [...buffer.messages];
      buffer.messages = [];
      return { shouldAggregate: true, messages };
    }

    return { shouldAggregate: false, messages: buffer.messages };
  }

  /**
   * Force aggregation for a channel (e.g., when a trigger word is detected)
   */
  forceAggregate(channelId: string): ChatMessage[] {
    const buffer = this.channelBuffers.get(channelId);
    if (!buffer) return [];

    const messages = [...buffer.messages];
    buffer.messages = [];
    return messages;
  }

  /**
   * Get current buffer for a channel
   */
  getBuffer(channelId: string): ChatMessage[] {
    return this.channelBuffers.get(channelId)?.messages ?? [];
  }

  /**
   * Clear old buffers
   */
  cleanup(maxAgeMs: number = 60000): void {
    const cutoff = Date.now() - maxAgeMs;

    for (const [channelId, buffer] of this.channelBuffers) {
      if (buffer.lastUpdate.getTime() < cutoff) {
        this.channelBuffers.delete(channelId);
      }
    }
  }
}
