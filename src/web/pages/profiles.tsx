import { useEffect, useState } from 'react';
import Link from 'next/link';

interface BigFiveTraits {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

interface SentimentMetrics {
  valence: number;
  arousal: number;
  dominance: number;
  averageSentiment: number;
}

interface CommunicationStyle {
  verbosity: number;
  formality: number;
  questionRatio: number;
  directness: number;
  emojiUsage: number;
  responseLatency: number;
}

interface InteractionPatterns {
  totalInteractions: number;
  positiveInteractions: number;
  negativeInteractions: number;
  neutralInteractions: number;
  averageMessageLength: number;
  topicsOfInterest: string[];
  requestTypes: Record<string, number>;
  lastInteractionTone: 'positive' | 'negative' | 'neutral';
}

interface AffinityScore {
  overall: number;
  respect: number;
  rapport: number;
  trustworthiness: number;
  intellectualStimulation: number;
  factors: {
    politeness: number;
    gratitude: number;
    reasonableness: number;
    patience: number;
    creativity: number;
    hostility: number;
    demandingness: number;
  };
}

interface ProfileObservation {
  timestamp: string;
  type: string;
  description: string;
  impact: 'positive' | 'negative' | 'neutral';
  affinityChange: number;
}

interface UserPsychProfile {
  userId: string;
  username: string;
  firstSeen: string;
  lastSeen: string;
  bigFive: BigFiveTraits;
  sentiment: SentimentMetrics;
  communicationStyle: CommunicationStyle;
  interactionPatterns: InteractionPatterns;
  affinity: AffinityScore;
  profileVersion: number;
  dataPoints: number;
  confidence: number;
  lastUpdated: string;
  observations: ProfileObservation[];
}

interface ProfileStats {
  totalProfiles: number;
  avgAffinity: number;
  avgConfidence: number;
  totalDataPoints: number;
}

interface ProfilesResponse {
  profiles: UserPsychProfile[];
  stats: ProfileStats;
  error?: string;
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleString();
}

function getAffinityLevel(score: number): { label: string; color: string } {
  if (score >= 50) return { label: 'Loved', color: '#22c55e' };
  if (score >= 20) return { label: 'Liked', color: '#84cc16' };
  if (score >= -20) return { label: 'Neutral', color: '#eab308' };
  if (score >= -50) return { label: 'Disliked', color: '#f97316' };
  return { label: 'Problematic', color: '#ef4444' };
}

function getTraitLabel(value: number): string {
  if (value >= 80) return 'Very High';
  if (value >= 60) return 'High';
  if (value >= 40) return 'Moderate';
  if (value >= 20) return 'Low';
  return 'Very Low';
}

function TraitBar({ label, value, color = '#a855f7' }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
        <span style={{ fontSize: '12px', color: '#aaa' }}>{label}</span>
        <span style={{ fontSize: '12px', color: '#888' }}>{value.toFixed(0)} - {getTraitLabel(value)}</span>
      </div>
      <div style={{
        backgroundColor: '#1a1a2e',
        borderRadius: '4px',
        height: '8px',
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${value}%`,
          height: '100%',
          backgroundColor: color,
          transition: 'width 0.3s ease'
        }} />
      </div>
    </div>
  );
}

function ProfileCard({ profile, isExpanded, onToggle }: {
  profile: UserPsychProfile;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const affinity = getAffinityLevel(profile.affinity.overall);

  return (
    <div style={{
      backgroundColor: '#16213e',
      borderRadius: '12px',
      marginBottom: '20px',
      overflow: 'hidden',
      border: '1px solid #333'
    }}>
      {/* Header - Always Visible */}
      <div
        onClick={onToggle}
        style={{
          padding: '20px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: isExpanded ? '1px solid #333' : 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            backgroundColor: '#a855f7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            fontWeight: 'bold',
            color: 'white'
          }}>
            {profile.username.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 style={{ margin: 0, color: '#eee', fontSize: '18px' }}>{profile.username}</h3>
            <span style={{ color: '#888', fontSize: '12px' }}>ID: {profile.userId}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          {/* Affinity Badge */}
          <div style={{
            backgroundColor: affinity.color + '22',
            border: `1px solid ${affinity.color}`,
            color: affinity.color,
            padding: '6px 12px',
            borderRadius: '20px',
            fontSize: '14px',
            fontWeight: 'bold'
          }}>
            {affinity.label} ({profile.affinity.overall.toFixed(0)})
          </div>

          {/* Stats */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#4da6ff', fontSize: '14px' }}>
              {profile.interactionPatterns.totalInteractions} interactions
            </div>
            <div style={{ color: '#888', fontSize: '12px' }}>
              Confidence: {profile.confidence.toFixed(0)}%
            </div>
          </div>

          {/* Expand Arrow */}
          <span style={{
            color: '#888',
            fontSize: '20px',
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}>
            ▼
          </span>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div style={{ padding: '20px' }}>
          {/* Timestamps */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '15px',
            marginBottom: '25px',
            padding: '15px',
            backgroundColor: '#0f1629',
            borderRadius: '8px'
          }}>
            <div>
              <div style={{ color: '#888', fontSize: '11px', marginBottom: '4px' }}>First Seen</div>
              <div style={{ color: '#eee', fontSize: '13px' }}>{formatDate(profile.firstSeen)}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '11px', marginBottom: '4px' }}>Last Seen</div>
              <div style={{ color: '#eee', fontSize: '13px' }}>{formatDate(profile.lastSeen)}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '11px', marginBottom: '4px' }}>Last Updated</div>
              <div style={{ color: '#eee', fontSize: '13px' }}>{formatDate(profile.lastUpdated)}</div>
            </div>
          </div>

          {/* Main Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
            {/* Big Five Personality */}
            <div style={{
              backgroundColor: '#0f1629',
              padding: '20px',
              borderRadius: '8px'
            }}>
              <h4 style={{ color: '#a855f7', margin: '0 0 15px 0', fontSize: '14px' }}>
                Big Five Personality (OCEAN)
              </h4>
              <TraitBar label="Openness" value={profile.bigFive.openness} color="#3b82f6" />
              <TraitBar label="Conscientiousness" value={profile.bigFive.conscientiousness} color="#22c55e" />
              <TraitBar label="Extraversion" value={profile.bigFive.extraversion} color="#eab308" />
              <TraitBar label="Agreeableness" value={profile.bigFive.agreeableness} color="#f97316" />
              <TraitBar label="Neuroticism" value={profile.bigFive.neuroticism} color="#ef4444" />
            </div>

            {/* Sentiment Metrics */}
            <div style={{
              backgroundColor: '#0f1629',
              padding: '20px',
              borderRadius: '8px'
            }}>
              <h4 style={{ color: '#a855f7', margin: '0 0 15px 0', fontSize: '14px' }}>
                Sentiment (VAD Model)
              </h4>
              <TraitBar label="Valence (Positive/Negative)" value={profile.sentiment.valence} color="#22c55e" />
              <TraitBar label="Arousal (Energy Level)" value={profile.sentiment.arousal} color="#f97316" />
              <TraitBar label="Dominance (Control)" value={profile.sentiment.dominance} color="#3b82f6" />
              <TraitBar label="Average Sentiment" value={profile.sentiment.averageSentiment} color="#a855f7" />
            </div>

            {/* Communication Style */}
            <div style={{
              backgroundColor: '#0f1629',
              padding: '20px',
              borderRadius: '8px'
            }}>
              <h4 style={{ color: '#a855f7', margin: '0 0 15px 0', fontSize: '14px' }}>
                Communication Style
              </h4>
              <TraitBar label="Verbosity" value={profile.communicationStyle.verbosity} />
              <TraitBar label="Formality" value={profile.communicationStyle.formality} />
              <TraitBar label="Question Ratio" value={profile.communicationStyle.questionRatio} />
              <TraitBar label="Directness" value={profile.communicationStyle.directness} />
              <TraitBar label="Emoji Usage" value={profile.communicationStyle.emojiUsage} />
              <div style={{ marginTop: '10px', color: '#888', fontSize: '12px' }}>
                Avg Response Latency: {(profile.communicationStyle.responseLatency / 1000).toFixed(1)}s
              </div>
            </div>

            {/* Affinity Details */}
            <div style={{
              backgroundColor: '#0f1629',
              padding: '20px',
              borderRadius: '8px'
            }}>
              <h4 style={{ color: '#a855f7', margin: '0 0 15px 0', fontSize: '14px' }}>
                Omega's Affinity Towards User
              </h4>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '10px',
                marginBottom: '15px'
              }}>
                <div>
                  <div style={{ color: '#888', fontSize: '11px' }}>Respect</div>
                  <div style={{ color: '#4da6ff', fontSize: '16px', fontWeight: 'bold' }}>
                    {profile.affinity.respect.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#888', fontSize: '11px' }}>Rapport</div>
                  <div style={{ color: '#4da6ff', fontSize: '16px', fontWeight: 'bold' }}>
                    {profile.affinity.rapport.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#888', fontSize: '11px' }}>Trustworthiness</div>
                  <div style={{ color: '#4da6ff', fontSize: '16px', fontWeight: 'bold' }}>
                    {profile.affinity.trustworthiness.toFixed(0)}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#888', fontSize: '11px' }}>Intellectual Stimulation</div>
                  <div style={{ color: '#4da6ff', fontSize: '16px', fontWeight: 'bold' }}>
                    {profile.affinity.intellectualStimulation.toFixed(0)}
                  </div>
                </div>
              </div>

              <h5 style={{ color: '#888', margin: '15px 0 10px 0', fontSize: '12px' }}>Factor Scores</h5>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '8px',
                fontSize: '11px'
              }}>
                {Object.entries(profile.affinity.factors).map(([key, value]) => (
                  <div key={key} style={{
                    textAlign: 'center',
                    padding: '6px',
                    backgroundColor: '#16213e',
                    borderRadius: '4px'
                  }}>
                    <div style={{ color: '#888', textTransform: 'capitalize' }}>{key}</div>
                    <div style={{
                      color: value > 0 ? '#22c55e' : value < 0 ? '#ef4444' : '#888',
                      fontWeight: 'bold'
                    }}>
                      {value > 0 ? '+' : ''}{value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Interaction Patterns */}
          <div style={{
            backgroundColor: '#0f1629',
            padding: '20px',
            borderRadius: '8px',
            marginTop: '20px'
          }}>
            <h4 style={{ color: '#a855f7', margin: '0 0 15px 0', fontSize: '14px' }}>
              Interaction Patterns
            </h4>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: '15px',
              marginBottom: '15px'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#4da6ff', fontSize: '24px', fontWeight: 'bold' }}>
                  {profile.interactionPatterns.totalInteractions}
                </div>
                <div style={{ color: '#888', fontSize: '11px' }}>Total</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#22c55e', fontSize: '24px', fontWeight: 'bold' }}>
                  {profile.interactionPatterns.positiveInteractions}
                </div>
                <div style={{ color: '#888', fontSize: '11px' }}>Positive</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#eab308', fontSize: '24px', fontWeight: 'bold' }}>
                  {profile.interactionPatterns.neutralInteractions}
                </div>
                <div style={{ color: '#888', fontSize: '11px' }}>Neutral</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#ef4444', fontSize: '24px', fontWeight: 'bold' }}>
                  {profile.interactionPatterns.negativeInteractions}
                </div>
                <div style={{ color: '#888', fontSize: '11px' }}>Negative</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#a855f7', fontSize: '24px', fontWeight: 'bold' }}>
                  {profile.interactionPatterns.averageMessageLength.toFixed(0)}
                </div>
                <div style={{ color: '#888', fontSize: '11px' }}>Avg Length</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
              <span style={{ color: '#888', fontSize: '12px' }}>Last Interaction Tone:</span>
              <span style={{
                color: profile.interactionPatterns.lastInteractionTone === 'positive' ? '#22c55e' :
                       profile.interactionPatterns.lastInteractionTone === 'negative' ? '#ef4444' : '#eab308',
                fontWeight: 'bold',
                textTransform: 'capitalize'
              }}>
                {profile.interactionPatterns.lastInteractionTone}
              </span>
            </div>

            {/* Topics of Interest */}
            {profile.interactionPatterns.topicsOfInterest.length > 0 && (
              <div style={{ marginTop: '15px' }}>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '8px' }}>Topics of Interest:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {profile.interactionPatterns.topicsOfInterest.map((topic, i) => (
                    <span key={i} style={{
                      backgroundColor: '#16213e',
                      color: '#4da6ff',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '12px'
                    }}>
                      {topic}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Request Types */}
            {Object.keys(profile.interactionPatterns.requestTypes).length > 0 && (
              <div style={{ marginTop: '15px' }}>
                <div style={{ color: '#888', fontSize: '12px', marginBottom: '8px' }}>Request Types:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {Object.entries(profile.interactionPatterns.requestTypes).map(([type, count]) => (
                    <span key={type} style={{
                      backgroundColor: '#16213e',
                      color: '#a855f7',
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontSize: '12px'
                    }}>
                      {type}: {count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Observations */}
          {profile.observations.length > 0 && (
            <div style={{
              backgroundColor: '#0f1629',
              padding: '20px',
              borderRadius: '8px',
              marginTop: '20px'
            }}>
              <h4 style={{ color: '#a855f7', margin: '0 0 15px 0', fontSize: '14px' }}>
                Recent Observations ({profile.observations.length})
              </h4>
              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {profile.observations.slice(-10).reverse().map((obs, i) => (
                  <div key={i} style={{
                    padding: '10px',
                    borderBottom: '1px solid #333',
                    fontSize: '12px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{
                        color: obs.impact === 'positive' ? '#22c55e' :
                               obs.impact === 'negative' ? '#ef4444' : '#eab308',
                        textTransform: 'uppercase',
                        fontSize: '10px',
                        fontWeight: 'bold'
                      }}>
                        {obs.type.replace(/_/g, ' ')}
                      </span>
                      <span style={{ color: '#666' }}>{formatDate(obs.timestamp)}</span>
                    </div>
                    <div style={{ color: '#aaa' }}>{obs.description}</div>
                    {obs.affinityChange !== 0 && (
                      <div style={{
                        color: obs.affinityChange > 0 ? '#22c55e' : '#ef4444',
                        fontSize: '11px',
                        marginTop: '4px'
                      }}>
                        Affinity: {obs.affinityChange > 0 ? '+' : ''}{obs.affinityChange}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div style={{
            marginTop: '15px',
            padding: '10px 15px',
            backgroundColor: '#0f1629',
            borderRadius: '6px',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#666'
          }}>
            <span>Profile Version: {profile.profileVersion}</span>
            <span>Data Points: {profile.dataPoints}</span>
            <span>Confidence: {profile.confidence.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<UserPsychProfile[]>([]);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'lastSeen' | 'affinity' | 'interactions' | 'confidence'>('lastSeen');
  const [filterAffinity, setFilterAffinity] = useState<'all' | 'positive' | 'neutral' | 'negative'>('all');

  const fetchProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/profiles');
      const data: ProfilesResponse = await res.json();

      if (data.error) {
        setError(data.error);
        setProfiles([]);
        setStats(null);
      } else {
        setProfiles(data.profiles);
        setStats(data.stats);
      }
    } catch (err) {
      setError('Failed to fetch profiles');
      setProfiles([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

  // Sort and filter profiles
  const filteredAndSortedProfiles = [...profiles]
    .filter(p => {
      if (filterAffinity === 'all') return true;
      if (filterAffinity === 'positive') return p.affinity.overall >= 20;
      if (filterAffinity === 'negative') return p.affinity.overall < -20;
      return p.affinity.overall >= -20 && p.affinity.overall < 20;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'affinity':
          return b.affinity.overall - a.affinity.overall;
        case 'interactions':
          return b.interactionPatterns.totalInteractions - a.interactionPatterns.totalInteractions;
        case 'confidence':
          return b.confidence - a.confidence;
        default:
          return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
      }
    });

  return (
    <div style={{
      fontFamily: 'monospace',
      backgroundColor: '#1a1a2e',
      color: '#eee',
      minHeight: '100vh',
      padding: '20px'
    }}>
      {/* Navigation */}
      <nav style={{
        display: 'flex',
        gap: '20px',
        marginBottom: '20px',
        padding: '10px 15px',
        backgroundColor: '#16213e',
        borderRadius: '6px'
      }}>
        <Link href="/" style={{ color: '#4da6ff', textDecoration: 'none' }}>
          Home
        </Link>
        <Link href="/logs" style={{ color: '#4da6ff', textDecoration: 'none' }}>
          Logs
        </Link>
        <Link href="/browse" style={{ color: '#4da6ff', textDecoration: 'none' }}>
          Browse Files
        </Link>
        <Link href="/profiles" style={{ color: '#a855f7', textDecoration: 'none', fontWeight: 'bold' }}>
          Profiles
        </Link>
      </nav>

      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ color: '#a855f7', marginBottom: '10px' }}>User Psychological Profiles</h1>
        <p style={{ color: '#888', marginBottom: '25px' }}>
          Browse and analyze psychological profiles of users who have interacted with Omega Arbiter.
        </p>

        {/* Stats Card */}
        {stats && (
          <div style={{
            backgroundColor: '#16213e',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '25px',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '20px'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#a855f7', fontSize: '32px', fontWeight: 'bold' }}>
                {stats.totalProfiles}
              </div>
              <div style={{ color: '#888', fontSize: '12px' }}>Total Profiles</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                color: stats.avgAffinity >= 0 ? '#22c55e' : '#ef4444',
                fontSize: '32px',
                fontWeight: 'bold'
              }}>
                {stats.avgAffinity >= 0 ? '+' : ''}{stats.avgAffinity.toFixed(1)}
              </div>
              <div style={{ color: '#888', fontSize: '12px' }}>Avg Affinity</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#4da6ff', fontSize: '32px', fontWeight: 'bold' }}>
                {stats.avgConfidence.toFixed(0)}%
              </div>
              <div style={{ color: '#888', fontSize: '12px' }}>Avg Confidence</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#eab308', fontSize: '32px', fontWeight: 'bold' }}>
                {stats.totalDataPoints}
              </div>
              <div style={{ color: '#888', fontSize: '12px' }}>Total Data Points</div>
            </div>
          </div>
        )}

        {/* Controls */}
        <div style={{
          display: 'flex',
          gap: '15px',
          marginBottom: '20px',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#888', fontSize: '12px' }}>Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              style={{
                backgroundColor: '#16213e',
                border: '1px solid #333',
                color: '#eee',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              <option value="lastSeen">Last Seen</option>
              <option value="affinity">Affinity</option>
              <option value="interactions">Interactions</option>
              <option value="confidence">Confidence</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#888', fontSize: '12px' }}>Filter:</span>
            <select
              value={filterAffinity}
              onChange={(e) => setFilterAffinity(e.target.value as typeof filterAffinity)}
              style={{
                backgroundColor: '#16213e',
                border: '1px solid #333',
                color: '#eee',
                padding: '6px 12px',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              <option value="all">All</option>
              <option value="positive">Positive Affinity</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative Affinity</option>
            </select>
          </div>

          <button
            onClick={fetchProfiles}
            style={{
              padding: '6px 16px',
              backgroundColor: '#a855f7',
              border: 'none',
              color: 'white',
              borderRadius: '4px',
              cursor: 'pointer',
              marginLeft: 'auto'
            }}
          >
            Refresh
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div style={{
            backgroundColor: '#ff6b6b22',
            border: '1px solid #ff6b6b',
            color: '#ff6b6b',
            padding: '15px',
            borderRadius: '6px',
            marginBottom: '15px'
          }}>
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div style={{ color: '#666', padding: '40px', textAlign: 'center' }}>
            Loading profiles...
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && profiles.length === 0 && (
          <div style={{
            color: '#666',
            padding: '40px',
            textAlign: 'center',
            backgroundColor: '#16213e',
            borderRadius: '12px'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '15px' }}>👥</div>
            <div>No psychological profiles found.</div>
            <div style={{ fontSize: '12px', marginTop: '10px' }}>
              Profiles are created as users interact with Omega Arbiter.
            </div>
          </div>
        )}

        {/* Profile List */}
        {!loading && !error && filteredAndSortedProfiles.length > 0 && (
          <div>
            <div style={{ color: '#888', fontSize: '12px', marginBottom: '15px' }}>
              Showing {filteredAndSortedProfiles.length} of {profiles.length} profiles
            </div>
            {filteredAndSortedProfiles.map(profile => (
              <ProfileCard
                key={profile.userId}
                profile={profile}
                isExpanded={expandedId === profile.userId}
                onToggle={() => setExpandedId(
                  expandedId === profile.userId ? null : profile.userId
                )}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
