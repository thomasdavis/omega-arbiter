/**
 * Session Coordinator
 * Manages session lifecycle, pending actions, and bot state transitions
 * Ensures graceful handling of restarts, shutdowns, and long-running sessions
 */

import { EventEmitter } from 'events';
import { WorkSession } from '../types.js';

/**
 * Types of actions that can be queued
 */
export type PendingActionType = 'restart' | 'shutdown' | 'cleanup';

/**
 * A pending action that will execute when all sessions complete
 */
export interface PendingAction {
  id: string;
  type: PendingActionType;
  reason: string;
  requestedAt: Date;
  requestedBy?: string; // User who requested (if applicable)
  channelId?: string;   // Channel to notify when complete
}

/**
 * Active session info for tracking
 */
export interface ActiveSession {
  id: string;
  channelId: string;
  channelName?: string;
  startedAt: Date;
  triggeredBy: string;
  description: string;
}

/**
 * Coordinator state
 */
export type CoordinatorState =
  | 'running'           // Normal operation, accepting sessions
  | 'draining'          // Waiting for sessions to complete, not accepting new ones
  | 'executing'         // Executing pending actions
  | 'stopped';          // Fully stopped

/**
 * Events emitted by the coordinator
 */
export interface CoordinatorEvents {
  'state:changed': (oldState: CoordinatorState, newState: CoordinatorState) => void;
  'session:registered': (session: ActiveSession) => void;
  'session:completed': (session: ActiveSession, remaining: number) => void;
  'action:queued': (action: PendingAction, activeSessions: number) => void;
  'action:executing': (action: PendingAction) => void;
  'action:completed': (action: PendingAction) => void;
  'all:drained': () => void;
  'notify': (message: string, channelId?: string) => void;
}

/**
 * Session Coordinator - manages bot lifecycle and session tracking
 */
export class SessionCoordinator extends EventEmitter {
  private state: CoordinatorState = 'running';
  private activeSessions: Map<string, ActiveSession> = new Map();
  private pendingActions: PendingAction[] = [];
  private actionIdCounter = 0;
  private statusChannelId: string | null = null;

  constructor() {
    super();
  }

  /**
   * Set the channel ID for status notifications
   */
  setStatusChannel(channelId: string): void {
    this.statusChannelId = channelId;
    console.log(`[Coordinator] Status channel set to ${channelId}`);
  }

  /**
   * Get the current state
   */
  getState(): CoordinatorState {
    return this.state;
  }

  /**
   * Check if new sessions can be started
   */
  canStartSession(): boolean {
    return this.state === 'running';
  }

  /**
   * Get count of active sessions
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): ActiveSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Get pending actions
   */
  getPendingActions(): PendingAction[] {
    return [...this.pendingActions];
  }

  /**
   * Register a new session
   * @throws Error if not accepting new sessions
   */
  registerSession(session: WorkSession): ActiveSession {
    if (!this.canStartSession()) {
      const pendingAction = this.pendingActions[0];
      throw new Error(
        `Not accepting new sessions - ${pendingAction?.type || 'shutdown'} pending: ${pendingAction?.reason || 'unknown'}`
      );
    }

    const activeSession: ActiveSession = {
      id: session.id,
      channelId: session.triggeredBy.channelId,
      channelName: session.triggeredBy.channelName,
      startedAt: new Date(),
      triggeredBy: session.triggeredBy.authorName,
      description: session.triggeredBy.content.slice(0, 100),
    };

    this.activeSessions.set(session.id, activeSession);
    this.emit('session:registered', activeSession);

    console.log(`[Coordinator] Session registered: ${session.id} (${this.activeSessions.size} active)`);

    // Notify status channel
    this.notify(
      `🔧 **Session Started**\n` +
      `ID: \`${session.id}\`\n` +
      `Channel: ${activeSession.channelName || 'DM'}\n` +
      `Requested by: ${activeSession.triggeredBy}\n` +
      `Task: ${activeSession.description}`
    );

    return activeSession;
  }

  /**
   * Mark a session as completed
   */
  completeSession(sessionId: string, success: boolean, summary?: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.warn(`[Coordinator] Attempted to complete unknown session: ${sessionId}`);
      return;
    }

    this.activeSessions.delete(sessionId);
    const remaining = this.activeSessions.size;

    const duration = this.formatDuration(Date.now() - session.startedAt.getTime());
    const emoji = success ? '✅' : '❌';

    console.log(`[Coordinator] Session completed: ${sessionId} (${remaining} remaining)`);

    // Notify status channel
    this.notify(
      `${emoji} **Session ${success ? 'Completed' : 'Failed'}**\n` +
      `ID: \`${sessionId}\`\n` +
      `Duration: ${duration}\n` +
      `Remaining sessions: ${remaining}` +
      (summary ? `\n\nSummary: ${summary.slice(0, 200)}` : '')
    );

    this.emit('session:completed', session, remaining);

