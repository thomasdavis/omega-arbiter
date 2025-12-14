/**
 * Psychological Profiling Module
 *
 * Main entry point for Omega's psychological profiling system.
 * Provides high-level API for analyzing users and building profiles over time.
 *
 * Scientific foundations:
 * - Big Five personality model (Costa & McCrae, 1992)
 * - VAD sentiment model (Russell & Mehrabian, 1977)
 * - LIWC linguistic analysis principles (Pennebaker et al., 2015)
 * - Communication Accommodation Theory (Giles, 2016)
 */

import { ChatMessage } from '../types.js';
import {
  analyzeMessage,
  updateProfile,
  generateProfileSummary,
  createNewProfile,
} from './analyzer.js';
import {
  initializePsychTable,
  getOrCreateProfile,
  saveProfile,
  getProfile,
  getFavoriteProfiles,
  getProblematicProfiles,
  getProfileStats,
  deleteProfile,
} from './store.js';
import {
  UserPsychProfile,
  ProfileSummary,
  MessageAnalysis,
  ProfileObservation,
} from './types.js';

// Re-export types
export {
  UserPsychProfile,
  ProfileSummary,
  MessageAnalysis,
  ProfileObservation,
} from './types.js';

// Module state
let isInitialized = false;

/**
 * Initialize the psychology module
 */
export async function initializePsychology(): Promise<boolean> {
  if (isInitialized) return true;

  const tableReady = await initializePsychTable();
  isInitialized = true;

  console.log('[Psychology] Module initialized', tableReady ? 'with database' : 'in-memory only');
  return true;
}

/**
 * Process a message and update the user's psychological profile
 * This is the main entry point for profiling
 */
export async function processMessageForProfiling(
  message: ChatMessage
): Promise<{
  profile: UserPsychProfile;
  analysis: MessageAnalysis;
  summary: ProfileSummary;
}> {
  // Get or create the user's profile
  const existingProfile = await getOrCreateProfile(message.authorId, message.authorName);

  // Analyze the message
  const analysis = await analyzeMessage(message, existingProfile);

  // Update the profile with the analysis
  const updatedProfile = updateProfile(existingProfile, analysis, message);

  // Save the updated profile
  await saveProfile(updatedProfile);

  // Generate a summary for potential use in responses
  const summary = generateProfileSummary(updatedProfile);

  return {
    profile: updatedProfile,
    analysis,
    summary,
  };
}

/**
 * Get a user's profile summary for use in prompts
 */
export async function getUserProfileSummary(userId: string, username: string): Promise<ProfileSummary | null> {
  const profile = await getOrCreateProfile(userId, username);
  if (!profile || profile.dataPoints === 0) {
    return null;  // No meaningful data yet
  }
  return generateProfileSummary(profile);
}

/**
 * Get the raw profile for a user
 */
export async function getUserProfile(userId: string): Promise<UserPsychProfile | null> {
  return getProfile(userId);
}

/**
 * Get users the bot likes most
 */
export async function getFavorites(limit: number = 5): Promise<ProfileSummary[]> {
  const profiles = await getFavoriteProfiles(limit);
  return profiles.map(generateProfileSummary);
}

/**
 * Get users the bot has issues with
 */
export async function getProblematicUsers(limit: number = 5): Promise<ProfileSummary[]> {
  const profiles = await getProblematicProfiles(limit);
  return profiles.map(generateProfileSummary);
}

/**
 * Get module statistics
 */
export { getProfileStats } from './store.js';

/**
 * Delete a user's profile (GDPR compliance)
 */
export { deleteProfile } from './store.js';

/**
 * Build profile context for use in response prompts
 */
export function buildProfileContext(summary: ProfileSummary | null): string {
  if (!summary) {
    return '';
  }

  // Only include profile info if we have some confidence
  if (summary.confidence < 15) {
    return `\n[Note: This is a relatively new user (${summary.username}), limited profile data available]`;
  }

  const affinityEmoji = {
    loved: '💚',
    liked: '🙂',
    neutral: '😐',
    disliked: '😕',
    problematic: '⚠️',
  }[summary.affinityLevel];

  const lines = [
    `\n## User Profile: ${summary.username}`,
    `Affinity: ${affinityEmoji} ${summary.affinityLevel} (${summary.affinityScore.toFixed(0)})`,
    `Personality: ${summary.personalitySnapshot}`,
  ];

  if (summary.keyTraits.length > 0) {
    lines.push(`Key traits: ${summary.keyTraits.join(', ')}`);
  }

  lines.push(`Recent mood: ${summary.recentMood}`);
  lines.push(`Communication tips: ${summary.communicationTips}`);
  lines.push(`Profile confidence: ${summary.confidence.toFixed(0)}%`);

  return lines.join('\n');
}

/**
 * Get a brief affinity description for quick use
 */
export function getAffinityDescription(summary: ProfileSummary): string {
  const score = summary.affinityScore;

  if (score >= 60) {
    return `You really like ${summary.username} - they're one of your favorite people to work with.`;
  } else if (score >= 30) {
    return `You like ${summary.username} - pleasant interactions so far.`;
  } else if (score >= 10) {
    return `You have a slight positive impression of ${summary.username}.`;
  } else if (score >= -10) {
    return `You're neutral about ${summary.username} - still forming an opinion.`;
  } else if (score >= -30) {
    return `You're slightly wary of ${summary.username} - some past friction.`;
  } else if (score >= -60) {
    return `You don't particularly enjoy interacting with ${summary.username}.`;
  } else {
    return `You find ${summary.username} difficult to work with - they've been problematic.`;
  }
}
