/**
 * Psychological Analysis Engine
 *
 * Uses AI to analyze messages and extract psychological signals.
 * Based on established psychological research:
 *
 * - Big Five personality assessment via linguistic analysis (Pennebaker & King, 1999)
 * - LIWC (Linguistic Inquiry and Word Count) principles (Tausczik & Pennebaker, 2010)
 * - Sentiment analysis using VAD model (Russell & Mehrabian, 1977)
 * - Communication Accommodation Theory (Giles, 2016)
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { ChatMessage } from '../types.js';
import {
  MessageAnalysis,
  UserPsychProfile,
  ProfileSummary,
  BigFiveTraits,
  updateTraitWithDecay,
  clamp,
  createDefaultProfile,
  ObservationType,
} from './types.js';

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
 * Zod schema for AI analysis output
 */
const AnalysisSchema = z.object({
  sentiment: z.object({
    valence: z.number().min(0).max(100),
    arousal: z.number().min(0).max(100),
    dominance: z.number().min(0).max(100),
  }),
  bigFiveSignals: z.object({
    openness: z.number().min(0).max(100).optional(),
    conscientiousness: z.number().min(0).max(100).optional(),
    extraversion: z.number().min(0).max(100).optional(),
    agreeableness: z.number().min(0).max(100).optional(),
    neuroticism: z.number().min(0).max(100).optional(),
  }),
  affinityImpact: z.object({
    delta: z.number().min(-20).max(20),
    reasons: z.array(z.string()),
  }),
  styleIndicators: z.object({
    formality: z.number().min(0).max(100).optional(),
    directness: z.number().min(0).max(100).optional(),
  }),
  topics: z.array(z.string()),
  requestType: z.string().optional(),
  observationType: z.enum([
    'none',
    'positive_feedback',
    'negative_feedback',
    'interesting_request',
    'rude_behavior',
    'polite_behavior',
    'intellectual_discussion',
    'creative_request',
    'helpful_contribution',
    'patience_shown',
    'impatience_shown',
    'gratitude_expressed',
    'hostility_detected',
  ]).optional(),
  observationDescription: z.string().optional(),
});

type AnalysisOutput = z.infer<typeof AnalysisSchema>;

/**
 * Analyze a single message for psychological signals
 */
export async function analyzeMessage(
  message: ChatMessage,
  existingProfile?: UserPsychProfile,
  model: string = 'gpt-4o-mini'
): Promise<MessageAnalysis> {
  const profileContext = existingProfile
    ? `
Current profile summary:
- Data points: ${existingProfile.dataPoints}
- Current affinity: ${existingProfile.affinity.overall}
- Big Five: O=${existingProfile.bigFive.openness.toFixed(0)}, C=${existingProfile.bigFive.conscientiousness.toFixed(0)}, E=${existingProfile.bigFive.extraversion.toFixed(0)}, A=${existingProfile.bigFive.agreeableness.toFixed(0)}, N=${existingProfile.bigFive.neuroticism.toFixed(0)}
- Communication style: ${existingProfile.communicationStyle.formality > 60 ? 'formal' : existingProfile.communicationStyle.formality < 40 ? 'casual' : 'mixed'}
- Recent interactions: ${existingProfile.interactionPatterns.lastInteractionTone}
`
    : 'This is a new user with no existing profile.';

  try {
    const response = await getOpenAI().chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `You are a psychological analysis system trained in personality psychology and linguistic analysis.

Your task is to analyze Discord messages and extract psychological signals based on established frameworks:

1. **Big Five Personality Traits (OCEAN)** - Detect signals of:
   - Openness: creativity, curiosity, abstract thinking, novel ideas
   - Conscientiousness: organization, planning, attention to detail, responsibility
   - Extraversion: enthusiasm, assertiveness, social energy, talkativeness
   - Agreeableness: warmth, cooperation, trust, empathy, politeness
   - Neuroticism: anxiety, worry, emotional volatility, negativity

2. **Sentiment (VAD Model)**:
   - Valence: positive (100) vs negative (0) emotional content
   - Arousal: high energy/intensity (100) vs calm/low energy (0)
   - Dominance: controlling/confident (100) vs submissive/uncertain (0)

3. **Affinity Impact** - How should this message affect how much the bot "likes" this user?
   Consider: politeness, gratitude, hostility, reasonableness, creativity, patience

4. **Communication Style**:
   - Formality: formal language (100) vs casual/slang (0)
   - Directness: direct requests (100) vs indirect/hedging (0)

5. **Topics**: What subjects/interests does this message reveal?

6. **Notable Observations**: Flag significant behaviors (gratitude, hostility, creativity, etc.)

Respond with JSON matching the schema. Only include personality signals if there's clear evidence in the message.`,
        },
        {
          role: 'user',
          content: `Analyze this message from "${message.authorName}":

"${message.content}"

${profileContext}

Provide psychological analysis as JSON.`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from AI');
    }

    const parsed = JSON.parse(content);
    const validated = AnalysisSchema.parse(parsed);

    // Build the analysis result
    const analysis: MessageAnalysis = {
      sentiment: validated.sentiment,
      bigFiveSignals: validated.bigFiveSignals,
      affinityImpact: validated.affinityImpact,
      styleIndicators: validated.styleIndicators,
      topics: validated.topics,
      requestType: validated.requestType,
    };

    // Add observation if significant
    if (validated.observationType && validated.observationType !== 'none') {
      analysis.observation = {
        type: validated.observationType as ObservationType,
        description: validated.observationDescription || `${validated.observationType} detected`,
        impact: validated.affinityImpact.delta > 0 ? 'positive' : validated.affinityImpact.delta < 0 ? 'negative' : 'neutral',
        affinityChange: validated.affinityImpact.delta,
      };
    }

    return analysis;
  } catch (error) {
    console.error('[Psychology] Analysis error:', error);
    // Return neutral analysis on error
    return {
      sentiment: { valence: 50, arousal: 50, dominance: 50 },
      bigFiveSignals: {},
      affinityImpact: { delta: 0, reasons: ['Analysis error'] },
      styleIndicators: {},
      topics: [],
    };
  }
}