    // Check if we should execute pending actions
    if (remaining === 0 && this.state === 'draining') {
      this.emit('all:drained');
      this.executePendingActions();
    }
  }

  /**
   * Queue a pending action (restart, shutdown, etc.)
   */
  queueAction(
    type: PendingActionType,
    reason: string,
    requestedBy?: string,
    channelId?: string
  ): PendingAction {
    const action: PendingAction = {
      id: `action-${++this.actionIdCounter}`,
      type,
      reason,
      requestedAt: new Date(),
      requestedBy,
      channelId,
    };

    this.pendingActions.push(action);
    const activeSessions = this.activeSessions.size;

    console.log(`[Coordinator] Action queued: ${type} - ${reason} (${activeSessions} sessions active)`);

    // Transition to draining state
    if (this.state === 'running') {
      this.setState('draining');
    }

    this.emit('action:queued', action, activeSessions);

    // Build notification message
    let message = `⏳ **${this.capitalizeFirst(type)} Requested**\n` +
      `Reason: ${reason}\n`;

    if (requestedBy) {
      message += `Requested by: ${requestedBy}\n`;
    }

    if (activeSessions > 0) {
      message += `\nWaiting for ${activeSessions} session(s) to complete...\n`;
      message += this.formatActiveSessionsList();
    } else {
      message += `\nNo active sessions, executing immediately...`;
    }

    this.notify(message, channelId);

    // If no active sessions, execute immediately
    if (activeSessions === 0) {
      // Use setImmediate to allow event listeners to be set up
      setImmediate(() => this.executePendingActions());
    }

    return action;
  }

  /**
   * Request a restart (convenience method)
   */
  requestRestart(reason: string, requestedBy?: string, channelId?: string): PendingAction {
    return this.queueAction('restart', reason, requestedBy, channelId);
  }

  /**
   * Request a shutdown (convenience method)
   */
  requestShutdown(reason: string, requestedBy?: string, channelId?: string): PendingAction {
    return this.queueAction('shutdown', reason, requestedBy, channelId);
  }

  /**
   * Execute all pending actions
   */
  private async executePendingActions(): Promise<void> {
    if (this.pendingActions.length === 0) {
      this.setState('running');
      return;
    }

    this.setState('executing');

    // Execute actions in order
    while (this.pendingActions.length > 0) {
      const action = this.pendingActions.shift()!;

      console.log(`[Coordinator] Executing action: ${action.type} - ${action.reason}`);
      this.emit('action:executing', action);

      this.notify(
        `🚀 **Executing ${this.capitalizeFirst(action.type)}**\n` +
        `Reason: ${action.reason}`,
        action.channelId
      );

      try {
        await this.executeAction(action);
        this.emit('action:completed', action);
      } catch (error) {
        console.error(`[Coordinator] Action failed:`, error);
        this.notify(
          `❌ **${this.capitalizeFirst(action.type)} Failed**\n` +
          `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          action.channelId
        );
      }
    }

    // If we get here without restarting/shutting down, go back to running
    this.setState('running');
  }

  /**
   * Execute a single action
   */
  private async executeAction(action: PendingAction): Promise<void> {
    switch (action.type) {
      case 'restart':
        this.notify(
          `🔄 **Restarting Now**\n` +
          `Reason: ${action.reason}\n` +
          `The bot will be back online shortly...`,
          action.channelId
        );
        // Give time for the message to be sent
        await this.sleep(1000);
        console.log('[Coordinator] Exiting for restart...');
        process.exit(0);
        break;

      case 'shutdown':
        this.notify(
          `👋 **Shutting Down**\n` +
          `Reason: ${action.reason}\n` +
          `Goodbye!`,
          action.channelId
        );
        await this.sleep(1000);
        console.log('[Coordinator] Exiting for shutdown...');
        process.exit(0);
        break;

      case 'cleanup':
        // Cleanup action - doesn't exit, just performs cleanup
        console.log('[Coordinator] Performing cleanup...');
        // Cleanup logic here if needed
        break;
    }
  }

  /**
   * Handle process signals
   */
  setupSignalHandlers(): void {
    const handleSignal = (signal: string) => {
      console.log(`[Coordinator] Received ${signal}`);

      if (this.state === 'draining' || this.state === 'executing') {
        console.log(`[Coordinator] Already ${this.state}, ignoring duplicate signal`);
        return;
      }

      this.requestShutdown(`Received ${signal} signal`);
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));

    console.log('[Coordinator] Signal handlers installed');
  }

  /**
   * Notify bot startup
   */
  notifyStartup(): void {
    const startTime = new Date().toISOString();
    this.notify(
      `🟢 **Bot Online**\n` +
      `Started at: ${startTime}\n` +
      `Ready to accept requests!`
    );
  }

  /**
   * Set the coordinator state
   */
  private setState(newState: CoordinatorState): void {
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;
    console.log(`[Coordinator] State: ${oldState} → ${newState}`);
    this.emit('state:changed', oldState, newState);
  }

  /**
   * Emit a notification
   */
  private notify(message: string, channelId?: string): void {
    const targetChannel = channelId || this.statusChannelId;
    this.emit('notify', message, targetChannel);
  }

  /**
   * Format active sessions list for display
   */
  private formatActiveSessionsList(): string {
    const sessions = this.getActiveSessions();
    if (sessions.length === 0) return 'No active sessions';

    return sessions.map(s => {
      const duration = this.formatDuration(Date.now() - s.startedAt.getTime());
      return `• \`${s.id}\` (${duration}) - ${s.description.slice(0, 50)}...`;
    }).join('\n');
  }

  /**
   * Format duration in human-readable form
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Capitalize first letter
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
let coordinatorInstance: SessionCoordinator | null = null;

export function getCoordinator(): SessionCoordinator {
  if (!coordinatorInstance) {
    coordinatorInstance = new SessionCoordinator();
  }
  return coordinatorInstance;
}
