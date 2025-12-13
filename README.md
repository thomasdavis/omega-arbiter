# Omega Arbiter

A self-editing agent that listens to chat transports (Discord, etc.) and manages git worktrees for autonomous development.

## Features

- **Transport Abstraction**: Supports Discord with extensible architecture for Slack, CLI, webhooks
- **AI-Powered Decision System**: Evaluates incoming messages to decide whether/how to act
- **Git Worktree Management**: Creates isolated branches for each task
- **Message Queue & Aggregation**: Handles successive messages that contribute to ongoing work
- **Self-Editing Workflow**: Commits, rebases, and manages code changes autonomously

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Omega Arbiter                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   Discord   │    │    Slack    │    │     CLI     │     │
│  │  Transport  │    │  Transport  │    │  Transport  │     │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘     │
│         │                  │                  │             │
│         └──────────────────┼──────────────────┘             │
│                            ▼                                │
│                   ┌─────────────────┐                       │
│                   │ Message Queue & │                       │
│                   │   Aggregator    │                       │
│                   └────────┬────────┘                       │
│                            ▼                                │
│                   ┌─────────────────┐                       │
│                   │    Decision     │                       │
│                   │     System      │                       │
│                   │   (AI-powered)  │                       │
│                   └────────┬────────┘                       │
│                            ▼                                │
│         ┌──────────────────┴──────────────────┐             │
│         ▼                                     ▼             │
│  ┌─────────────┐                      ┌─────────────┐       │
│  │   Respond   │                      │  Self-Edit  │       │
│  │   (chat)    │                      │  (worktree) │       │
│  └─────────────┘                      └──────┬──────┘       │
│                                              ▼              │
│                                    ┌─────────────────┐      │
│                                    │    Worktree     │      │
│                                    │    Manager      │      │
│                                    └────────┬────────┘      │
│                                             ▼               │
│                                    ┌─────────────────┐      │
│                                    │  Commit/Rebase  │      │
│                                    │    Workflow     │      │
│                                    └─────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit with your values
# - DISCORD_BOT_TOKEN
# - OPENAI_API_KEY
# - GIT_REPO_PATH (path to repo to self-edit)
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | Discord bot token | Required |
| `OPENAI_API_KEY` | OpenAI API key for decisions | Required |
| `GIT_REPO_PATH` | Path to the repo to edit | Current directory |
| `GIT_WORKTREE_BASE` | Where to create worktrees | `/tmp/arbiter-worktrees` |
| `GIT_DEFAULT_BRANCH` | Branch to base work from | `main` |
| `ARBITER_MODEL` | AI model for decisions | `gpt-4o-mini` |
| `ARBITER_CONFIDENCE_THRESHOLD` | Min confidence to act | `70` |

## Usage

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

## How It Works

### 1. Message Reception
Messages arrive via transports (Discord, etc.) and are normalized to a common `ChatMessage` format.

### 2. Decision System
The arbiter uses AI to evaluate each message:
- **ignore**: Do nothing
- **acknowledge**: React with emoji
- **respond**: Generate a response
- **self_edit**: Create a worktree and modify code
- **research**: Gather more information
- **defer**: Queue for later

### 3. Self-Editing Workflow
When `self_edit` is decided:
1. Create a new git branch from `main`
2. Create a worktree for isolated development
3. Aggregate related messages for context
4. Make changes in the worktree
5. Commit with proper attribution
6. Rebase onto latest `main` if needed
7. Push and optionally create PR

### 4. Successive Messages
Follow-up messages in the same channel are:
- Associated with the active work session
- Added to context for the ongoing task
- Can trigger additional commits

## Project Structure

```
omega-arbiter/
├── src/
│   ├── index.ts              # Entry point
│   ├── types.ts              # Core type definitions
│   ├── arbiter/
│   │   ├── index.ts          # Main Arbiter class
│   │   └── decision.ts       # AI decision system
│   ├── transports/
│   │   ├── base.ts           # Base transport class
│   │   ├── discord.ts        # Discord implementation
│   │   └── index.ts
│   ├── git/
│   │   ├── worktree.ts       # Worktree manager
│   │   └── index.ts
│   └── queue/
│       ├── messageQueue.ts   # Message queue & aggregator
│       └── index.ts
├── package.json
├── tsconfig.json
└── .env.example
```

## Adding New Transports

```typescript
import { BaseTransport } from './transports/base.js';
import { ChatMessage, TransportType } from './types.js';

class MyTransport extends BaseTransport {
  type: TransportType = 'webhook'; // or add new type

  async connect(): Promise<void> {
    // Setup connection
  }

  async disconnect(): Promise<void> {
    // Cleanup
  }

  async send(channelId: string, content: string): Promise<void> {
    // Send message
  }

  // ... implement other methods
}
```

## Events

The Arbiter emits these events:

| Event | Description |
|-------|-------------|
| `ready` | Arbiter started and connected |
| `message` | Message received from any transport |
| `decision` | Decision made about a message |
| `session:created` | New work session (worktree) created |
| `session:updated` | Session state changed |
| `session:completed` | Session finished |
| `error` | Error occurred |

## License

MIT
