import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool, isDbAvailable } from '../../../db/index.js';
import { UserPsychProfile, ProfileObservation } from '../../../psychology/types.js';

interface ProfilesResponse {
  profiles: UserPsychProfile[];
  stats: {
    totalProfiles: number;
    avgAffinity: number;
    avgConfidence: number;
    totalDataPoints: number;
  };
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProfilesResponse>
) {
  const pool = getPool();

  if (!pool || !isDbAvailable()) {
    return res.status(503).json({
      profiles: [],
      stats: { totalProfiles: 0, avgAffinity: 0, avgConfidence: 0, totalDataPoints: 0 },
      error: 'Database not available',
    });
  }

  try {
    // Fetch all profiles
    const profileResult = await pool.query<{
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
    }>(`
      SELECT * FROM user_psych_profiles
      ORDER BY last_seen DESC
    `);

    const profiles: UserPsychProfile[] = profileResult.rows.map(row => ({
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

    // Fetch stats
    const statsResult = await pool.query<{
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

    const statsRow = statsResult.rows[0];
    const stats = {
      totalProfiles: parseInt(statsRow.total_profiles, 10),
      avgAffinity: statsRow.avg_affinity,
      avgConfidence: statsRow.avg_confidence,
      totalDataPoints: parseInt(statsRow.total_data_points, 10),
    };

    res.status(200).json({ profiles, stats });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[API/Profiles] Error fetching profiles:', err);
    res.status(500).json({
      profiles: [],
      stats: { totalProfiles: 0, avgAffinity: 0, avgConfidence: 0, totalDataPoints: 0 },
      error: `Failed to fetch profiles: ${message}`,
    });
  }
}
