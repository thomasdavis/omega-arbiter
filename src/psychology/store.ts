/**
 * Psychological Profile Storage
 *
 * Handles persistent storage of user psychological profiles in PostgreSQL.
 * Uses JSONB for flexible schema evolution while maintaining queryability.
 */

import { getPool, isDbAvailable } from '../db/index.js';
import {
  UserPsychProfile,
  createDefaultProfile,
  ProfileObservation,
} from './types.js';

// In-memory cache for frequently accessed profiles
const profileCache: Map<string, { profile: UserPsychProfile; cachedAt: number }> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Initialize the psychological profiles table
 */
export async function initializePsychTable(): Promise<boolean> {
  const pool = getPool();
  if (!pool) {
    console.log('[Psychology] No database connection, profiles will be in-memory only');
    return false;
  }

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS user_psych_profiles (
      user_id VARCHAR(100) PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      first_seen TIMESTAMPTZ NOT NULL,
      last_seen TIMESTAMPTZ NOT NULL,
      last_updated TIMESTAMPTZ NOT NULL,

      -- Core profile data stored as JSONB for flexibility
      big_five JSONB NOT NULL,
      sentiment JSONB NOT NULL,
      communication_style JSONB NOT NULL,
      interaction_patterns JSONB NOT NULL,
      affinity JSONB NOT NULL,

      -- Metadata
      profile_version INTEGER NOT NULL DEFAULT 1,
      data_points INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0,

      -- Observations stored as JSONB array
      observations JSONB NOT NULL DEFAULT '[]'::jsonb
    );

    -- Create indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_psych_last_seen ON user_psych_profiles(last_seen DESC);
    CREATE INDEX IF NOT EXISTS idx_psych_affinity ON user_psych_profiles((affinity->>'overall')::numeric);
    CREATE INDEX IF NOT EXISTS idx_psych_data_points ON user_psych_profiles(data_points DESC);
  `;

  try {
    await pool.query(createTableQuery);
    console.log('[Psychology] user_psych_profiles table ready');
    return true;
  } catch (error) {
    console.error('[Psychology] Failed to create profiles table:', error);
    return false;
  }
}

/**
 * Get a user's psychological profile
 */
export async function getProfile(userId: string): Promise<UserPsychProfile | null> {
  // Check cache first
  const cached = profileCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.profile;
  }

  const pool = getPool();
  if (!pool || !isDbAvailable()) {
    // Check in-memory cache even if stale when no DB
    return cached?.profile || null;
  }

  try {
    const result = await pool.query<{
      user_id: string;
      username: string;
      first_seen: Date;
      last_seen: Date;
      last_updated: Date;
      big_five: UserPsychProfile['bigFive'];
      sentiment: UserPsychProfile['sentiment'];
      communication_style: UserPsychProfile['communicationStyle'];
      interaction_patterns: UserPsychProfile['interactionPatterns'];
      affinity: UserPsychProfile['affinity'];
      profile_version: number;
      data_points: number;
      confidence: number;
      observations: ProfileObservation[];
    }>(
      'SELECT * FROM user_psych_profiles WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const profile: UserPsychProfile = {
      userId: row.user_id,
      username: row.username,
      firstSeen: new Date(row.first_seen),
      lastSeen: new Date(row.last_seen),
      lastUpdated: new Date(row.last_updated),
      bigFive: row.big_five,
      sentiment: row.sentiment,
      communicationStyle: row.communication_style,
      interactionPatterns: row.interaction_patterns,
      affinity: row.affinity,
      profileVersion: row.profile_version,
      dataPoints: row.data_points,
      confidence: row.confidence,
      observations: (row.observations || []).map((obs: ProfileObservation) => ({
        ...obs,
        timestamp: new Date(obs.timestamp),
      })),
    };

    // Update cache
    profileCache.set(userId, { profile, cachedAt: Date.now() });

    return profile;
  } catch (error) {
    console.error('[Psychology] Error fetching profile:', error);
    return cached?.profile || null;
  }
}

/**
 * Save or update a user's psychological profile
 */
export async function saveProfile(profile: UserPsychProfile): Promise<boolean> {
  // Always update cache
  profileCache.set(profile.userId, { profile, cachedAt: Date.now() });

  const pool = getPool();
  if (!pool || !isDbAvailable()) {
    console.log('[Psychology] No database, profile saved to cache only');
    return true;
  }

  const upsertQuery = `
    INSERT INTO user_psych_profiles (
      user_id, username, first_seen, last_seen, last_updated,
      big_five, sentiment, communication_style, interaction_patterns, affinity,
      profile_version, data_points, confidence, observations
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username,
      last_seen = EXCLUDED.last_seen,
      last_updated = EXCLUDED.last_updated,
      big_five = EXCLUDED.big_five,
      sentiment = EXCLUDED.sentiment,
      communication_style = EXCLUDED.communication_style,
      interaction_patterns = EXCLUDED.interaction_patterns,
      affinity = EXCLUDED.affinity,
      profile_version = EXCLUDED.profile_version,
      data_points = EXCLUDED.data_points,
      confidence = EXCLUDED.confidence,
      observations = EXCLUDED.observations
  `;

  try {
    await pool.query(upsertQuery, [
      profile.userId,
      profile.username,
      profile.firstSeen,
      profile.lastSeen,
      profile.lastUpdated,
      JSON.stringify(profile.bigFive),
      JSON.stringify(profile.sentiment),
      JSON.stringify(profile.communicationStyle),
      JSON.stringify(profile.interactionPatterns),
      JSON.stringify(profile.affinity),
      profile.profileVersion,
      profile.dataPoints,
      profile.confidence,
      JSON.stringify(profile.observations),
    ]);

    return true;
  } catch (error) {
    console.error('[Psychology] Error saving profile:', error);
    return false;
  }
}

/**
 * Get or create a profile for a user
 */
export async function getOrCreateProfile(userId: string, username: string): Promise<UserPsychProfile> {
  const existing = await getProfile(userId);
  if (existing) {
    // Update username if changed
    if (existing.username !== username) {
      existing.username = username;
      await saveProfile(existing);
    }
    return existing;
  }

  const newProfile = createDefaultProfile(userId, username);
  await saveProfile(newProfile);
  return newProfile;
}

/**
 * Get profiles that the bot likes most
 */
export async function getFavoriteProfiles(limit: number = 10): Promise<UserPsychProfile[]> {
  const pool = getPool();
  if (!pool || !isDbAvailable()) {
    // Return from cache sorted by affinity
    const profiles = Array.from(profileCache.values())
      .map(c => c.profile)
      .sort((a, b) => b.affinity.overall - a.affinity.overall)
      .slice(0, limit);
    return profiles;
  }

  try {
    const result = await pool.query<{
      user_id: string;
      username: string;
      first_seen: Date;
      last_seen: Date;
      last_updated: Date;
      big_five: UserPsychProfile['bigFive'];
      sentiment: UserPsychProfile['sentiment'];
      communication_style: UserPsychProfile['communicationStyle'];
      interaction_patterns: UserPsychProfile['interactionPatterns'];
      affinity: UserPsychProfile['affinity'];
      profile_version: number;
      data_points: number;
      confidence: number;
      observations: ProfileObservation[];
    }>(
      `SELECT * FROM user_psych_profiles
       ORDER BY (affinity->>'overall')::numeric DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => ({
      userId: row.user_id,
      username: row.username,
      firstSeen: new Date(row.first_seen),
      lastSeen: new Date(row.last_seen),
      lastUpdated: new Date(row.last_updated),
      bigFive: row.big_five,
      sentiment: row.sentiment,
      communicationStyle: row.communication_style,
      interactionPatterns: row.interaction_patterns,
      affinity: row.affinity,
      profileVersion: row.profile_version,
      dataPoints: row.data_points,
      confidence: row.confidence,
      observations: (row.observations || []).map((obs: ProfileObservation) => ({
        ...obs,
        timestamp: new Date(obs.timestamp),
      })),
    }));
  } catch (error) {
    console.error('[Psychology] Error fetching favorite profiles:', error);
    return [];
  }
}

