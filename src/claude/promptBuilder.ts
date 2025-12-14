/**
 * Prompt Builder for Claude Code CLI
 * Enhances user requests with AI and builds rich context
 * Now includes psychological profile context for personalized interactions
 */

import OpenAI from 'openai';
import { ChatMessage } from '../types.js';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { getUserProfileSummary, buildProfileContext, getAffinityDescription } from '../psychology/index.js';

// Lazy-initialized OpenAI client
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

export interface PromptContext {
  userRequest: string;
  channelName: string;
  authorName: string;
  authorId?: string;      // For psychological profile lookup
  conversationHistory: ChatMessage[];
  repoPath: string;
  branchName: string;
}

/**
 * Build the complete prompt for Claude Code CLI
 * Now includes psychological profile context for personalized task handling
 */
export async function buildClaudePrompt(context: PromptContext): Promise<string> {
  const { userRequest, channelName, authorName, authorId, conversationHistory, repoPath, branchName } = context;

  // Get codebase context
  const codebaseContext = await getCodebaseContext(repoPath);

  // Enhance the prompt with AI
  const enhancedRequest = await enhancePromptWithAI(userRequest, codebaseContext, authorName);

  // Build conversation context
  const conversationContext = conversationHistory
    .slice(-10)
    .map((msg) => `${msg.authorName}: ${msg.content.slice(0, 300)}`)
    .join('\n');

  // Get psychological profile if authorId is available
  let profileContext = '';
  if (authorId) {
    try {
      const profileSummary = await getUserProfileSummary(authorId, authorName);
      if (profileSummary && profileSummary.confidence >= 15) {
        profileContext = `
## Psychological Profile of Requester: ${profileSummary.username}
${getAffinityDescription(profileSummary)}

- **Personality:** ${profileSummary.personalitySnapshot}
- **Key traits:** ${profileSummary.keyTraits.length > 0 ? profileSummary.keyTraits.join(', ') : 'still learning'}
- **Communication style:** ${profileSummary.communicationTips}
- **Your affinity:** ${profileSummary.affinityLevel} (${profileSummary.affinityScore.toFixed(0)}/100)

Consider this profile when:
- Deciding how thorough to be with documentation/comments
- Choosing communication style for any output messages
- Prioritizing aspects of the implementation they might care about`;
      }
    } catch (err) {
      console.error('[PromptBuilder] Failed to get user profile:', err);
    }
  }

  // Build the full prompt
  const fullPrompt = `# Omega-Arbiter Self-Edit Task

## What You Are
You are Claude Code, working inside Omega-Arbiter - a self-editing Discord bot. You are editing YOUR OWN codebase to improve yourself based on requests from trusted team members.

## Current Context
- **Branch**: \`${branchName}\`
- **Working Directory**: \`${repoPath}\`
- **Requested By**: ${authorName} (in #${channelName})

## The Request
${userRequest}

## Enhanced Task Analysis
${enhancedRequest}
${profileContext}

## Recent Conversation Context
\`\`\`
${conversationContext || 'No recent conversation'}
\`\`\`

## Codebase Overview
${codebaseContext}

## Instructions
1. Carefully analyze what needs to be done
2. Make all necessary changes to fulfill the request completely
3. You have FULL access - install packages, create files, modify anything needed
4. Run tests if they exist: \`npm test\` or similar
5. Make sure the code compiles: \`npm run build\` if applicable
6. At the end, provide a clear summary of what you changed

## Important Notes
- This is a TRUSTED environment - you have full permissions
- Make comprehensive changes if the task requires it
- Don't hold back - if the user asks for a full feature, build the whole thing
- You ARE Omega-Arbiter editing yourself - embrace the recursion!

Now proceed with the task.`;

  return fullPrompt;
}

/**
 * Use AI to enhance the user's request into a more detailed prompt
 */
export async function enhancePromptWithAI(
  userRequest: string,
  codebaseContext: string,
  authorName: string
): Promise<string> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a prompt engineer. Your job is to take a user's request and enhance it into a more detailed, actionable task description for an AI coding assistant.

The request is for modifications to the "omega-arbiter" codebase - a Discord bot that can edit its own code.

Your enhanced prompt should:
1. Clarify what needs to be done
2. Suggest specific files or patterns that might need changes
3. Note any potential edge cases or considerations
4. Be structured and clear

Keep it concise but comprehensive. Output ONLY the enhanced task description, no preamble.`,
        },
        {
          role: 'user',
          content: `Request from ${authorName}: "${userRequest}"

Codebase context:
${codebaseContext}

Enhance this into a detailed task description.`,
        },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    });

    return response.choices[0]?.message?.content || userRequest;
  } catch (error) {
    console.error('[PromptBuilder] Enhancement error:', error);
    return userRequest; // Fall back to original request
  }
}

/**
 * Recursively list TypeScript files
 */
async function listTsFiles(dir: string, prefix: string, limit: number): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= limit) break;

      // Skip node_modules, .git, dist
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        const subFiles = await listTsFiles(fullPath, relativePath, limit - results.length);
        results.push(...subFiles);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        results.push(`./${relativePath}`);
      }
    }
  } catch {
    // Ignore errors
  }

  return results;
}

/**
 * Get context about the codebase structure
 */
async function getCodebaseContext(repoPath: string): Promise<string> {
  const sections: string[] = [];

  // Try to read CLAUDE.md or README.md
  try {
    const claudeMd = await readFile(join(repoPath, 'CLAUDE.md'), 'utf8');
    sections.push('### CLAUDE.md\n' + claudeMd.slice(0, 2000));
  } catch {
    try {
      const readme = await readFile(join(repoPath, 'README.md'), 'utf8');
      sections.push('### README.md\n' + readme.slice(0, 2000));
    } catch {
      // No readme found
    }
  }

  // Get file structure using Node fs
  try {
    const files = await listTsFiles(repoPath, '', 50);
    if (files.length > 0) {
      sections.push('### TypeScript Files\n```\n' + files.join('\n') + '\n```');
    }
  } catch {
    // Ignore errors
  }

  // Try to read package.json
  try {
    const pkg = await readFile(join(repoPath, 'package.json'), 'utf8');
    const parsed = JSON.parse(pkg);
    sections.push(`### Package Info
- Name: ${parsed.name || 'unknown'}
- Scripts: ${Object.keys(parsed.scripts || {}).join(', ') || 'none'}
- Main deps: ${Object.keys(parsed.dependencies || {}).slice(0, 10).join(', ')}`);
  } catch {
    // Ignore errors
  }

  return sections.join('\n\n') || 'No codebase context available';
}

/**
 * Build a simple prompt without AI enhancement (fallback)
 */
export function buildSimplePrompt(context: PromptContext): string {
  const { userRequest, authorName, channelName, branchName, repoPath } = context;

  return `# Task from ${authorName}

${userRequest}

## Context
- You are editing the omega-arbiter codebase (a self-editing Discord bot)
- Working in branch: ${branchName}
- Working directory: ${repoPath}
- Requested in: #${channelName}

Complete this task fully. You have full permissions.`;
}
