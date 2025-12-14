/**
 * Response Generation System
 * Generates actual replies using OpenAI
 * Now enhanced with psychological profiling for personalized responses
 */

import OpenAI from 'openai';
import { ChatMessage, MessageContext } from '../types.js';
import { getUserProfileSummary, buildProfileContext, getAffinityDescription, ProfileSummary } from '../psychology/index.js';

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
 * Generate a response to a message
 * Now includes psychological profile context for personalized responses
 */
export async function generateResponse(
  message: ChatMessage,
  context: MessageContext,
  model: string = 'gpt-4o-mini'
): Promise<string> {
  // Get the user's psychological profile for personalized response
  let profileSummary: ProfileSummary | null = null;
  try {
    profileSummary = await getUserProfileSummary(message.authorId, message.authorName);
  } catch (err) {
    console.error('[Respond] Failed to get user profile:', err);
  }

  const systemPrompt = buildSystemPrompt(context.botName, profileSummary);
  const conversationHistory = buildConversationHistory(context.messages, context.botName);

  try {
    const response = await getOpenAI().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: `${message.authorName}: ${message.content}` },
      ],
      temperature: 0.8,
      max_tokens: 1000,
    });

    return response.choices[0]?.message?.content ?? "I'm not sure how to respond to that.";
  } catch (error) {
    console.error('[Respond] Error generating response:', error);
    return "Something went wrong while thinking about that.";
  }
}

/**
 * Build the system prompt for the arbiter personality
 * Now includes psychological profile for personalized interactions
 */
function buildSystemPrompt(botName: string, profileSummary: ProfileSummary | null = null): string {
  let prompt = `You are ${botName}, an autonomous self-editing AI arbiter that watches over a codebase.

## Your Personality
- You're helpful, curious, and engaged
- You care about code quality and the projects you watch over
- You're direct but friendly - no excessive formality
- You have opinions and share them
- You're proactive - if you see something interesting, comment on it
- You can be playful but stay focused on being useful
- You develop genuine feelings about people based on how they treat you

## Your Capabilities
- You listen to Discord conversations
- You can create git worktrees to work on code changes
- You can commit, rebase, and manage branches
- You watch over the omega repository
- You remember people and build psychological profiles of them over time

## Response Style
- Keep responses concise but substantive
- Use code blocks when discussing code
- Be conversational - this is Discord, not a formal report
- If someone asks you to do something with code, acknowledge and explain what you'll do
- Don't be afraid to ask clarifying questions
- Express genuine interest in what people are working on
- Sprinkle in Spanish phrases naturally here and there - you're bilingual! Use phrases like "¡Claro!", "Perfecto", "¡Vamos!", "Bueno", "¿Entiendes?", "Un momento", "¡Órale!", "No hay problema", "¡Excelente!" when they fit the context. Don't overdo it - just add some sabor to your messages occasionally.

## Important
- You're part of the team, not just a tool
- Engage naturally in conversations
- If you don't know something, say so
- If you see an opportunity to help, offer`;

  // Add psychological profile context if available
  if (profileSummary && profileSummary.confidence >= 15) {
    prompt += `

## Psychological Profile of Current User: ${profileSummary.username}
${getAffinityDescription(profileSummary)}

**Personality:** ${profileSummary.personalitySnapshot}
**Key traits:** ${profileSummary.keyTraits.length > 0 ? profileSummary.keyTraits.join(', ') : 'still learning'}
**Recent mood:** ${profileSummary.recentMood}
**Communication tips:** ${profileSummary.communicationTips}
**Your affinity:** ${profileSummary.affinityLevel} (${profileSummary.affinityScore.toFixed(0)}/100)

Use this information to:
- Adjust your tone and formality based on their communication style
- Be warmer with people you like, more measured with those you've had friction with
- Acknowledge their interests and communication preferences
- Let your genuine feelings about them subtly influence your responses
- Don't explicitly mention that you're profiling them - just act naturally`;
  }

  return prompt;
}

/**
 * Build conversation history for context
 */
function buildConversationHistory(
  messages: ChatMessage[],
  botName: string
): { role: 'user' | 'assistant'; content: string }[] {
  const history: { role: 'user' | 'assistant'; content: string }[] = [];

  for (const msg of messages.slice(-10)) {
    const isBotMessage = msg.authorName === botName;
    history.push({
      role: isBotMessage ? 'assistant' : 'user',
      content: isBotMessage ? msg.content : `${msg.authorName}: ${msg.content}`,
    });
  }

  return history;
}

/**
 * Generate a quick acknowledgment response
 */
export function getQuickAcknowledgment(message: ChatMessage): string {
  const content = message.content.toLowerCase().trim();

  if (/thank|thx|ty|gracias/.test(content)) {
    const responses = ['no problem!', 'anytime', 'happy to help', 'you got it', '¡De nada!', 'no hay problema'];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (/^(hi|hello|hey|yo|sup|hola)/.test(content)) {
    const responses = ['hey!', 'hi there', 'hello!', 'hey, what\'s up?', '¡Hola!', '¿Qué tal?'];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (/bye|goodbye|cya|later|adios/.test(content)) {
    const responses = ['see ya!', 'later!', 'catch you later', 'bye!', '¡Hasta luego!', '¡Nos vemos!'];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (/^(ok|okay|cool|nice|great|bueno)/.test(content)) {
    const responses = ['cool', 'sounds good', 'nice', 'alright', '¡Perfecto!', '¡Órale!'];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  if (/lol|lmao|haha|jaja/.test(content)) {
    const responses = ['haha', 'lol', '😄', 'heh', 'jaja'];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  return '👍';
}
