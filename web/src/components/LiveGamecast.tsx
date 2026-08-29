// Live-game visuals fed by ../gamecast, styled after ESPN's gamecast:
//   <FieldStrip>    — compact striped field on every live card: ball spot,
//                     possession, first-down line, red-zone tint.
//   <LiveGamePanel> — the break-out panel: broadcast-style field (striped
//                     turf, yard numbers, translucent drive band), a
//                     hand-rolled SVG probability chart (this app has no
//                     chart dependency — split home/away color at the 50%
//                     axis, quarter labels, team logos on the axis), and a
//                     per-drive accordion play-by-play with result badges.
//
// Field geometry (shared): ESPN yard lines are absolute 0-100 with the HOME
// goal line at 0. Home renders on the RIGHT (TV convention), so
// x = X0 + (100 - yardLine) in a 0-120 viewBox with 10-unit endzones.
//
// Ported from monte_site/cfb-sim-explorer's LiveGamecast.tsx (visually
// verified against live games 2026-08-27) with one structural change: the
// probability chart is hand-rolled SVG instead of recharts.

import { useMemo } from 'react';
import type { AttackDir, CurrentDrive, GamecastSituation, GameSummaryLite, ProbPoint } from '../gamecast';
import { useGameProbabilities, useGameSummary } from '../gamecast';
import type { PickType } from '../pool/types';

const X0 = 10; // endzone width in viewBox units
const xOf = (yardLine: number) => X0 + (100 - Math.max(0, Math.min(100, yardLine)));

// Turf palette — deliberate literals like team hex: the field must read as
// grass, never re-theme.
const TURF_A = '#2f7d46';
const TURF_B = '#2a7040';
const LINE_WHITE = 'rgba(255,255,255,0.75)';
const NUMBER_WHITE = 'rgba(255,255,255,0.55)';
const FIRST_DOWN_YELLOW = '#ffd60a';

export type TeamBits = {
  homeAbbrev?: string;
  awayAbbrev?: string;
  homeColor?: string;
  awayColor?: string;
  homeId?: string;
  awayId?: string;
  homeLogo?: string;
  awayLogo?: string;
};

/** First-down spot in absolute yards, or undefined when not computable. */
function firstDownYL(
  sit: GamecastSituation | undefined,
  dir: AttackDir | null | undefined,
): number | undefined {
  if (!sit || dir == null) return undefined;
  if (sit.yardLine == null || sit.distance == null) return undefined;
  const v = sit.yardLine + dir * sit.distance;
  return v > 0 && v < 100 ? v : undefined; // inside an endzone = goal to go, no line
}

/** Broadcast-style turf: alternating 10-yard stripes, white yard lines, hash
 *  ticks at the fives, optional yard numbers, team-color endzones.
 *  `minimal` drops hashes and endzone text for the card-sized strip. */