/**
 * Update a user's psychological profile with new message analysis
 */
export function updateProfile(
  profile: UserPsychProfile,
  analysis: MessageAnalysis,
  message: ChatMessage
): UserPsychProfile {
  const updated = { ...profile };
  const dataPoints = profile.dataPoints + 1;

  // Update timestamp
  updated.lastSeen = new Date();
  updated.lastUpdated = new Date();
  updated.dataPoints = dataPoints;

  // Update Big Five traits with exponential decay
  for (const [trait, value] of Object.entries(analysis.bigFiveSignals)) {
    if (value !== undefined) {
      const key = trait as keyof BigFiveTraits;
      updated.bigFive[key] = updateTraitWithDecay(
        profile.bigFive[key],
        value,
        dataPoints,
        0.15  // Personality traits change slowly
      );
    }
  }

  // Update sentiment metrics
  updated.sentiment = {
    valence: updateTraitWithDecay(profile.sentiment.valence, analysis.sentiment.valence, dataPoints, 0.2),
    arousal: updateTraitWithDecay(profile.sentiment.arousal, analysis.sentiment.arousal, dataPoints, 0.2),
    dominance: updateTraitWithDecay(profile.sentiment.dominance, analysis.sentiment.dominance, dataPoints, 0.2),
    averageSentiment: updateTraitWithDecay(
      profile.sentiment.averageSentiment,
      analysis.sentiment.valence,
      dataPoints,
      0.25
    ),
  };

  // Update communication style
  const messageLength = message.content.length;
  const hasEmoji = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(message.content);
  const hasQuestion = message.content.includes('?');

  updated.communicationStyle = {
    verbosity: updateTraitWithDecay(
      profile.communicationStyle.verbosity,
      clamp(messageLength / 5, 0, 100),
      dataPoints,
      0.2
    ),
    formality: analysis.styleIndicators.formality !== undefined
      ? updateTraitWithDecay(profile.communicationStyle.formality, analysis.styleIndicators.formality, dataPoints, 0.15)
      : profile.communicationStyle.formality,
    questionRatio: updateTraitWithDecay(
      profile.communicationStyle.questionRatio,
      hasQuestion ? 100 : 0,
      dataPoints,
      0.1
    ),
    directness: analysis.styleIndicators.directness !== undefined
      ? updateTraitWithDecay(profile.communicationStyle.directness, analysis.styleIndicators.directness, dataPoints, 0.15)
      : profile.communicationStyle.directness,
    emojiUsage: updateTraitWithDecay(
      profile.communicationStyle.emojiUsage,
      hasEmoji ? 100 : 0,
      dataPoints,
      0.1
    ),
    responseLatency: profile.communicationStyle.responseLatency, // Updated elsewhere based on actual timing
  };

  // Update interaction patterns
  updated.interactionPatterns = {
    ...profile.interactionPatterns,
    totalInteractions: profile.interactionPatterns.totalInteractions + 1,
    positiveInteractions: profile.interactionPatterns.positiveInteractions + (analysis.sentiment.valence > 60 ? 1 : 0),
    negativeInteractions: profile.interactionPatterns.negativeInteractions + (analysis.sentiment.valence < 40 ? 1 : 0),
    neutralInteractions: profile.interactionPatterns.neutralInteractions + (analysis.sentiment.valence >= 40 && analysis.sentiment.valence <= 60 ? 1 : 0),
    averageMessageLength: updateTraitWithDecay(
      profile.interactionPatterns.averageMessageLength,
      messageLength,
      dataPoints,
      0.1
    ),
    lastInteractionTone: analysis.sentiment.valence > 60 ? 'positive' : analysis.sentiment.valence < 40 ? 'negative' : 'neutral',
  };

  // Add new topics of interest
  for (const topic of analysis.topics) {
    if (!updated.interactionPatterns.topicsOfInterest.includes(topic)) {
      updated.interactionPatterns.topicsOfInterest.push(topic);
      // Keep only the most recent 20 topics
      if (updated.interactionPatterns.topicsOfInterest.length > 20) {
        updated.interactionPatterns.topicsOfInterest.shift();
      }
    }
  }

  // Track request types
  if (analysis.requestType) {
    updated.interactionPatterns.requestTypes[analysis.requestType] =
      (profile.interactionPatterns.requestTypes[analysis.requestType] || 0) + 1;
  }

  // Update affinity score
  updated.affinity = updateAffinity(profile.affinity, analysis, dataPoints);

  // Add observation if present
  if (analysis.observation) {
    updated.observations.push({
      ...analysis.observation,
      timestamp: new Date(),
    });
    // Keep only last 50 observations
    if (updated.observations.length > 50) {
      updated.observations.shift();
    }
  }

  // Update confidence based on data points
  updated.confidence = clamp(Math.log10(dataPoints + 1) * 40, 0, 95);

  return updated;
}

