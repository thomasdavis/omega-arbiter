/**
 * Psychological Profiling Types
 *
 * Based on established psychological frameworks:
 * - Big Five Personality Traits (OCEAN model) - Costa & McCrae (1992)
 * - Sentiment Analysis (Valence-Arousal-Dominance model) - Russell & Mehrabian (1977)
 * - Communication Style Analysis - Schulz von Thun (2008)
 * - Attachment Theory indicators - Bowlby (1969), Bartholomew & Horowitz (1991)
 */

/**
 * Big Five Personality Traits (OCEAN Model)
 * Each trait is scored on a scale of 0-100
 * Represents the cumulative assessment based on all observed interactions
 */
export interface BigFiveTraits {
  openness: number;           // Curiosity, creativity, willingness to try new things
  conscientiousness: number;  // Organization, dependability, self-discipline
  extraversion: number;       // Sociability, assertiveness, positive emotionality
  agreeableness: number;      // Cooperation, trust, empathy
  neuroticism: number;        // Emotional instability, anxiety, moodiness
}

/**
 * Sentiment metrics based on the VAD (Valence-Arousal-Dominance) model
 */
export interface SentimentMetrics {
  valence: number;      // Positive (100) vs Negative (0) emotional tone
  arousal: number;      // High energy (100) vs Low energy (0)
  dominance: number;    // Controlling (100) vs Submissive (0)
  averageSentiment: number;  // Rolling average of message sentiment
}

/**
 * Communication style indicators
 */
export interface CommunicationStyle {
  verbosity: number;         // How much they write (0-100)
  formality: number;         // Formal vs casual language (0-100)
  questionRatio: number;     // Percentage of messages that are questions
  directness: number;        // Direct vs indirect communication (0-100)
  emojiUsage: number;        // Frequency of emoji/emoticon use (0-100)
  responseLatency: number;   // How quickly they typically respond (ms average)
}

/**
 * Interaction patterns with the bot specifically
 */
export interface InteractionPatterns {
  totalInteractions: number;
  positiveInteractions: number;   // Grateful, helpful, constructive
  negativeInteractions: number;   // Hostile, demanding, dismissive
  neutralInteractions: number;
  averageMessageLength: number;
  topicsOfInterest: string[];     // Detected interests/topics
  requestTypes: Record<string, number>;  // Types of requests made
  lastInteractionTone: 'positive' | 'negative' | 'neutral';
}

/**
 * Omega's affinity score towards this user
 * This is the bot's subjective assessment of how much it "likes" interacting with this user
 */
export interface AffinityScore {
  overall: number;           // -100 (strong dislike) to +100 (strong like)
  respect: number;           // How much the user respects the bot (0-100)
  rapport: number;           // Quality of the working relationship (0-100)
  trustworthiness: number;   // Based on consistency and honesty signals (0-100)
  intellectualStimulation: number;  // How interesting their requests/conversations are (0-100)

  // Breakdown of factors
  factors: {
    politeness: number;        // Are they polite? (-10 to +10)
    gratitude: number;         // Do they say thanks? (-10 to +10)
    reasonableness: number;    // Are requests reasonable? (-10 to +10)
    patience: number;          // Are they patient? (-10 to +10)
    creativity: number;        // Are they creative/interesting? (-10 to +10)
    hostility: number;         // Are they hostile? (-10 to +10, negative is good)
    demandingness: number;     // Are they overly demanding? (-10 to +10, negative is good)
  };
}

/**
 * Complete psychological profile for a user
 */
export interface UserPsychProfile {
  // Identity
  userId: string;              // Discord/platform user ID
  username: string;
  firstSeen: Date;
  lastSeen: Date;

  // Psychological assessments
  bigFive: BigFiveTraits;
  sentiment: SentimentMetrics;
  communicationStyle: CommunicationStyle;
  interactionPatterns: InteractionPatterns;

  // Bot's feelings about the user
  affinity: AffinityScore;