function FieldSurface({
  h,
  bits,
  showNumbers = false,
  minimal = false,
  redZoneDir,
}: {
  h: number;
  bits: TeamBits;
  showNumbers?: boolean;
  minimal?: boolean;
  redZoneDir?: AttackDir | null;
}) {
  const yPad = 1.5;
  const yH = h - 2 * yPad;
  const stripes = [];
  for (let i = 0; i < 10; i++) {
    stripes.push(
      <rect
        key={`s${i}`}
        x={X0 + i * 10}
        y={yPad}
        width={10}
        height={yH}
        fill={i % 2 === 0 ? TURF_A : TURF_B}
      />,
    );
  }
  const lines = [];
  for (let v = 10; v <= 90; v += 10) {
    lines.push(
      <line
        key={`l${v}`}
        x1={xOf(v)}
        x2={xOf(v)}
        y1={yPad}
        y2={yPad + yH}
        stroke={LINE_WHITE}
        strokeWidth={v === 50 ? 0.45 : 0.35}
      />,
    );
  }
  const hashes = [];
  if (!minimal) {
    for (let v = 5; v <= 95; v += 10) {
      for (const [y1, y2] of [
        [yPad, yPad + yH * 0.16],
        [yPad + yH * 0.84, yPad + yH],
      ] as const) {
        hashes.push(
          <line
            key={`h${v}-${y1}`}
            x1={xOf(v)}
            x2={xOf(v)}
            y1={y1}
            y2={y2}
            stroke={LINE_WHITE}
            strokeWidth={0.22}
            opacity={0.7}
          />,
        );
      }
    }
  }
  const numbers = [];
  if (showNumbers) {
    for (let v = 10; v <= 90; v += 10) {
      numbers.push(
        <text
          key={`n${v}`}
          x={xOf(v)}
          y={h - 2.2}
          fill={NUMBER_WHITE}
          fontSize={2.8}
          fontWeight={700}
          textAnchor="middle"
          style={{ letterSpacing: 0.5 }}
        >
          {v <= 50 ? v : 100 - v}
        </text>,
      );
    }
  }
  return (
    <g>
      {stripes}
      {redZoneDir != null && (
        <rect
          x={redZoneDir === -1 ? xOf(20) : X0}
          y={yPad}
          width={20}
          height={yH}
          fill="#dc2626"
          opacity={0.16}
        />
      )}
      {lines}
      {hashes}
      {numbers}
      {/* endzones: away left, home right */}
      <rect x={0} y={yPad} width={X0} height={yH} fill={bits.awayColor ?? '#444'} />
      <rect x={110} y={yPad} width={X0} height={yH} fill={bits.homeColor ?? '#444'} />
      {!minimal && (
        <>
          <text
            x={5}
            y={h / 2}
            fill="#fff"
            fontSize={2.8}
            fontWeight={800}
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(-90 5 ${h / 2})`}
            style={{ letterSpacing: 0.8 }}
          >
            {(bits.awayAbbrev ?? '').slice(0, 5)}
          </text>
          <text
            x={115}
            y={h / 2}
            fill="#fff"
            fontSize={2.8}
            fontWeight={800}
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(90 115 ${h / 2})`}
            style={{ letterSpacing: 0.8 }}
          >
            {(bits.homeAbbrev ?? '').slice(0, 5)}
          </text>
        </>
      )}
    </g>
  );
}

function BallMarker({
  x,
  y,
  color,
  dir,
  logo,
  size = 7,
}: {
  x: number;
  y: number;
  color: string;
  dir?: AttackDir | null;
  /** Possessing team's logo — rendered on a white puck at the ball spot;
   *  falls back to the team-color dot when the logo is missing. */
  logo?: string;
  size?: number;
}) {
  // Attacking the home goal line (dir -1) means moving RIGHT on screen.
  const dx = dir == null ? 0 : dir === -1 ? 1 : -1;
  const r = size / 2;
  return (
    <g>
      {dx !== 0 && (
        <polygon
          points={`${x + dx * (r + 0.7)},${y - 1.7} ${x + dx * (r + 3)},${y} ${x + dx * (r + 0.7)},${y + 1.7}`}
          fill="#fff"
          opacity={0.9}
        />
      )}
      {logo ? (
        <>
          <circle cx={x} cy={y} r={r + 0.6} fill="#fff" opacity={0.94} />
          <image
            href={logo}
            x={x - r}
            y={y - r}
            width={size}
            height={size}
            preserveAspectRatio="xMidYMid meet"
          />
        </>
      ) : (
        <circle cx={x} cy={y} r={2.3} fill={color} stroke="#fff" strokeWidth={0.7} />
      )}
    </g>
  );
}

/* ------------------------------- FieldStrip ------------------------------- */

