/**
 * Base transport class with common functionality
 */

import { ChatMessage, Transport, TransportType } from '../types.js';

export abstract class BaseTransport implements Transport {
  abstract type: TransportType;

  protected messageHandlers: ((message: ChatMessage) => Promise<void>)[] = [];
  protected readyHandlers: (() => void)[] = [];
  protected errorHandlers: ((error: Error) => void)[] = [];

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(channelId: string, content: string): Promise<void>;
  abstract react(messageId: string, channelId: string, emoji: string): Promise<void>;
  abstract getMessageHistory(channelId: string, limit?: number): Promise<ChatMessage[]>;
  abstract getBotId(): string;
  abstract getBotName(): string;

  onMessage(handler: (message: ChatMessage) => Promise<void>): void {
    this.messageHandlers.push(handler);
  }

  onReady(handler: () => void): void {
    this.readyHandlers.push(handler);
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandlers.push(handler);
  }

  protected async emitMessage(message: ChatMessage): Promise<void> {
    for (const handler of this.messageHandlers) {
      try {
        await handler(message);
      } catch (error) {
        console.error('Error in message handler:', error);
        this.emitError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  protected emitReady(): void {
    for (const handler of this.readyHandlers) {
      try {
        handler();
      } catch (error) {
        console.error('Error in ready handler:', error);
      }
    }
  }

  protected emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch (err) {
        console.error('Error in error handler:', err);
      }
    }
  }
}