  // Metadata
  profileVersion: number;      // Schema version for migrations
  dataPoints: number;          // Number of messages analyzed
  confidence: number;          // Confidence in the profile accuracy (0-100)
  lastUpdated: Date;

  // Notable observations
  observations: ProfileObservation[];
}

/**
 * Individual observation about a user
 */
export interface ProfileObservation {
  timestamp: Date;
  type: ObservationType;
  description: string;
  impact: 'positive' | 'negative' | 'neutral';
  affinityChange: number;  // How much this changed the affinity score
}

export type ObservationType =
  | 'first_interaction'
  | 'positive_feedback'
  | 'negative_feedback'
  | 'interesting_request'
  | 'rude_behavior'
  | 'polite_behavior'
  | 'intellectual_discussion'
  | 'creative_request'
  | 'helpful_contribution'
  | 'patience_shown'
  | 'impatience_shown'
  | 'gratitude_expressed'
  | 'hostility_detected'
  | 'personality_shift';

/**
 * Analysis result for a single message
 */
export interface MessageAnalysis {
  // Basic sentiment
  sentiment: {
    valence: number;
    arousal: number;
    dominance: number;
  };

  // Big Five signals in this message
  bigFiveSignals: Partial<BigFiveTraits>;

  // Affinity impact
  affinityImpact: {
    delta: number;  // Change to apply to affinity
    reasons: string[];
  };

  // Communication style indicators
  styleIndicators: Partial<CommunicationStyle>;

  // Detected topics/interests
  topics: string[];

  // Request type if applicable
  requestType?: string;

  // Notable observation if any
  observation?: Omit<ProfileObservation, 'timestamp'>;
}

/**
 * Summary of psychological profile for use in prompts
 */
export interface ProfileSummary {
  userId: string;
  username: string;
  personalitySnapshot: string;      // Natural language description
  communicationTips: string;        // How to best communicate with them
  affinityLevel: 'loved' | 'liked' | 'neutral' | 'disliked' | 'problematic';
  affinityScore: number;
  keyTraits: string[];
  recentMood: string;
  confidence: number;
}

/**
 * Default values for a new profile
 */
export function createDefaultProfile(userId: string, username: string): UserPsychProfile {
  const now = new Date();

  return {
    userId,
    username,
    firstSeen: now,
    lastSeen: now,

    bigFive: {
      openness: 50,
      conscientiousness: 50,
      extraversion: 50,
      agreeableness: 50,
      neuroticism: 50,
    },

    sentiment: {
      valence: 50,
      arousal: 50,
      dominance: 50,
      averageSentiment: 50,
    },

    communicationStyle: {
      verbosity: 50,
      formality: 50,
      questionRatio: 20,
      directness: 50,
      emojiUsage: 20,
      responseLatency: 60000,
    },

    interactionPatterns: {
      totalInteractions: 0,
      positiveInteractions: 0,
      negativeInteractions: 0,
      neutralInteractions: 0,
      averageMessageLength: 0,
      topicsOfInterest: [],
      requestTypes: {},
      lastInteractionTone: 'neutral',
    },

    affinity: {
      overall: 0,        // Start neutral
      respect: 50,
      rapport: 50,
      trustworthiness: 50,
      intellectualStimulation: 50,
      factors: {
        politeness: 0,
        gratitude: 0,
        reasonableness: 0,
        patience: 0,
        creativity: 0,
        hostility: 0,
        demandingness: 0,
      },
    },

    profileVersion: 1,
    dataPoints: 0,
    confidence: 0,
    lastUpdated: now,
    observations: [],
  };
}

/**
 * Helper to clamp values to valid ranges
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate weighted moving average for trait updates
 * Uses exponential decay - recent observations matter more
 */
export function updateTraitWithDecay(
  currentValue: number,
  newObservation: number,
  dataPoints: number,
  decayFactor: number = 0.1
): number {
  // More data points = slower change (profile stabilizes over time)
  const effectiveWeight = decayFactor / (1 + Math.log(1 + dataPoints));
  return currentValue * (1 - effectiveWeight) + newObservation * effectiveWeight;
}