export function FieldStrip({
  situation,
  bits,
  condensed = false,
}: {
  situation: GamecastSituation;
  bits: TeamBits;
  condensed?: boolean;
}) {
  // Wide, thin strip (120:14): scales by WIDTH (height:auto) so it always
  // fills the card instead of letterboxing.
  const h = 14;
  const sit = situation;
  const possHome = sit.possessionId != null && sit.possessionId === bits.homeId;
  const possColor = (possHome ? bits.homeColor : bits.awayColor) ?? 'var(--text)';
  const possAbbrev = possHome ? bits.homeAbbrev : bits.awayAbbrev;
  const possLogo = possHome ? bits.homeLogo : bits.awayLogo;
  const fd = firstDownYL(sit, sit.attackDir);

  return (
    <div className={`field-strip${condensed ? ' condensed' : ''}`} title={sit.lastPlayText ?? undefined}>
      <svg
        viewBox={`0 0 120 ${h}`}
        role="img"
        aria-label={`${possAbbrev ?? 'Offense'} ball, ${sit.downDistanceText ?? ''}`}
      >
        <FieldSurface h={h} bits={bits} minimal redZoneDir={sit.isRedZone ? sit.attackDir : undefined} />
        {fd !== undefined && (
          <line x1={xOf(fd)} x2={xOf(fd)} y1={1} y2={h - 1} stroke={FIRST_DOWN_YELLOW} strokeWidth={0.7} />
        )}
        {sit.yardLine != null && (
          <BallMarker
            x={xOf(sit.yardLine)}
            y={h / 2}
            color={possColor}
            dir={sit.attackDir}
            logo={possLogo}
            size={7}
          />
        )}
      </svg>
      <div className="field-strip-meta">
        <span className="field-strip-poss" style={{ color: possColor }}>
          {possAbbrev ? `${possAbbrev} ball` : ''}
        </span>
        <span className="field-strip-dd">{sit.downDistanceText ?? ''}</span>
      </div>
    </div>
  );
}

/* ------------------------------- DriveField ------------------------------- */

function DriveField({
  drive,
  situation,
  bits,
}: {
  drive?: CurrentDrive;
  situation?: GamecastSituation;
  bits: TeamBits;
}) {
  // 4:1 field, scaled by width (height:auto) — a fixed height letterboxes
  // the drawing into the middle third of the panel.
  const h = 30;
  const dir = drive?.attackDir ?? situation?.attackDir ?? undefined;
  const possId = drive?.teamId ?? situation?.possessionId ?? undefined;
  const possHome = possId != null && possId === bits.homeId;
  const possColor = (possHome ? bits.homeColor : bits.awayColor) ?? '#fff';
  const possLogo = drive?.teamLogo ?? (possHome ? bits.homeLogo : bits.awayLogo);
  const ballYL = situation?.yardLine ?? drive?.ballYL;
  const fd = firstDownYL(situation, dir);

  // The drive band runs from where the possession started to the ball. Use
  // the first scrimmage play (skip the kickoff, whose start is the kicker's
  // spot on the other side of the field).
  const scrim = (drive?.plays ?? []).filter(
    (p) => p.startYL !== undefined && p.typeAbbrev !== 'K' && p.typeAbbrev !== 'EP',
  );
  const bandFrom = scrim.length ? scrim[0].startYL : undefined;
  const bandTo = ballYL ?? undefined;

  return (
    <svg viewBox={`0 0 120 ${h}`} className="drive-field-svg">
      <FieldSurface h={h} bits={bits} showNumbers redZoneDir={situation?.isRedZone ? dir : undefined} />
      {bandFrom !== undefined && bandTo !== undefined && bandFrom !== bandTo && (
        <rect
          x={Math.min(xOf(bandFrom), xOf(bandTo))}
          y={1.5}
          width={Math.abs(xOf(bandFrom) - xOf(bandTo))}
          height={h - 3}
          fill={possColor}
          opacity={0.32}
        />
      )}
      {bandFrom !== undefined && (
        <line
          x1={xOf(bandFrom)}
          x2={xOf(bandFrom)}
          y1={1.5}
          y2={h - 1.5}
          stroke="#fff"
          strokeWidth={0.4}
          strokeDasharray="1.6 1.1"
          opacity={0.75}
        />
      )}
      {fd !== undefined && (
        <line x1={xOf(fd)} x2={xOf(fd)} y1={1.5} y2={h - 1.5} stroke={FIRST_DOWN_YELLOW} strokeWidth={0.85} />
      )}
      {ballYL != null && (
        <BallMarker x={xOf(ballYL)} y={h / 2} color={possColor} dir={dir} logo={possLogo} size={8.5} />
      )}
    </svg>
  );
}

/* -------------------------------- ProbChart ------------------------------- */

// The chart follows the pool's pick type — never a user toggle, and the
// total-over% series is never shown either way: SU pools ask "who wins", ATS
// pools ask "who covers", and over/under isn't a pick either league makes.
type ProbMode = 'win' | 'cover';

