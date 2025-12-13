/**
 * Discord Output Stream
 * Handles streaming Claude output to Discord with throttling
 */

import { DiscordTransport } from '../transports/discord.js';
import { ClaudeEvent } from './runner.js';

export class DiscordOutputStream {
  private messageId: string | null = null;
  private lastUpdate: number = 0;
  private buffer: string = '';
  private pendingUpdate: NodeJS.Timeout | null = null;

  constructor(
    private transport: DiscordTransport,
    private channelId: string,
    private throttleMs: number = 2000
  ) {}

  /**
   * Send the initial status message and store its ID for later updates
   */
  async start(content: string): Promise<void> {
    try {
      this.messageId = await this.transport.sendAndGetId(this.channelId, content);
      this.lastUpdate = Date.now();
      this.buffer = content;
    } catch (error) {
      console.error('[DiscordOutputStream] Failed to send initial message:', error);
      throw error;
    }
  }

  /**
   * Handle a Claude event and update Discord accordingly
   */
  async handleEvent(event: ClaudeEvent): Promise<void> {
    // Add event content to buffer based on type
    switch (event.type) {
      case 'text':
        this.buffer += '\n' + event.content;
        break;
      case 'tool_use':
        this.buffer += `\n🔧 ${event.content}`;
        break;
      case 'tool_result':
        // Tool results can be verbose, just note them
        this.buffer += '\n✓ Tool completed';
        break;
      case 'error':
        this.buffer += `\n❌ Error: ${event.content}`;
        break;
      case 'result':
        this.buffer += `\n\n📋 **Result:**\n${event.content}`;
        break;
      default:
        // Ignore other event types
        break;
    }

    // Throttle updates
    await this.maybeUpdate();
  }

  /**
   * Update Discord message if enough time has passed
   */
  private async maybeUpdate(): Promise<void> {
    const now = Date.now();

    if (now - this.lastUpdate >= this.throttleMs) {
      await this.doUpdate();
    } else if (!this.pendingUpdate) {
      // Schedule an update for later
      const delay = this.throttleMs - (now - this.lastUpdate);
      this.pendingUpdate = setTimeout(async () => {
        this.pendingUpdate = null;
        await this.doUpdate();
      }, delay);
    }
  }

  /**
   * Actually update the Discord message
   */
  private async doUpdate(): Promise<void> {
    if (!this.messageId) return;

    try {
      // Truncate buffer if too long (keep last ~1800 chars)
      let displayContent = this.buffer;
      if (displayContent.length > 1800) {
        displayContent = '...\n' + displayContent.slice(-1750);
      }

      await this.transport.editMessage(this.channelId, this.messageId, displayContent);
      this.lastUpdate = Date.now();
    } catch (error) {
      console.error('[DiscordOutputStream] Failed to update message:', error);
    }
  }

  /**
   * Force an immediate update
   */
  async flush(): Promise<void> {
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }
    await this.doUpdate();
  }

  /**
   * Finalize the stream - send a completion message
   */
  async finalize(summary: string, success: boolean): Promise<void> {
    // Cancel any pending updates
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }

    // Update the status message to show completion
    if (this.messageId) {
      try {
        const statusEmoji = success ? '✅' : '❌';
        const statusText = success ? 'Completed' : 'Failed';

        // Truncate the current buffer for the status message
        let statusContent = this.buffer;
        if (statusContent.length > 1500) {
          statusContent = '...\n' + statusContent.slice(-1400);
        }
        statusContent += `\n\n${statusEmoji} **${statusText}**`;

        await this.transport.editMessage(this.channelId, this.messageId, statusContent);
      } catch (error) {
        console.error('[DiscordOutputStream] Failed to update final status:', error);
      }
    }

    // Send the full summary as a new message if it's substantial
    if (summary && summary.length > 50) {
      try {
        // Format the summary nicely
        const formattedSummary = formatSummary(summary, success);
        await this.transport.send(this.channelId, formattedSummary);
      } catch (error) {
        console.error('[DiscordOutputStream] Failed to send summary:', error);
      }
    }
  }

  /**
   * Get the current buffer content
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Append content directly to the buffer
   */
  append(content: string): void {
    this.buffer += content;
  }
}

/**
 * Format the final summary for Discord
 */
function formatSummary(summary: string, success: boolean): string {
  const emoji = success ? '🎉' : '⚠️';
  const header = success ? 'Changes Complete' : 'Task Incomplete';

  // Truncate if needed (Discord has 2000 char limit)
  let content = summary;
  if (content.length > 1800) {
    content = content.slice(0, 1750) + '\n\n...(truncated)';
  }

  return `${emoji} **${header}**\n\n${content}`;
}

/**
 * Create a progress indicator string
 */
export function createProgressIndicator(step: string, detail?: string): string {
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const frame = spinner[Math.floor(Date.now() / 100) % spinner.length];

  if (detail) {
    return `${frame} ${step}\n└─ ${detail}`;
  }
  return `${frame} ${step}`;
}
