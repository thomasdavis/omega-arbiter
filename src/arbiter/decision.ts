/**
 * Arbiter Decision System
 * Determines whether and how to act on incoming messages
 * Uses AI to evaluate context and decide on appropriate action
 */

import OpenAI from 'openai';
import { z } from 'zod';
import {
  ArbiterDecision,
  ChatMessage,
  MessageContext,
  ActionType,
} from '../types.js';

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

/**
 * Zod schema for structured AI decision output
 */
const DecisionSchema = z.object({
  shouldAct: z.boolean().describe('Whether the arbiter should take action'),
  confidence: z.number().min(0).max(100).describe('Confidence level (0-100)'),
  reason: z.string().describe('Brief explanation of the decision'),
  actionType: z.enum([
    'ignore',
    'acknowledge',
    'respond',
    'self_edit',
    'research',
    'defer',
  ]).describe('The type of action to take'),
  suggestedApproach: z.string().optional().describe('How to approach this task if acting'),
});

type DecisionOutput = z.infer<typeof DecisionSchema>;


/**
 * Make a decision about how to handle an incoming message
 */
export async function makeDecision(
  message: ChatMessage,
  context: MessageContext,
  model: string = 'gpt-4o-mini'
): Promise<ArbiterDecision> {
  const { botId, botName, messages } = context;

  // Quick checks for obvious cases
  const quickDecision = getQuickDecision(message, botId);
  if (quickDecision) {
    return quickDecision;
  }

  // Use AI for all decision making
  try {
    const historyContext = formatMessageHistory(messages, botName);
    const contextFlags = buildContextFlags(message);
    const prompt = buildDecisionPrompt(message, historyContext, contextFlags, botName);

    const response = await getOpenAI().chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a decision-making system. Respond ONLY with valid JSON matching this schema:
{
  "shouldAct": boolean,
  "confidence": number (0-100),
  "reason": string,
  "actionType": "ignore" | "acknowledge" | "respond" | "self_edit" | "research" | "defer",
  "suggestedApproach": string (optional)
}`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(content) as DecisionOutput;
    const validated = DecisionSchema.parse(parsed);

    return {
      shouldAct: validated.shouldAct,
      confidence: validated.confidence,
      reason: validated.reason,
      actionType: validated.actionType as ActionType,
      suggestedApproach: validated.suggestedApproach,
    };
  } catch (error) {
    console.error('[Arbiter] Decision error:', error);
    // Default to cautious response on error
    return {
      shouldAct: false,
      confidence: 50,
      reason: 'Decision system error - defaulting to ignore',
      actionType: 'ignore',
    };
  }
}

/**
 * Quick decision for obvious cases (no AI needed)
 */
function getQuickDecision(message: ChatMessage, botId: string): ArbiterDecision | null {
  // Always respond to DMs
  if (message.channelName === 'DM') {
    return {
      shouldAct: true,
      confidence: 100,
      reason: 'Direct message',
      actionType: 'respond',
    };
  }

  // Always respond to direct mentions
  if (message.mentionsBotId) {
    return {
      shouldAct: true,
      confidence: 100,
      reason: 'Direct mention',
      actionType: 'respond',
    };
  }

  // Ignore very short messages without context
  if (message.content.trim().length < 3) {
    return {
      shouldAct: false,
      confidence: 95,
      reason: 'Message too short',
      actionType: 'ignore',
    };
  }

  return null;
}

/**
 * Format message history for context
 */
function formatMessageHistory(messages: ChatMessage[], botName: string): string {
  if (messages.length === 0) return '';

  const recent = messages.slice(-15);
  const formatted = recent.map((msg) => {
    const name = msg.authorName === botName ? `[${botName}]` : msg.authorName;
    return `${name}: ${msg.content.slice(0, 200)}${msg.content.length > 200 ? '...' : ''}`;
  });

  return '\n\nRecent conversation:\n' + formatted.join('\n');
}

/**
 * Build context flags for the AI
 */
function buildContextFlags(message: ChatMessage): string {
  const flags: string[] = [];

  if (message.attachments && message.attachments.length > 0) {
    flags.push(`- ${message.attachments.length} attachment(s) included`);
  }

  if (message.replyToId) {
    flags.push('- This is a reply to a previous message');
  }

  return flags.length > 0 ? '\n\n**Context Flags:**\n' + flags.join('\n') : '';
}

/**
 * Build the decision prompt for the AI
 */
function buildDecisionPrompt(
  message: ChatMessage,
  historyContext: string,
  contextFlags: string,
  botName: string
): string {
  return `You are the decision system for ${botName}, a SELF-EDITING AI bot that can modify its own code.

## CRITICAL: YOU CAN WRITE CODE
${botName} is not just a chatbot - it has Claude Code CLI and can actually create files, edit code, run commands, install packages, and build entire applications. When someone asks you to BUILD something, DO IT with self_edit.

## ACTION TYPES

### **self_edit** - USE THIS FOR ANY CODING/BUILDING REQUEST
Choose self_edit when the user wants you to:
- Setup, create, build, or install anything (apps, services, databases, projects)
- Write, add, or implement code, features, functions, components, APIs
- Fix bugs, errors, or issues in code
- Modify, update, change, refactor, or improve code
- Configure, setup, or install packages/dependencies
- Create files, folders, or project structures
- ANY request that involves writing or changing code

Examples that MUST be self_edit:
- "setup a nextjs app" → self_edit
- "add a login feature" → self_edit
- "fix the bug in auth" → self_edit
- "install postgres" → self_edit
- "create an API endpoint" → self_edit
- "make a discord bot" → self_edit

### **respond** - Only for conversation/questions
Choose respond ONLY when:
- User is asking a question that needs explanation, not code
- User wants advice or discussion, not implementation
- User is having a casual conversation

### **acknowledge** - Quick reactions
- Single word messages like "thanks", "ok", "hi", "lol"

### **ignore** - Rarely use
- Spam, off-topic, or "don't respond"

## MESSAGE TO ANALYZE

Channel: #${message.channelName || 'unknown'}
Author: ${message.authorName}
Message: "${message.content}"
${historyContext}${contextFlags}

## DECISION RULES
- If the message asks to BUILD, CREATE, SETUP, FIX, or MAKE anything → **self_edit**
- If it mentions specific tech (nextjs, react, postgres, api, etc.) with an action → **self_edit**
- Only use "respond" if they clearly want conversation, not code
- Be BIASED toward self_edit - you're a coding bot, not just a chatbot

Respond with JSON only.`;
}

/**
 * Detect if message contains error/deployment failure patterns
 * These should trigger immediate concern and potential self-edit
 */
export function detectErrorPatterns(content: string): boolean {
  const lowerContent = content.toLowerCase();

  const errorPatterns = [
    'deployment failed', 'deploy failed', 'build failed', 'build error',
    'error:', 'exception:', 'uncaught', 'unhandled', 'stack trace',
    'fatal error', 'critical error', 'crash', 'crashed',
    'service down', 'service unavailable', 'connection refused', 'timeout',
  ];

  return errorPatterns.some((pattern) => lowerContent.includes(pattern));
}