// Fixed viewBox so the split clip-paths (home/away halves) and quarter
// separators can be laid out in exact units regardless of rendered width.
const VB_W = 600;
const VB_H = 200;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
const PAD_LEFT = 34;
const PAD_RIGHT = 10;
const PLOT_TOP = PAD_TOP;
const PLOT_BOTTOM = VB_H - PAD_BOTTOM;
const PLOT_LEFT = PAD_LEFT;
const PLOT_RIGHT = VB_W - PAD_RIGHT;
const MID_Y = (PLOT_TOP + PLOT_BOTTOM) / 2;

const xAt = (i: number, n: number) => (n <= 1 ? PLOT_LEFT : PLOT_LEFT + (i / (n - 1)) * (PLOT_RIGHT - PLOT_LEFT));
const yAt = (v: number) => PLOT_BOTTOM - (Math.max(0, Math.min(100, v)) / 100) * (PLOT_BOTTOM - PLOT_TOP);

type PlotPt = { x: number; y: number };

/** Step-after line: value holds flat until it jumps at the NEXT point's x. */
function stepLinePath(pts: PlotPt[]): string {
  if (!pts.length) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` H ${pts[i].x} V ${pts[i].y}`;
  return d;
}

/** Same step shape, closed back along the baseline for an area fill. */
function stepAreaPath(pts: PlotPt[], baselineY: number): string {
  if (!pts.length) return '';
  let d = `M ${pts[0].x} ${baselineY} L ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` H ${pts[i].x} V ${pts[i].y}`;
  d += ` L ${pts[pts.length - 1].x} ${baselineY} Z`;
  return d;
}

function ProbChart({
  points,
  summary,
  bits,
  eventId,
  pickType,
}: {
  points: ProbPoint[];
  summary: GameSummaryLite | null;
  bits: TeamBits;
  eventId: string;
  pickType: PickType;
}) {
  const hasCover = points.some((p) => p.coverHome !== undefined);
  // ATS pools want cover%; SU pools want win%. ESPN's core-API probabilities
  // feed doesn't always carry spreadCoverProbHome even on lined games (only
  // win% is guaranteed) — fall back to the win% series, correctly labeled,
  // rather than an empty chart.
  const effMode: ProbMode = pickType === 'ats' && hasCover ? 'cover' : 'win';

  const n = points.length;
  const plotPts: PlotPt[] = useMemo(() => {
    const out: PlotPt[] = [];
    points.forEach((p, i) => {
      const v = effMode === 'win' ? p.homeWin : p.coverHome;
      if (v === undefined) return;
      out.push({ x: xAt(i, n), y: yAt(v) });
    });
    return out;
  }, [points, effMode, n]);

  const linePath = useMemo(() => stepLinePath(plotPts), [plotPts]);
  const areaPath = useMemo(() => stepAreaPath(plotPts, MID_Y), [plotPts]);

  // Quarter boundaries (3600-second regulation clock) -> separator lines and
  // ESPN-style 1st/2nd/3rd/4th/OT labels centered inside each segment.
  const { boundaryX, segments } = useMemo(() => {
    const bounds: number[] = [];
    for (const thresh of [2700, 1800, 900]) {
      const idx = points.findIndex((p) => p.secondsLeft <= thresh);
      if (idx > 0) bounds.push(idx);
    }
    const otIdx = points.findIndex((p) => p.secondsLeft < 0);
    if (otIdx > 0) bounds.push(otIdx);
    const edges = [0, ...bounds, Math.max(points.length - 1, 1)];
    const names = ['1st', '2nd', '3rd', '4th', 'OT'];
    const segs: { x: number; label: string }[] = [];
    for (let s = 0; s < edges.length - 1 && s < names.length; s++) {
      const mid = (edges[s] + edges[s + 1]) / 2;
      segs.push({ x: xAt(mid, n), label: names[s] });
    }
    return { boundaryX: bounds.map((b) => xAt(b, n)), segments: segs };
  }, [points, n]);

  const last = points[points.length - 1];
  const gid = `wp-split-${eventId}`;
  const homeColor = bits.homeColor ?? 'var(--navy)';
  const awayColor = bits.awayColor ?? 'var(--text-dim)';

  let leaderLogo: string | undefined;
  let readout = '';
  let caption = 'Win probability';
  if (last) {
    if (effMode === 'cover' && last.coverHome !== undefined) {
      caption = `Cover probability${summary?.pickDetails ? ` · ${summary.pickDetails}` : ''}`;
      const homeUp = last.coverHome >= 50;
      leaderLogo = homeUp ? bits.homeLogo : bits.awayLogo;
      readout = `${(homeUp ? bits.homeAbbrev : bits.awayAbbrev) ?? ''} ${(homeUp ? last.coverHome : 100 - last.coverHome).toFixed(1)}%`;
    } else {
      const homeUp = last.homeWin >= 50;
      leaderLogo = homeUp ? bits.homeLogo : bits.awayLogo;
      readout = `${(homeUp ? bits.homeAbbrev : bits.awayAbbrev) ?? ''} ${(homeUp ? last.homeWin : 100 - last.homeWin).toFixed(1)}%`;
    }
  }

  return (
    <div className="prob-chart">
      <div className="prob-chart-header">
        <span className="prob-caption">{caption}</span>
        <span className="prob-readout">
          {leaderLogo && <img src={leaderLogo} alt="" width={16} height={16} />}
          {readout}
        </span>
      </div>

      <div className="prob-chart-plot">
        {bits.homeLogo && (
          <img className="prob-chart-logo home" src={bits.homeLogo} alt={bits.homeAbbrev} width={16} height={16} />
        )}
        {bits.awayLogo && (
          <img className="prob-chart-logo away" src={bits.awayLogo} alt={bits.awayAbbrev} width={16} height={16} />
        )}
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" role="img" aria-label={`${caption} chart`}>
          <defs>
            <clipPath id={`${gid}-top`}>
              <rect x={PLOT_LEFT} y={PLOT_TOP} width={PLOT_RIGHT - PLOT_LEFT} height={MID_Y - PLOT_TOP} />
            </clipPath>
            <clipPath id={`${gid}-bottom`}>
              <rect x={PLOT_LEFT} y={MID_Y} width={PLOT_RIGHT - PLOT_LEFT} height={PLOT_BOTTOM - MID_Y} />
            </clipPath>
          </defs>

          {/* gridlines */}
          <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={MID_Y} y2={MID_Y} stroke="var(--border)" strokeWidth={1} />
          {boundaryX.map((x, i) => (
            <line
              key={i}
              x1={x}
              x2={x}
              y1={PLOT_TOP}
              y2={PLOT_BOTTOM}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray="3 4"
            />
          ))}

          {/* the plotted series, split home/away at the 50% baseline */}
          <g clipPath={`url(#${gid}-top)`}>
            <path d={areaPath} fill={homeColor} fillOpacity={0.16} />
            <path d={linePath} stroke={homeColor} strokeWidth={2.2} fill="none" />
          </g>
          <g clipPath={`url(#${gid}-bottom)`}>
            <path d={areaPath} fill={awayColor} fillOpacity={0.16} />
            <path d={linePath} stroke={awayColor} strokeWidth={2.2} fill="none" />
          </g>

          {/* y-axis labels */}
          <text x={PLOT_LEFT - 6} y={PLOT_TOP + 4} textAnchor="end" fontSize={9} fill="var(--text-dim)">
            100%
          </text>
          <text x={PLOT_LEFT - 6} y={MID_Y + 3} textAnchor="end" fontSize={9} fill="var(--text-dim)">
            50%
          </text>
          <text x={PLOT_LEFT - 6} y={PLOT_BOTTOM} textAnchor="end" fontSize={9} fill="var(--text-dim)">
            100%
          </text>

          {/* quarter labels */}
          {segments.map((s, i) => (
            <text key={i} x={s.x} y={VB_H - 8} textAnchor="middle" fontSize={10} fill="var(--text-dim)">
              {s.label}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

/* -------------------------------- DriveLog -------------------------------- */

function resultTone(result?: string, isScore?: boolean): 'scoring' | 'turnover' | 'neutral' {
  const r = (result ?? '').toLowerCase();
  if (isScore || r.includes('touchdown') || r.includes('field goal')) return 'scoring';
  if (r.includes('interception') || r.includes('fumble') || r.includes('downs') || r.includes('safety')) {
    return 'turnover';
  }
  return 'neutral';
}

function DriveLog({ drives, bits, isLive }: { drives: CurrentDrive[]; bits: TeamBits; isLive: boolean }) {
  const ordered = [...drives].reverse(); // newest first
  return (
    <div className="drive-log">
      {ordered.map((d, i) => {
        const possHome = d.teamId != null && d.teamId === bits.homeId;
        const logo = d.teamLogo ?? (possHome ? bits.homeLogo : bits.awayLogo);
        const live = isLive && i === 0 && !d.result;
        const tone = resultTone(d.result, d.isScore);
        const label = live ? 'LIVE DRIVE' : (d.result ?? '—').toUpperCase();
        return (
          <details key={d.plays[0]?.id ?? i} open={i === 0} className="drive-log-entry">
            <summary className="drive-log-summary">
              {logo ? (
                <img className="drive-log-logo" src={logo} alt="" />
              ) : (
                <span
                  className="drive-log-logo-fallback"
                  style={{ background: (possHome ? bits.homeColor : bits.awayColor) ?? 'var(--bg)' }}
                />
              )}
              <span className={`drive-log-badge ${live ? 'live' : tone}`}>
                {live && <span className="drive-log-live-dot" />}
                {label}
              </span>
              <span className="drive-log-desc">{d.description ?? ''}</span>
              {d.scoreHome !== undefined && d.scoreAway !== undefined && (
                <span className="drive-log-score">
                  {bits.awayAbbrev} {d.scoreAway}–{d.scoreHome} {bits.homeAbbrev}
                </span>
              )}
            </summary>
            <div>
              {[...d.plays].reverse().map((p, j) => (
                <div key={p.id || j} className={`drive-log-play${p.scoring ? ' scoring' : ''}`}>
                  {p.startDD && <div className="drive-log-play-dd">{p.startDD}</div>}
                  <div className="drive-log-play-text">{p.text}</div>
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/* ------------------------------ LiveGamePanel ----------------------------- */

export function LiveGamePanel({
  eventId,
  isLive,
  situation,
  bits,
  pickType,
}: {
  eventId: string;
  isLive: boolean;
  situation?: GamecastSituation;
  bits: TeamBits;
  /** Which probability series the chart shows — see ProbChart. */
  pickType: PickType;
}) {
  const summary = useGameSummary(eventId, isLive);
  const probs = useGameProbabilities(eventId, isLive);

  const drive = summary?.drive;
  const drives = summary?.drives ?? [];
  const loading = summary === null && probs === null;
  const nothing = !loading && !drives.length && !(probs && probs.length);
  const possHome = (drive?.teamId ?? situation?.possessionId ?? undefined) === bits.homeId;
  const possLogo = drive?.teamLogo ?? (possHome ? bits.homeLogo : bits.awayLogo);

  return (
    <div className="gamecast-panel">
      {isLive && (drive || situation) && (
        <div className="drive-field-wrap">
          <DriveField drive={drive} situation={situation} bits={bits} />
          <div className="drive-field-meta">
            {possLogo && <img src={possLogo} alt="" width={15} height={15} />}
            <span className="drive-field-team">{drive?.teamAbbrev ? `${drive.teamAbbrev} drive` : ''}</span>
            {drive?.description && <span className="drive-field-desc">· {drive.description}</span>}
            <span className="drive-field-dd">{situation?.downDistanceText ?? ''}</span>
          </div>
        </div>
      )}

      {probs && probs.length > 0 && (
        <ProbChart points={probs} summary={summary} bits={bits} eventId={eventId} pickType={pickType} />
      )}

      {drives.length > 0 && <DriveLog drives={drives} bits={bits} isLive={isLive} />}

      {loading && <div className="gamecast-note">Loading live feed…</div>}
      {nothing && (
        <div className="gamecast-note">
          ESPN provides score-only coverage for this game (no play-by-play or probability feed).
        </div>
      )}
    </div>
  );
}
