// Pregame "Team leaders" section for a scoreboard card — the pregame sibling
// of the live gamecast strip, and it deliberately reuses that opener's look
// (icon block, label, one-line hint, chevron) so the two read as one idiom.
//
// It is collapsed by default and fetches nothing until it is opened (see
// leaders.ts for why the per-game summary feed is the source). When ESPN has
// no leaders for a game the whole section — opener included — disappears via
// `onEmpty`, so an early-season card never shows an empty shell.

import { useEffect, useRef, useState } from 'react';
import type { Team } from '../types';
import type { CategoryLeader, TeamLeaders } from '../leaders';
import { LEADER_CATEGORIES, useTeamLeaders } from '../leaders';

/** One rendered column: ESPN's leader data plus this app's own team identity
 * (logo/abbrev), joined by ESPN team id — never by name (see types.ts). */
interface LeaderColumn {
  leaders: TeamLeaders | null;
  label: string;
  logo: string | null;
}

function matchTeam(teams: TeamLeaders[], team: Team | null): TeamLeaders | null {
  if (!team) return null;
  if (team.id) {
    const byId = teams.find((t) => t.teamId === team.id);
    if (byId) return byId;
  }
  const abbrev = team.abbrev?.trim().toUpperCase();
  if (!abbrev) return null;
  return teams.find((t) => t.abbrev?.toUpperCase() === abbrev) ?? null;
}

function column(leaders: TeamLeaders | null, team: Team | null): LeaderColumn {
  const label =
    team?.abbrev?.trim() ||
    leaders?.abbrev ||
    team?.school?.trim() ||
    leaders?.displayName ||
    '—';
  return { leaders, label, logo: team?.logo ?? null };
}

/** Away first, home second — the card's own order. If the id/abbrev join
 * fails for BOTH sides (it never should; same ESPN feed on both ends) fall
 * back to ESPN's own order and labels rather than dropping the section. */
function buildColumns(teams: TeamLeaders[], away: Team | null, home: Team | null): LeaderColumn[] {
  const a = matchTeam(teams, away);
  const h = matchTeam(teams, home);
  if (a || h) return [column(a, away), column(h, home)];
  return teams.slice(0, 2).map((t) => column(t, null));
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** ESPN headshot, lazy-loaded, degrading to the player's initials both when
 * ESPN has no headshot (common for FCS/backup players) and when the image
 * fails to load. */
function Headshot({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className="leader-shot leader-shot-fallback" aria-hidden="true">
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      className="leader-shot"
      src={src}
      alt={name}
      width={36}
      height={36}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

function TeamMark({ col }: { col: LeaderColumn }) {
  return (
    <>
      {col.logo && <img className="leader-logo" src={col.logo} alt="" loading="lazy" />}
      <span className="leader-abbrev">{col.label}</span>
    </>
  );
}

function LeaderCell({ col, leader }: { col: LeaderColumn; leader: CategoryLeader | null }) {
  // Only reached when this team HAS stats but ESPN lists no leader in this
  // one category — a team with nothing at all is dropped a level up.
  if (!leader) {
    return (
      <div className="leader-cell empty">
        <span className="leader-shot leader-shot-fallback" aria-hidden="true">
          –
        </span>
        <div className="leader-text">
          <span className="leader-name">
            <TeamMark col={col} />
          </span>
          <span className="leader-stat">No leader listed</span>
        </div>
      </div>
    );
  }
  const { athlete, displayValue } = leader;
  return (
    <div className="leader-cell">
      <Headshot src={athlete.headshot} name={athlete.name} />
      <div className="leader-text">
        <span className="leader-name">
          <TeamMark col={col} />
          <span className="leader-player">{athlete.name}</span>
          {athlete.position && <span className="leader-pos">{athlete.position}</span>}
        </span>
        <span className="leader-stat">{displayValue}</span>
      </div>
    </div>
  );
}

function LeadersBody({
  teams,
  away,
  home,
}: {
  teams: TeamLeaders[];
  away: Team | null;
  home: Team | null;
}) {
  const cols = buildColumns(teams, away, home);
  const hasData = (col: LeaderColumn) =>
    LEADER_CATEGORIES.some((cat) => !!col.leaders?.byCategory[cat.key]);
  // Early in the season one side has usually not played. Repeating an empty
  // cell for it on every category is noise, so that team drops out of the
  // grid and gets one line at the bottom instead.
  const withData = cols.filter(hasData);
  const shown = withData.length === 1 ? withData : cols;
  const missing = withData.length === 1 ? cols.filter((c) => !hasData(c)) : [];
  const rows = LEADER_CATEGORIES.map((cat) => ({
    ...cat,
    cells: shown.map((col) => col.leaders?.byCategory[cat.key] ?? null),
  })).filter((row) => row.cells.some(Boolean));
  if (shown.length === 0 || rows.length === 0) return null;
  return (
    <div className="leaders-body">
      {rows.map((row) => (
        <div className="leaders-row" key={row.key}>
          <div className="leaders-cat">{row.label}</div>
          <div className={`leaders-cells${shown.length === 1 ? ' single' : ''}`}>
            {row.cells.map((cell, i) => (
              <LeaderCell key={shown[i].label + i} col={shown[i]} leader={cell} />
            ))}
          </div>
        </div>
      ))}
      {missing.length > 0 && (
        <div className="leaders-note">
          No stats yet for {missing.map((c) => c.label).join(' / ')}
        </div>
      )}
    </div>
  );
}

function LeadersOpener({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`gamecast-open leaders-open${open ? ' open' : ''}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="gamecast-open-icon" aria-hidden="true">
        <svg
          viewBox="0 0 16 16"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <circle cx="8" cy="5.2" r="2.6" />
          <path d="M2.9 13.6c0-2.6 2.3-4.2 5.1-4.2s5.1 1.6 5.1 4.2" />
        </svg>
      </span>
      <span className="gamecast-open-text">
        <span className="gamecast-open-label">{open ? 'Hide team leaders' : 'Team leaders'}</span>
        <span className="gamecast-open-hint">
          {open ? 'Tap to close' : 'Passing, rushing and receiving leaders'}
        </span>
      </span>
      <span className="gamecast-open-chevron" aria-hidden="true">
        {open ? '▲' : '▼'}
      </span>
    </button>
  );
}

interface TeamLeadersSectionProps {
  /** ESPN event id — this app's game ids ARE ESPN's. */
  eventId: string;
  away: Team | null;
  home: Team | null;
  open: boolean;
  onToggle: () => void;
  /** Fired once when ESPN turns out to have nothing for this game, so the
   * parent can drop the section (and its attached-card styling) entirely. */
  onEmpty: () => void;
}

export function TeamLeadersSection({
  eventId,
  away,
  home,
  open,
  onToggle,
  onEmpty,
}: TeamLeadersSectionProps) {
  const { status, teams } = useTeamLeaders(eventId, open);
  const notified = useRef(false);

  useEffect(() => {
    if (status === 'empty' && !notified.current) {
      notified.current = true;
      onEmpty();
    }
  }, [status, onEmpty]);

  if (status === 'empty') return null;

  return (
    <>
      <LeadersOpener open={open} onToggle={onToggle} />
      {open && (
        <div className="leaders-panel">
          {status === 'ready' ? (
            <LeadersBody teams={teams} away={away} home={home} />
          ) : (
            <div className="leaders-loading">Loading team leaders…</div>
          )}
        </div>
      )}
    </>
  );
}