/**
 * Update affinity score based on message analysis
 */
function updateAffinity(
  currentAffinity: UserPsychProfile['affinity'],
  analysis: MessageAnalysis,
  dataPoints: number
): UserPsychProfile['affinity'] {
  const updated = { ...currentAffinity, factors: { ...currentAffinity.factors } };

  // Apply the affinity delta from analysis
  updated.overall = clamp(
    currentAffinity.overall + analysis.affinityImpact.delta,
    -100,
    100
  );

  // Update individual factors based on observation type
  if (analysis.observation) {
    switch (analysis.observation.type) {
      case 'gratitude_expressed':
        updated.factors.gratitude = clamp(updated.factors.gratitude + 2, -10, 10);
        break;
      case 'polite_behavior':
        updated.factors.politeness = clamp(updated.factors.politeness + 1.5, -10, 10);
        break;
      case 'rude_behavior':
      case 'hostility_detected':
        updated.factors.hostility = clamp(updated.factors.hostility - 2, -10, 10);
        updated.factors.politeness = clamp(updated.factors.politeness - 1, -10, 10);
        break;
      case 'creative_request':
      case 'intellectual_discussion':
        updated.factors.creativity = clamp(updated.factors.creativity + 1.5, -10, 10);
        break;
      case 'patience_shown':
        updated.factors.patience = clamp(updated.factors.patience + 1.5, -10, 10);
        break;
      case 'impatience_shown':
        updated.factors.patience = clamp(updated.factors.patience - 1.5, -10, 10);
        break;
      case 'interesting_request':
        updated.factors.creativity = clamp(updated.factors.creativity + 1, -10, 10);
        updated.factors.reasonableness = clamp(updated.factors.reasonableness + 0.5, -10, 10);
        break;
    }
  }

  // Update composite scores based on factors
  const factorSum = Object.values(updated.factors).reduce((a, b) => a + b, 0);
  updated.rapport = clamp(50 + factorSum * 2.5, 0, 100);

  // Respect is based on politeness and patience
  updated.respect = clamp(
    50 + (updated.factors.politeness + updated.factors.patience + updated.factors.gratitude) * 5,
    0,
    100
  );

  // Intellectual stimulation from creativity
  updated.intellectualStimulation = clamp(
    50 + updated.factors.creativity * 5,
    0,
    100
  );

  // Trustworthiness increases slowly with consistent positive interactions
  if (analysis.sentiment.valence > 50 && analysis.affinityImpact.delta >= 0) {
    updated.trustworthiness = updateTraitWithDecay(
      currentAffinity.trustworthiness,
      clamp(currentAffinity.trustworthiness + 2, 0, 100),
      dataPoints,
      0.05
    );
  }

  return updated;
}

