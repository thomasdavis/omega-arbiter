/**
 * Claude Code CLI Runner
 * Spawns Claude in headless mode and streams output
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface ClaudeEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'result' | 'error' | 'system';
  content: string;
  raw?: unknown;
}

export interface ClaudeRunnerConfig {
  workdir: string;
  prompt: string;
  onOutput?: (event: ClaudeEvent) => void;
  onError?: (error: string) => void;
}

export interface ClaudeRunResult {
  exitCode: number;
  summary: string;
  success: boolean;
}

export class ClaudeRunner extends EventEmitter {
  private process: ChildProcess | null = null;
  private aborted = false;

  /**
   * Run Claude Code CLI in headless mode
   */
  async run(config: ClaudeRunnerConfig): Promise<ClaudeRunResult> {
    const { workdir, prompt, onOutput, onError } = config;

    return new Promise((resolve) => {
      const args = [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', 'acceptEdits',
      ];

      console.log(`[ClaudeRunner] Starting in ${workdir}`);
      console.log(`[ClaudeRunner] Prompt: ${prompt.slice(0, 200)}...`);

      this.process = spawn('claude', args, {
        cwd: workdir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Ensure Claude uses the correct working directory
          PWD: workdir,
        },
      });

      let buffer = '';
      let lastContent = '';
      let errorOutput = '';

      // Handle stdout (stream-json output)
      this.process.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');

        // stream-json is newline-delimited JSON
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = this.parseStreamEvent(line);
            if (event) {
              lastContent = event.content || lastContent;
              onOutput?.(event);
              this.emit('output', event);
            }
          } catch (err) {
            // Log but don't fail on parse errors
            console.warn('[ClaudeRunner] Parse error:', err);
          }
        }
      });

      // Handle stderr
      this.process.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        errorOutput += text;
        onError?.(text);
        this.emit('error', text);
      });

      // Handle process exit
      this.process.on('close', (code) => {
        const exitCode = code ?? 1;
        console.log(`[ClaudeRunner] Process exited with code ${exitCode}`);

        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const event = this.parseStreamEvent(buffer);
            if (event) {
              lastContent = event.content || lastContent;
              onOutput?.(event);
            }
          } catch {
            // Ignore final parse errors
          }
        }

        resolve({
          exitCode,
          summary: lastContent || errorOutput || 'No output captured',
          success: exitCode === 0 && !this.aborted,
        });
      });

      // Handle spawn errors
      this.process.on('error', (err) => {
        console.error('[ClaudeRunner] Spawn error:', err);
        onError?.(err.message);
        resolve({
          exitCode: 1,
          summary: `Failed to start Claude: ${err.message}`,
          success: false,
        });
      });
    });
  }

  /**
   * Parse a stream-json event from Claude
   */
  private parseStreamEvent(line: string): ClaudeEvent | null {
    try {
      const data = JSON.parse(line);

      // Handle different event types from Claude's stream-json output
      if (data.type === 'assistant') {
        // Assistant message with content
        const textContent = data.message?.content?.find(
          (c: { type: string }) => c.type === 'text'
        );
        if (textContent?.text) {
          return {
            type: 'text',
            content: textContent.text,
            raw: data,
          };
        }
      }

      if (data.type === 'content_block_delta') {
        // Streaming text delta
        if (data.delta?.type === 'text_delta' && data.delta?.text) {
          return {
            type: 'text',
            content: data.delta.text,
            raw: data,
          };
        }
      }

      if (data.type === 'tool_use' || data.message?.content?.some(
        (c: { type: string }) => c.type === 'tool_use'
      )) {
        // Tool usage
        const toolUse = data.message?.content?.find(
          (c: { type: string }) => c.type === 'tool_use'
        ) || data;
        return {
          type: 'tool_use',
          content: `Using tool: ${toolUse.name || 'unknown'}`,
          raw: data,
        };
      }

      if (data.type === 'tool_result') {
        return {
          type: 'tool_result',
          content: typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
          raw: data,
        };
      }

      if (data.type === 'result') {
        // Final result
        return {
          type: 'result',
          content: data.result || data.message || 'Completed',
          raw: data,
        };
      }

      if (data.type === 'system' || data.type === 'error') {
        return {
          type: data.type,
          content: data.message || data.error || JSON.stringify(data),
          raw: data,
        };
      }

      // For any other event type, try to extract meaningful content
      if (data.message || data.text || data.content) {
        return {
          type: 'system',
          content: data.message || data.text ||
            (typeof data.content === 'string' ? data.content : JSON.stringify(data.content)),
          raw: data,
        };
      }

      return null;
    } catch {
      // Not JSON, treat as plain text
      return {
        type: 'text',
        content: line,
      };
    }
  }

  /**
   * Abort the running Claude process
   */
  abort(): void {
    if (this.process && !this.aborted) {
      console.log('[ClaudeRunner] Aborting process...');
      this.aborted = true;
      this.process.kill('SIGTERM');

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          console.log('[ClaudeRunner] Force killing process...');
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  /**
   * Check if Claude CLI is available
   */
  static async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', ['claude']);
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.on('error', () => {
        resolve(false);
      });
    });
  }
}
