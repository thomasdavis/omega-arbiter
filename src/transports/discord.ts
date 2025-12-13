/**
 * Discord transport - listens to Discord messages via Gateway API
 * Extracted and adapted from omega's Discord integration
 */

import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
  DMChannel,
  NewsChannel,
} from 'discord.js';
import { BaseTransport } from './base.js';
import { ChatMessage, TransportType, Attachment } from '../types.js';
import { getLogStore } from '../logs/index.js';

export class DiscordTransport extends BaseTransport {
  type: TransportType = 'discord';

  private client: Client;
  private botToken: string;
  private ready = false;
  private allowedChannelId: string | null = null;

  constructor(botToken: string, allowedChannelId?: string) {
    super();
    this.botToken = botToken;
    this.allowedChannelId = allowedChannelId ?? null;

    // Create Discord client with required intents
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent, // Required to read message content
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Bot ready event
    this.client.once(Events.ClientReady, (readyClient) => {
      console.log(`[Discord] Bot online as ${readyClient.user.tag}`);
      console.log(`[Discord] Connected to ${readyClient.guilds.cache.size} servers`);
      this.ready = true;
      this.emitReady();
    });

    // Message create event
    this.client.on(Events.MessageCreate, async (message: Message) => {
      try {
        // Ignore own messages
        if (message.author.id === this.client.user?.id) {
          return;
        }

        // Filter by allowed channel if configured
        if (this.allowedChannelId && message.channel.id !== this.allowedChannelId) {
          console.log(`[Discord] Ignoring message from channel ${message.channel.id} (not allowed channel ${this.allowedChannelId})`);
          return;
        }

        const chatMessage = this.convertMessage(message);

        // Set logging context for this message
        const logStore = getLogStore();
        logStore.setContext({
          channelId: message.channel.id,
          userId: message.author.id,
        });

        // Log incoming message
        logStore.message('Discord', `[${message.author.username}] ${message.content.slice(0, 500)}`, {
          authorId: message.author.id,
          authorName: message.author.username,
          channelName: this.getChannelName(message),
          channelId: message.channel.id,
        });

        await this.emitMessage(chatMessage);
      } catch (error) {
        console.error('[Discord] Error processing message:', error);
        this.emitError(error instanceof Error ? error : new Error(String(error)));
      }
    });

    // Error handling
    this.client.on(Events.Error, (error) => {
      console.error('[Discord] Client error:', error);
      this.emitError(error);
    });
  }

  /**
   * Convert Discord.js Message to our ChatMessage format
   */
  private convertMessage(message: Message): ChatMessage {
    const channelName = this.getChannelName(message);
    const mentionsBotId = message.mentions.users.has(this.client.user?.id ?? '');

    // Convert attachments
    const attachments: Attachment[] = message.attachments.map((att) => ({
      id: att.id,
      filename: att.name ?? 'unknown',
      url: att.url,
      contentType: att.contentType ?? undefined,
      size: att.size,
    }));

    return {
      id: message.id,
      content: message.content,
      authorId: message.author.id,
      authorName: message.author.username,
      channelId: message.channel.id,
      channelName,
      timestamp: message.createdAt,
      transport: 'discord',
      replyToId: message.reference?.messageId ?? undefined,
      mentionsBotId,
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: message,
    };
  }

  private getChannelName(message: Message): string | undefined {
    if (message.channel.isDMBased()) {
      return 'DM';
    }
    const channel = message.channel as TextChannel | NewsChannel;
    return channel.name;
  }

  async connect(): Promise<void> {
    console.log('[Discord] Connecting to Gateway...');
    await this.client.login(this.botToken);
  }

  async disconnect(): Promise<void> {
    console.log('[Discord] Disconnecting...');
    this.client.destroy();
    this.ready = false;
  }

  async send(channelId: string, content: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    if (!this.isTextBasedChannel(channel)) {
      throw new Error(`Channel ${channelId} is not text-based`);
    }

    // Log bot reply
    getLogStore().message('Bot', content.slice(0, 500), { channelId });

    // Handle Discord's 2000 character limit
    const chunks = this.chunkMessage(content, 2000);
    for (const chunk of chunks) {
      await (channel as TextChannel | DMChannel | NewsChannel).send(chunk);
    }
  }

  /**
   * Send a message and return the message ID (for later editing)
   */
  async sendAndGetId(channelId: string, content: string): Promise<string> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    if (!this.isTextBasedChannel(channel)) {
      throw new Error(`Channel ${channelId} is not text-based`);
    }

    // Truncate to Discord's limit if needed (for editable messages we want just one)
    const truncatedContent = content.length > 2000
      ? content.slice(0, 1997) + '...'
      : content;

    const sentMessage = await (channel as TextChannel | DMChannel | NewsChannel).send(truncatedContent);
    return sentMessage.id;
  }

  /**
   * Edit an existing message by ID
   */
  async editMessage(channelId: string, messageId: string, content: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    if (!this.isTextBasedChannel(channel)) {
      throw new Error(`Channel ${channelId} is not text-based`);
    }

    // Truncate to Discord's limit if needed
    const truncatedContent = content.length > 2000
      ? content.slice(0, 1997) + '...'
      : content;

    const message = await (channel as TextChannel | DMChannel | NewsChannel).messages.fetch(messageId);
    await message.edit(truncatedContent);
  }

  async react(messageId: string, channelId: string, emoji: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !this.isTextBasedChannel(channel)) {
      throw new Error(`Channel ${channelId} not found or not text-based`);
    }

    const message = await (channel as TextChannel | DMChannel | NewsChannel).messages.fetch(messageId);
    await message.react(emoji);
  }

  async getMessageHistory(channelId: string, limit = 30): Promise<ChatMessage[]> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !this.isTextBasedChannel(channel)) {
      return [];
    }

    const messages = await (channel as TextChannel | DMChannel | NewsChannel).messages.fetch({ limit });

    return messages
      .map((msg) => this.convertMessage(msg))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  getBotId(): string {
    return this.client.user?.id ?? '';
  }

  getBotName(): string {
    return this.client.user?.username ?? 'Arbiter';
  }

  /**
   * Find a channel ID by name (searches all guilds)
   */
  findChannelByName(channelName: string): string | null {
    for (const guild of this.client.guilds.cache.values()) {
      const channel = guild.channels.cache.find(
        (ch) => ch.name === channelName && this.isTextBasedChannel(ch)
      );
      if (channel) {
        return channel.id;
      }
    }
    return null;
  }

  private isTextBasedChannel(channel: unknown): boolean {
    return (
      channel instanceof TextChannel ||
      channel instanceof DMChannel ||
      channel instanceof NewsChannel
    );
  }

  private chunkMessage(content: string, maxLength: number): string[] {
    if (content.length <= maxLength) {
      return [content];
    }

    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a newline
      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // Try to split at a space
        splitIndex = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        // Force split at max length
        splitIndex = maxLength;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex).trimStart();
    }

    return chunks;
  }
}
