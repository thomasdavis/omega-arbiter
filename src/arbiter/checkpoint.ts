/**
 * Checkpoint & Continue Logic
 * Handles committing work-in-progress and building continuation prompts
 */

import { WorkSession, ChatMessage } from '../types.js';
import { WorktreeManager } from '../git/worktree.js';

/**
 * Create a checkpoint commit for the current work in progress
 */
export async function createCheckpoint(
  session: WorkSession,
  worktreeManager: WorktreeManager
): Promise<string | null> {
  // Get current changes
  const changedFiles = await worktreeManager.getChangedFiles(session.id);
  if (changedFiles.length === 0) {
    console.log(`[Checkpoint] No changes to commit for session ${session.id}`);
    return null;
  }

  // Commit checkpoint
  session.checkpointCount++;
  const commitHash = await worktreeManager.commitChanges(
    session.id,
    `Checkpoint ${session.checkpointCount}: Work in progress\n\nAutomated checkpoint before incorporating new instructions.`
  );

  console.log(`[Checkpoint] Created checkpoint ${session.checkpointCount}: ${commitHash?.slice(0, 8)}`);
  return commitHash;
}

/**
 * Get the diff of committed changes for context in continuation
 */
export async function getCommittedDiff(
  session: WorkSession,
  worktreeManager: WorktreeManager
): Promise<string> {
  try {
    // Get diff of the last checkpoint commit
    const diff = await worktreeManager.getDiff(session.id);
    return diff || 'No changes detected';
  } catch (error) {
    console.error('[Checkpoint] Error getting diff:', error);
    return 'Unable to retrieve diff';
  }
}

/**
 * Build a continuation prompt that includes:
 * - Original task context
 * - What work has been done (via diff)
 * - New follow-up instructions
 */
export function buildContinuationPrompt(
  session: WorkSession,
  previousDiff: string
): string {
  const originalTask = session.triggeredBy.content;
  const followUps = session.pendingMessages
    .map((m) => `${m.authorName}: ${m.content}`)
    .join('\n');

  // Truncate diff if too long (keep it readable)
  let diffContent = previousDiff;
  if (diffContent.length > 5000) {
    diffContent = diffContent.slice(0, 5000) + '\n\n... (diff truncated for brevity)';
  }

  return `## Continuation of Previous Task

You were working on: "${originalTask}"

### Work Completed So Far (Checkpoint ${session.checkpointCount})
The following changes have been committed and should NOT be redone:

\`\`\`diff
${diffContent}
\`\`\`

### New Instructions from User
${followUps}

### Your Task
Continue from where you left off, incorporating the new instructions above.
- Do NOT redo work that's already been committed
- Build upon the existing changes
- The changes above are already saved - focus on the new requirements

If the new instructions conflict with or modify existing work, update the files appropriately.
`;
}

/**
 * Format pending messages for display
 */
export function formatPendingMessages(messages: ChatMessage[]): string {
  if (messages.length === 0) return 'No pending messages';

  return messages
    .map((m, i) => `${i + 1}. ${m.authorName}: ${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''}`)
    .join('\n');
}
