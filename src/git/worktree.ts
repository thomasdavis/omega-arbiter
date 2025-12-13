/**
 * Git Worktree Manager
 * Creates and manages git worktrees for self-editing workflows
 * Each message/task gets its own worktree to work in isolation
 */

import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { mkdir, rm, access, readdir, symlink } from 'fs/promises';
import { join } from 'path';
import { WorkSession, WorkSessionStatus, ChatMessage } from '../types.js';

/**
 * Result of a merge operation
 */
export interface MergeResult {
  success: boolean;
  error?: string;
  conflictType?: 'local_changes' | 'untracked_files' | 'merge_conflict' | 'other';
  conflictDetails?: string;
}

const execFileAsync = promisify(execFile);

/**
 * Configuration for the worktree manager
 */
export interface WorktreeConfig {
  repoPath: string;        // Path to the main git repo
  worktreeBase: string;    // Base directory for worktrees
  defaultBranch: string;   // Default branch to branch from (e.g., 'main')
}

/**
 * Manages git worktrees for isolated development sessions
 */
export class WorktreeManager {
  private config: WorktreeConfig;
  private sessions: Map<string, WorkSession> = new Map();

  constructor(config: WorktreeConfig) {
    this.config = config;
  }

  /**
   * Initialize the worktree manager
   * Creates base directory if it doesn't exist
   */
  async initialize(): Promise<void> {
    try {
      await mkdir(this.config.worktreeBase, { recursive: true });
      console.log(`[Worktree] Initialized at ${this.config.worktreeBase}`);

      // Clean up any stale worktrees
      await this.cleanupStaleWorktrees();
    } catch (error) {
      console.error('[Worktree] Initialization error:', error);
      throw error;
    }
  }

