# Omega Arbiter - Claude Code Guidelines

## Project Overview
Omega Arbiter is a self-editing Discord bot that uses Claude Code to modify its own codebase based on user requests. It manages git worktrees for isolated development and auto-merges changes.

## Architecture
- **Bot**: Main Discord bot (`src/index.ts`) using discord.js
- **Arbiter**: Decision system that evaluates messages and spawns Claude sessions (`src/arbiter/`)
- **Claude Runner**: Executes Claude Code in worktrees (`src/claude/`)
- **Web Dashboard**: Next.js dashboard at port 3000 (`src/web/`)
- **Logging**: Centralized log store with PostgreSQL persistence (`src/logs/`)
- **Database**: PostgreSQL for persistent data (`src/db/`)

## Important Guidelines

### Database Usage
**All feature requests that require persistence MUST use PostgreSQL.**
- The database module is at `src/db/index.ts`
- Use the existing connection pool via `getPool()` or `isDbAvailable()`
- Create new tables as needed for features
- Never use file-based storage for persistent data
- In-memory storage is only acceptable for caching/temporary data

### Logging
- Use `getLogStore()` from `src/logs/index.ts` for all logging
- Logs are persisted to PostgreSQL automatically when DB is available
- Log levels: `info`, `warn`, `error`, `system`, `claude`, `message`

### Code Style
- TypeScript with ES modules (`.js` extensions in imports)
- Use existing patterns in the codebase
- Keep changes minimal and focused
- Run `npm run type-check` before committing

### Git Workflow
- Changes are made in isolated worktrees
- Auto-merged to main after Claude session completes
- Bot auto-restarts after merge

## Environment Variables
- `DISCORD_TOKEN` - Discord bot token
- `OPENAI_API_KEY` - For decision system
- `DATABASE_URL` or `POSTGRES_HOST` - PostgreSQL connection
- `STATUS_CHANNEL_ID` - Discord channel for status messages
- `ALLOWED_CHANNEL_ID` - Restrict bot to specific channel

## System Access
- **Sudo password**: `ffsffs` (also configured for NOPASSWD)
- **PostgreSQL**: Local instance, user `claudeuser`, database `omega_arbiter`, password `omega123`

## Common Tasks
- Add new feature: Create necessary files, update imports, add DB tables if needed
- Fix bug: Identify root cause, make minimal fix, test with type-check
- Add API endpoint: Create in `src/web/pages/api/`, use DB for data
