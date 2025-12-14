import Link from 'next/link';

export default function HomePage() {
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
        marginBottom: '30px',
        padding: '10px 15px',
        backgroundColor: '#16213e',
        borderRadius: '6px'
      }}>
        <Link href="/" style={{ color: '#a855f7', textDecoration: 'none', fontWeight: 'bold' }}>
          Home
        </Link>
        <Link href="/logs" style={{ color: '#4da6ff', textDecoration: 'none' }}>
          Logs
        </Link>
        <Link href="/browse" style={{ color: '#4da6ff', textDecoration: 'none' }}>
          Browse Files
        </Link>
        <Link href="/profiles" style={{ color: '#4da6ff', textDecoration: 'none' }}>
          Profiles
        </Link>
      </nav>

      {/* Hero Section */}
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1 style={{
          color: '#a855f7',
          fontSize: '2.5rem',
          marginBottom: '10px',
          textShadow: '0 0 20px rgba(168, 85, 247, 0.3)'
        }}>
          Omega Arbiter
        </h1>
        <p style={{ color: '#888', fontSize: '1.2rem' }}>
          A self-editing agent for autonomous development
        </p>
      </div>

      {/* About Section */}
      <div style={{
        backgroundColor: '#16213e',
        borderRadius: '12px',
        padding: '30px',
        marginBottom: '30px',
        maxWidth: '900px',
        margin: '0 auto 30px auto'
      }}>
        <h2 style={{ color: '#a855f7', marginTop: 0, marginBottom: '20px' }}>About</h2>
        <p style={{ lineHeight: 1.7, marginBottom: '15px' }}>
          Omega Arbiter is a self-editing agent that listens to chat transports (Discord, etc.)
          and manages git worktrees for autonomous development. It uses AI-powered decision making
          to evaluate incoming messages and determine the appropriate action.
        </p>
        <p style={{ lineHeight: 1.7 }}>
          When triggered, it creates isolated git branches and worktrees to make code changes,
          commits with proper attribution, and can even rebase and push changes automatically.
        </p>
      </div>

      {/* Features Grid */}
      <div style={{
        maxWidth: '900px',
        margin: '0 auto 30px auto'
      }}>
        <h2 style={{ color: '#a855f7', marginBottom: '20px' }}>Features</h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '20px'
        }}>
          <FeatureCard
            title="Transport Abstraction"
            description="Supports Discord with extensible architecture for Slack, CLI, and webhooks."
          />
          <FeatureCard
            title="AI-Powered Decisions"
            description="Evaluates incoming messages to decide whether and how to act on requests."
          />
          <FeatureCard
            title="Git Worktree Management"
            description="Creates isolated branches for each task, keeping work organized and safe."
          />
          <FeatureCard
            title="Message Aggregation"
            description="Handles successive messages that contribute to ongoing work sessions."
          />
          <FeatureCard
            title="Self-Editing Workflow"
            description="Commits, rebases, and manages code changes autonomously."
          />
          <FeatureCard
            title="Real-time Logging"
            description="View system activity and Claude outputs in the live logs dashboard."
          />
        </div>
      </div>

      {/* How It Works */}
      <div style={{
        backgroundColor: '#16213e',
        borderRadius: '12px',
        padding: '30px',
        maxWidth: '900px',
        margin: '0 auto 30px auto'
      }}>
        <h2 style={{ color: '#a855f7', marginTop: 0, marginBottom: '20px' }}>How It Works</h2>
        <ol style={{ lineHeight: 1.8, paddingLeft: '20px', margin: 0 }}>
          <li style={{ marginBottom: '10px' }}>
            <strong style={{ color: '#4da6ff' }}>Message Reception:</strong> Messages arrive via transports and are normalized to a common format.
          </li>
          <li style={{ marginBottom: '10px' }}>
            <strong style={{ color: '#4da6ff' }}>Decision System:</strong> AI evaluates each message and decides: ignore, acknowledge, respond, or self-edit.
          </li>
          <li style={{ marginBottom: '10px' }}>
            <strong style={{ color: '#4da6ff' }}>Worktree Creation:</strong> For self-edit tasks, a new git branch and worktree are created.
          </li>
          <li style={{ marginBottom: '10px' }}>
            <strong style={{ color: '#4da6ff' }}>Code Changes:</strong> Changes are made in the isolated worktree with full context.
          </li>
          <li>
            <strong style={{ color: '#4da6ff' }}>Commit & Push:</strong> Changes are committed with attribution and can be pushed automatically.
          </li>
        </ol>
      </div>

      {/* Quick Links */}
      <div style={{
        maxWidth: '900px',
        margin: '0 auto',
        textAlign: 'center'
      }}>
        <h2 style={{ color: '#a855f7', marginBottom: '20px' }}>Quick Links</h2>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', flexWrap: 'wrap' }}>
          <Link href="/logs" style={{
            display: 'inline-block',
            padding: '12px 24px',
            backgroundColor: '#a855f7',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '6px',
            fontWeight: 'bold',
            transition: 'background-color 0.2s'
          }}>
            View Logs
          </Link>
          <Link href="/browse" style={{
            display: 'inline-block',
            padding: '12px 24px',
            backgroundColor: '#16213e',
            color: '#4da6ff',
            textDecoration: 'none',
            borderRadius: '6px',
            fontWeight: 'bold',
            border: '1px solid #444'
          }}>
            Browse Files
          </Link>
          <Link href="/profiles" style={{
            display: 'inline-block',
            padding: '12px 24px',
            backgroundColor: '#16213e',
            color: '#22c55e',
            textDecoration: 'none',
            borderRadius: '6px',
            fontWeight: 'bold',
            border: '1px solid #444'
          }}>
            User Profiles
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer style={{
        marginTop: '60px',
        textAlign: 'center',
        color: '#666',
        fontSize: '0.9rem'
      }}>
        <p>Omega Arbiter - Self-editing autonomous agent</p>
      </footer>
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div style={{
      backgroundColor: '#16213e',
      borderRadius: '8px',
      padding: '20px',
      border: '1px solid #333'
    }}>
      <h3 style={{ color: '#4da6ff', marginTop: 0, marginBottom: '10px', fontSize: '1rem' }}>
        {title}
      </h3>
      <p style={{ color: '#aaa', margin: 0, fontSize: '0.9rem', lineHeight: 1.5 }}>
        {description}
      </p>
    </div>
  );
}