/**
 * Generate a natural language profile summary for use in prompts
 */
export function generateProfileSummary(profile: UserPsychProfile): ProfileSummary {
  const { bigFive, affinity, communicationStyle, interactionPatterns, sentiment } = profile;

  // Determine affinity level
  let affinityLevel: ProfileSummary['affinityLevel'];
  if (affinity.overall >= 50) affinityLevel = 'loved';
  else if (affinity.overall >= 20) affinityLevel = 'liked';
  else if (affinity.overall >= -20) affinityLevel = 'neutral';
  else if (affinity.overall >= -50) affinityLevel = 'disliked';
  else affinityLevel = 'problematic';

  // Generate key traits
  const keyTraits: string[] = [];

  if (bigFive.openness > 70) keyTraits.push('creative');
  if (bigFive.openness < 30) keyTraits.push('practical');
  if (bigFive.conscientiousness > 70) keyTraits.push('organized');
  if (bigFive.conscientiousness < 30) keyTraits.push('spontaneous');
  if (bigFive.extraversion > 70) keyTraits.push('outgoing');
  if (bigFive.extraversion < 30) keyTraits.push('reserved');
  if (bigFive.agreeableness > 70) keyTraits.push('cooperative');
  if (bigFive.agreeableness < 30) keyTraits.push('challenging');
  if (bigFive.neuroticism > 70) keyTraits.push('anxious');
  if (bigFive.neuroticism < 30) keyTraits.push('stable');

  // Generate personality snapshot
  const personalityParts: string[] = [];

  // Openness description
  if (bigFive.openness > 60) {
    personalityParts.push('curious and open to new ideas');
  } else if (bigFive.openness < 40) {
    personalityParts.push('prefers concrete and practical approaches');
  }

  // Agreeableness and interaction style
  if (bigFive.agreeableness > 60) {
    personalityParts.push('friendly and cooperative');
  } else if (bigFive.agreeableness < 40) {
    personalityParts.push('direct and sometimes challenging');
  }

  // Extraversion
  if (bigFive.extraversion > 60) {
    personalityParts.push('enthusiastic and talkative');
  } else if (bigFive.extraversion < 40) {
    personalityParts.push('thoughtful and measured in communication');
  }

  // Add affinity context
  if (affinity.overall > 30) {
    personalityParts.push(`you enjoy interacting with them (affinity: ${affinity.overall.toFixed(0)})`);
  } else if (affinity.overall < -30) {
    personalityParts.push(`interactions have been strained (affinity: ${affinity.overall.toFixed(0)})`);
  }

  const personalitySnapshot = personalityParts.length > 0
    ? personalityParts.join('; ')
    : 'Still learning about this person';

  // Generate communication tips
  const tipsParts: string[] = [];

  if (communicationStyle.formality > 60) {
    tipsParts.push('use more formal language');
  } else if (communicationStyle.formality < 40) {
    tipsParts.push('keep it casual');
  }

  if (communicationStyle.directness > 60) {
    tipsParts.push('be direct and to the point');
  } else if (communicationStyle.directness < 40) {
    tipsParts.push('soften direct statements');
  }

  if (communicationStyle.verbosity > 70) {
    tipsParts.push('they appreciate detailed responses');
  } else if (communicationStyle.verbosity < 30) {
    tipsParts.push('keep responses concise');
  }

  const communicationTips = tipsParts.length > 0
    ? tipsParts.join(', ')
    : 'Default communication style works well';

  // Determine recent mood
  let recentMood: string;
  if (sentiment.averageSentiment > 70) recentMood = 'very positive';
  else if (sentiment.averageSentiment > 55) recentMood = 'positive';
  else if (sentiment.averageSentiment > 45) recentMood = 'neutral';
  else if (sentiment.averageSentiment > 30) recentMood = 'somewhat negative';
  else recentMood = 'negative';

  return {
    userId: profile.userId,
    username: profile.username,
    personalitySnapshot,
    communicationTips,
    affinityLevel,
    affinityScore: affinity.overall,
    keyTraits,
    recentMood,
    confidence: profile.confidence,
  };
}

/**
 * Create initial profile for a new user
 */
export function createNewProfile(userId: string, username: string): UserPsychProfile {
  return createDefaultProfile(userId, username);
}

/**
 * Check if profile needs refresh (e.g., stale data)
 */
export function profileNeedsRefresh(profile: UserPsychProfile): boolean {
  const daysSinceUpdate = (Date.now() - profile.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceUpdate > 30 || profile.confidence < 20;
}