/**
 * Get profiles that the bot dislikes
 */
export async function getProblematicProfiles(limit: number = 10): Promise<UserPsychProfile[]> {
  const pool = getPool();
  if (!pool || !isDbAvailable()) {
    const profiles = Array.from(profileCache.values())
      .map(c => c.profile)
      .sort((a, b) => a.affinity.overall - b.affinity.overall)
      .slice(0, limit);
    return profiles;
  }

  try {
    const result = await pool.query<{
      user_id: string;
      username: string;
      first_seen: Date;
      last_seen: Date;
      last_updated: Date;
      big_five: UserPsychProfile['bigFive'];
      sentiment: UserPsychProfile['sentiment'];
      communication_style: UserPsychProfile['communicationStyle'];
      interaction_patterns: UserPsychProfile['interactionPatterns'];
      affinity: UserPsychProfile['affinity'];
      profile_version: number;
      data_points: number;
      confidence: number;
      observations: ProfileObservation[];
    }>(
      `SELECT * FROM user_psych_profiles
       WHERE (affinity->>'overall')::numeric < 0
       ORDER BY (affinity->>'overall')::numeric ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => ({
      userId: row.user_id,
      username: row.username,
      firstSeen: new Date(row.first_seen),
      lastSeen: new Date(row.last_seen),
      lastUpdated: new Date(row.last_updated),
      bigFive: row.big_five,
      sentiment: row.sentiment,
      communicationStyle: row.communication_style,
      interactionPatterns: row.interaction_patterns,
      affinity: row.affinity,
      profileVersion: row.profile_version,
      dataPoints: row.data_points,
      confidence: row.confidence,
      observations: (row.observations || []).map((obs: ProfileObservation) => ({
        ...obs,
        timestamp: new Date(obs.timestamp),
      })),
    }));
  } catch (error) {
    console.error('[Psychology] Error fetching problematic profiles:', error);
    return [];
  }
}

/**
 * Get profile statistics
 */
export async function getProfileStats(): Promise<{
  totalProfiles: number;
  avgAffinity: number;
  avgConfidence: number;
  totalDataPoints: number;
}> {
  const pool = getPool();
  if (!pool || !isDbAvailable()) {
    const profiles = Array.from(profileCache.values()).map(c => c.profile);
    if (profiles.length === 0) {
      return { totalProfiles: 0, avgAffinity: 0, avgConfidence: 0, totalDataPoints: 0 };
    }
    return {
      totalProfiles: profiles.length,
      avgAffinity: profiles.reduce((sum, p) => sum + p.affinity.overall, 0) / profiles.length,
      avgConfidence: profiles.reduce((sum, p) => sum + p.confidence, 0) / profiles.length,
      totalDataPoints: profiles.reduce((sum, p) => sum + p.dataPoints, 0),
    };
  }

  try {
    const result = await pool.query<{
      total_profiles: string;
      avg_affinity: number;
      avg_confidence: number;
      total_data_points: string;
    }>(`
      SELECT
        COUNT(*) as total_profiles,
        COALESCE(AVG((affinity->>'overall')::numeric), 0) as avg_affinity,
        COALESCE(AVG(confidence), 0) as avg_confidence,
        COALESCE(SUM(data_points), 0) as total_data_points
      FROM user_psych_profiles
    `);

    const row = result.rows[0];
    return {
      totalProfiles: parseInt(row.total_profiles, 10),
      avgAffinity: row.avg_affinity,
      avgConfidence: row.avg_confidence,
      totalDataPoints: parseInt(row.total_data_points, 10),
    };
  } catch (error) {
    console.error('[Psychology] Error fetching stats:', error);
    return { totalProfiles: 0, avgAffinity: 0, avgConfidence: 0, totalDataPoints: 0 };
  }
}

/**
 * Clear the profile cache (useful for testing)
 */
export function clearCache(): void {
  profileCache.clear();
}

/**
 * Delete a profile (for GDPR compliance or user request)
 */
export async function deleteProfile(userId: string): Promise<boolean> {
  profileCache.delete(userId);

  const pool = getPool();
  if (!pool || !isDbAvailable()) {
    return true;
  }

  try {
    await pool.query('DELETE FROM user_psych_profiles WHERE user_id = $1', [userId]);
    return true;
  } catch (error) {
    console.error('[Psychology] Error deleting profile:', error);
    return false;
  }
}