  /**
   * Create a new work session with a fresh worktree
   */
  async createSession(
    triggeredBy: ChatMessage,
    taskDescription: string
  ): Promise<WorkSession> {
    const sessionId = this.generateSessionId();
    const branchName = this.generateBranchName(taskDescription);
    const worktreePath = join(this.config.worktreeBase, sessionId);

    const session: WorkSession = {
      id: sessionId,
      worktreePath,
      branchName,
      triggeredBy,
      relatedMessages: [triggeredBy],
      status: 'creating',
      createdAt: new Date(),
      updatedAt: new Date(),
      commits: [],
      // Checkpoint & Continue fields
      pendingMessages: [],
      shouldCheckpoint: false,
      checkpointCount: 0,
    };

    this.sessions.set(sessionId, session);

    try {
      // Try to fetch latest from remote (optional - may not have remote configured)
      try {
        await this.gitCommand('fetch origin', this.config.repoPath);
        console.log('[Worktree] Fetched from origin');
      } catch {
        console.log('[Worktree] No remote to fetch from, using local branch');
      }

      // Create new branch from default branch (try origin first, fall back to local)
      try {
        await this.gitCommand(
          `branch ${branchName} origin/${this.config.defaultBranch}`,
          this.config.repoPath
        );
      } catch {
        // No origin, branch from local default branch
        await this.gitCommand(
          `branch ${branchName} ${this.config.defaultBranch}`,
          this.config.repoPath
        );
      }

      // Create worktree
      await this.gitCommand(
        `worktree add "${worktreePath}" ${branchName}`,
        this.config.repoPath
      );

      // Symlink node_modules from main repo (required for pre-commit hooks)
      const mainNodeModules = join(this.config.repoPath, 'node_modules');
      const worktreeNodeModules = join(worktreePath, 'node_modules');
      try {
        await symlink(mainNodeModules, worktreeNodeModules, 'dir');
        console.log(`[Worktree] Symlinked node_modules for session ${sessionId}`);
      } catch (symlinkError) {
        // Might fail if node_modules doesn't exist or already linked
        console.warn(`[Worktree] Could not symlink node_modules:`, symlinkError);
      }

      session.status = 'active';
      session.updatedAt = new Date();

      console.log(`[Worktree] Created session ${sessionId} at ${worktreePath}`);
      return session;
    } catch (error) {
      session.status = 'failed';
      session.updatedAt = new Date();
      console.error(`[Worktree] Failed to create session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Add a related message to an existing session
   */
  addMessageToSession(sessionId: string, message: ChatMessage): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.relatedMessages.push(message);
      session.updatedAt = new Date();
    }
  }

  /**
   * Get an active session by ID
   */
  getSession(sessionId: string): WorkSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): WorkSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === 'active' || s.status === 'creating'
    );
  }

  /**
   * Find session by channel (for continuing work)
   */
  findSessionByChannel(channelId: string): WorkSession | undefined {
    return Array.from(this.sessions.values()).find(
      (s) =>
        s.status === 'active' &&
        s.triggeredBy.channelId === channelId
    );
  }

  /**
   * Stage and commit changes in a session's worktree
   */
  async commitChanges(
    sessionId: string,
    commitMessage: string
  ): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.status = 'committing';
    session.updatedAt = new Date();

    try {
      // Stage all changes
      await this.gitCommand('add -A', session.worktreePath);

      // Check if there are changes to commit
      const status = await this.gitCommand('status --porcelain', session.worktreePath);
      if (!status.trim()) {
        console.log(`[Worktree] No changes to commit in session ${sessionId}`);
        session.status = 'active';
        return '';
      }

      // Commit with message
      const fullMessage = `${commitMessage}\n\nTriggered by: ${session.triggeredBy.authorName}\nChannel: ${session.triggeredBy.channelName || 'DM'}`;
      await this.gitCommand(
        `commit -m "${this.escapeMessage(fullMessage)}"`,
        session.worktreePath
      );

      // Get the commit hash
      const { stdout: hash } = await execFileAsync(
        '/usr/bin/git', ['rev-parse', 'HEAD'],
        { cwd: session.worktreePath, env: { ...process.env, PATH: '/usr/bin:/bin' } }
      );
      const commitHash = hash.trim();
      session.commits.push(commitHash);
      session.status = 'active';
      session.updatedAt = new Date();

      console.log(`[Worktree] Committed ${commitHash.slice(0, 8)} in session ${sessionId}`);
      return commitHash;
    } catch (error) {
      session.status = 'active'; // Revert to active on failure
      console.error(`[Worktree] Commit failed in session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Rebase session branch onto latest default branch
   */
  async rebaseOntoMain(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.status = 'rebasing';
    session.updatedAt = new Date();

    try {
      // Fetch latest
      await this.gitCommand('fetch origin', session.worktreePath);

      // Rebase onto default branch
      await this.gitCommand(
        `rebase origin/${this.config.defaultBranch}`,
        session.worktreePath
      );

      session.status = 'active';
      session.updatedAt = new Date();

      console.log(`[Worktree] Successfully rebased session ${sessionId}`);
      return true;
    } catch (error) {
      // Rebase failed - abort and report
      try {
        await this.gitCommand('rebase --abort', session.worktreePath);
      } catch {
        // Abort might fail if already aborted
      }

      session.status = 'active';
      session.updatedAt = new Date();

      console.error(`[Worktree] Rebase failed in session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Push session branch to remote
   */
  async pushBranch(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    await this.gitCommand(
      `push -u origin ${session.branchName}`,
      session.worktreePath
    );

    console.log(`[Worktree] Pushed branch ${session.branchName}`);
  }

  /**
   * Merge session branch directly into main branch
   * This runs in the MAIN repo, not the worktree
   */
  async mergeToMain(sessionId: string): Promise<MergeResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: `Session ${sessionId} not found` };
    }

    const { repoPath, defaultBranch } = this.config;
    const { branchName, triggeredBy } = session;

    console.log(`[Worktree] Merging ${branchName} into ${defaultBranch}...`);

    try {
      // Fetch latest from origin (ignore errors if no remote)
      try {
        await this.gitCommand('fetch origin', repoPath);
      } catch {
        console.log('[Worktree] No remote to fetch from, continuing...');
      }

      // Checkout the default branch in main repo
      await this.gitCommand(`checkout ${defaultBranch}`, repoPath);

      // Pull latest changes (ignore errors if no remote)
      try {
        await this.gitCommand(`pull origin ${defaultBranch}`, repoPath);
      } catch {
        console.log('[Worktree] No remote to pull from, continuing...');
      }

      // Merge the session branch with a descriptive message
      const mergeMessage = `Merge ${branchName}: Self-edit by ${triggeredBy.authorName}`;
      try {
        await this.gitCommand(
          `merge ${branchName} --no-ff -m "${this.escapeMessage(mergeMessage)}"`,
          repoPath
        );
      } catch (mergeError) {
        const errorStr = mergeError instanceof Error ? mergeError.message : String(mergeError);

        // Check if it's a merge conflict
        const status = await this.gitCommand('status', repoPath);
        if (status.includes('Unmerged') || status.includes('both modified')) {
          // Abort the merge
          await this.gitCommand('merge --abort', repoPath);
          return {
            success: false,
            error: 'Merge conflict detected.',
            conflictType: 'merge_conflict',
            conflictDetails: status,
          };
        }

        // Check for local changes blocking merge
        if (errorStr.includes('local changes') || errorStr.includes('would be overwritten')) {
          return {
            success: false,
            error: 'Local changes would be overwritten by merge.',
            conflictType: 'local_changes',
            conflictDetails: errorStr,
          };
        }

        // Check for untracked files
        if (errorStr.includes('untracked working tree files')) {
          return {
            success: false,
            error: 'Untracked files would be overwritten by merge.',
            conflictType: 'untracked_files',
            conflictDetails: errorStr,
          };
        }

        throw mergeError;
      }

      // Push to origin (ignore errors if no remote)
      try {
        await this.gitCommand(`push origin ${defaultBranch}`, repoPath);
      } catch {
        console.log('[Worktree] No remote to push to, continuing...');
      }

      console.log(`[Worktree] Successfully merged ${branchName} into ${defaultBranch}`);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Worktree] Merge failed:`, errorMessage);

      // Try to restore main repo to clean state
      try {
        await this.gitCommand(`checkout ${defaultBranch}`, repoPath);
        try {
          await this.gitCommand(`reset --hard origin/${defaultBranch}`, repoPath);
        } catch {
          // No remote, just reset to HEAD
          await this.gitCommand(`reset --hard HEAD`, repoPath);
        }
      } catch {
        // Ignore cleanup errors
      }

      return {
        success: false,
        error: `Merge failed: ${errorMessage}`,
        conflictType: 'other',
        conflictDetails: errorMessage,
      };
    }
  }

  /**
   * Get the main repo path (for conflict resolution)
   */
  getRepoPath(): string {
    return this.config.repoPath;
  }

  /**
   * Get the default branch name
   */
  getDefaultBranch(): string {
    return this.config.defaultBranch;
  }

  /**
   * Complete and cleanup a session
   */
  async completeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      // Remove worktree
      await this.gitCommand(
        `worktree remove "${session.worktreePath}" --force`,
        this.config.repoPath
      );

      // Optionally delete the branch (commented out - keep for PR)
      // await this.gitCommand(`branch -D ${session.branchName}`, this.config.repoPath);

      session.status = 'completed';
      session.updatedAt = new Date();

      console.log(`[Worktree] Completed session ${sessionId}`);
    } catch (error) {
      console.error(`[Worktree] Error completing session ${sessionId}:`, error);
      // Try direct removal
      try {
        await rm(session.worktreePath, { recursive: true, force: true });
      } catch {
        // Ignore
      }
      session.status = 'completed';
    }
  }

  /**
   * Abandon a session without completing work
   */
  async abandonSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    try {
      await this.gitCommand(
        `worktree remove "${session.worktreePath}" --force`,
        this.config.repoPath
      );

      // Delete the branch since work is abandoned
      await this.gitCommand(
        `branch -D ${session.branchName}`,
        this.config.repoPath
      );
    } catch {
      // Try direct removal
      try {
        await rm(session.worktreePath, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }

    session.status = 'abandoned';
    session.updatedAt = new Date();
    console.log(`[Worktree] Abandoned session ${sessionId}`);
  }

  /**
   * Get diff of uncommitted changes in a session
   */
  async getDiff(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const diff = await this.gitCommand('diff HEAD', session.worktreePath);
    return diff;
  }

  /**
   * Get list of changed files in a session
   */
  async getChangedFiles(sessionId: string): Promise<string[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const status = await this.gitCommand('status --porcelain', session.worktreePath);
    return status
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.slice(3)); // Remove status prefix
  }

  /**
   * Clean up stale worktrees on startup
   */
  private async cleanupStaleWorktrees(): Promise<void> {
    try {
      // List all worktrees
      const { stdout } = await execFileAsync(
        '/usr/bin/git', ['worktree', 'list', '--porcelain'],
        { cwd: this.config.repoPath, env: { ...process.env, PATH: '/usr/bin:/bin' } }
      );

      // Prune stale worktrees
      await this.gitCommand('worktree prune', this.config.repoPath);

      // Clean up any orphaned directories in worktree base
      try {
        const dirs = await readdir(this.config.worktreeBase);
        for (const dir of dirs) {
          const dirPath = join(this.config.worktreeBase, dir);
          try {
            await access(join(dirPath, '.git'));
          } catch {
            // No .git file means orphaned directory
            console.log(`[Worktree] Cleaning orphaned directory: ${dir}`);
            await rm(dirPath, { recursive: true, force: true });
          }
        }
      } catch {
        // Base directory might not exist yet
      }

      console.log('[Worktree] Cleanup complete');
    } catch (error) {
      console.error('[Worktree] Cleanup error:', error);
    }
  }

  /**
   * Execute a git command (without shell)
   */
  private async gitCommand(command: string, cwd: string): Promise<string> {
    // Split command into args, handling quoted strings
    const args = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    // Remove quotes from args
    const cleanArgs = args.map(arg => arg.replace(/^"|"$/g, ''));

    // Use full path to git with explicit env
    const gitPath = '/usr/bin/git';
    const env = {
      ...process.env,
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    };
    const { stdout, stderr } = await execFileAsync(gitPath, cleanArgs, { cwd, env });
    if (stderr && !stderr.includes('Already on') && !stderr.includes('Switched to')) {
      console.warn(`[Git] Warning: ${stderr}`);
    }
    return stdout;
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `sess-${timestamp}-${random}`;
  }

  /**
   * Generate a branch name from task description
   */
  private generateBranchName(description: string): string {
    const timestamp = Date.now().toString(36);
    const slug = description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30);

    return `arbiter/${slug}-${timestamp}`;
  }

  /**
   * Escape commit message for shell
   */
  private escapeMessage(message: string): string {
    return message
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`');
  }
}
