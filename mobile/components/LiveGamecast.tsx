// Live-game visuals fed by ../gamecast — mirrors
// web/src/components/LiveGamecast.tsx (see CLAUDE.md parity rule):
//   <FieldStrip>    — compact striped field on every live card: ball spot,
//                     possession, first-down line, red-zone tint.
//   <LiveGamePanel> — the break-out panel: broadcast-style field (striped
//                     turf, yard numbers, translucent drive band), a
//                     bar-ridge probability chart, and a per-drive accordion
//                     play-by-play with result badges.
//
// RN CONSTRAINT: react-native-svg is not installed and must not be added
// (native module — breaks OTA + the in-flight iOS resubmission). Everything
// below is plain View/Text/Image. Two structural deviations from the SVG
// original, both plain-Text/View techniques:
//   - the field is laid out with percentage left/width/top/height positions
//     (a flat 0-120 unit coordinate space, same as web's viewBox) instead of
//     an SVG viewBox; the possession ball's circular puck still needs real
//     pixel dimensions to stay square, so its container is measured once via
//     onLayout and the puck is sized off the measured height.
//   - the SVG polygon chevron becomes a Unicode triangle glyph ('▶' /
//     '◀') rendered as Text — still no SVG, still a "small white
//     triangle chevron" per the spec, just simpler/more robust in RN.
//   - the probability chart has no path-drawing primitive available, so it
//     renders as a bar-ridge (one thin bar per point, split at the 50%
//     midline) instead of a stepped line/area — same series, same split-color
//     read, different mark.
//
// Field geometry (shared): ESPN yard lines are absolute 0-100 with the HOME
// goal line at 0. Home renders on the RIGHT (TV convention), so in the
// 0-120-unit space (10-unit endzones) x = X0 + (100 - yardLine).

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AttackDir, CurrentDrive, GamecastSituation, GameSummaryLite, ProbPoint } from '../gamecast';
import { useGameProbabilities, useGameSummary } from '../gamecast';
import { colors } from '../theme';

const UNIT_W = 120; // total width units, matches web's viewBox
const X0 = 10; // endzone width in units
const YARD_MARKS = [10, 20, 30, 40, 50, 60, 70, 80, 90];
const STRIPE_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

const xOfYL = (yardLine: number) => X0 + (100 - Math.max(0, Math.min(100, yardLine)));
/** Percentage DimensionValue (RN's style types only accept the literal
 *  `${number}%` pattern, not a general `string` — the explicit return type
 *  keeps this from widening). */
const pct = (units: number): `${number}%` => `${(units / UNIT_W) * 100}%`;

// Turf palette — deliberate literals like team hex: the field must read as
// grass, never re-theme.
const TURF_A = '#2f7d46';
const TURF_B = '#2a7040';
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

/** Measures a field container once laid out, so the ball puck (which must
 *  stay circular) can be sized off the real pixel height. */
function useFieldSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);
  return { ...size, onLayout };
}

/* --------------------------- shared field surface -------------------------- */

function FieldBackground({
  bits,
  redZoneDir,
  showNumbers = false,
  showAbbrevs = false,
}: {
  bits: TeamBits;
  redZoneDir?: AttackDir | null;
  showNumbers?: boolean;
  showAbbrevs?: boolean;
}) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.stripesRow, { left: pct(X0), right: pct(X0) }]}>
        {STRIPE_INDEXES.map((i) => (
          <View key={i} style={{ flex: 1, backgroundColor: i % 2 === 0 ? TURF_A : TURF_B }} />
        ))}
      </View>
      {redZoneDir != null && (
        <View
          style={[
            styles.redZoneTint,
            { left: pct(redZoneDir === -1 ? xOfYL(20) : xOfYL(100)), width: pct(20) },
          ]}
        />
      )}
      {YARD_MARKS.map((v) => (
        <View key={v} style={[styles.vLine, { left: pct(xOfYL(v)), backgroundColor: 'rgba(255,255,255,0.75)' }]} />
      ))}
      <View style={[styles.endzone, { left: 0, width: pct(X0), backgroundColor: bits.awayColor ?? '#444' }]} />
      <View style={[styles.endzone, { right: 0, width: pct(X0), backgroundColor: bits.homeColor ?? '#444' }]} />
      {showNumbers &&
        YARD_MARKS.map((v) => (
          <Text key={`n${v}`} style={[styles.yardNumber, { left: pct(xOfYL(v)) }]}>
            {v <= 50 ? v : 100 - v}
          </Text>
        ))}
      {showAbbrevs && (
        <>
          <View style={[styles.endzoneAbbrevWrap, { left: 0, width: pct(X0) }]}>
            <Text style={[styles.endzoneAbbrevText, styles.endzoneAbbrevAway]} numberOfLines={1}>
              {(bits.awayAbbrev ?? '').slice(0, 5)}
            </Text>
          </View>
          <View style={[styles.endzoneAbbrevWrap, { right: 0, width: pct(X0) }]}>
            <Text style={[styles.endzoneAbbrevText, styles.endzoneAbbrevHome]} numberOfLines={1}>
              {(bits.homeAbbrev ?? '').slice(0, 5)}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

function BallMarker({
  leftPct,
  color,
  dir,
  logo,
  size,
}: {
  leftPct: `${number}%`;
  color: string;
  dir?: AttackDir | null;
  /** Possessing team's logo — rendered on a white puck at the ball spot;
   *  falls back to the team-color dot when the logo is missing. */
  logo?: string;
  size: number;
}) {
  if (size <= 0) return null;
  const chevronSide = dir === -1 ? { left: -size * 0.55 } : { right: -size * 0.55 };
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: leftPct,
        top: '50%',
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {dir != null && (
        <Text style={[styles.chevron, { fontSize: size * 0.55 }, chevronSide]}>
          {dir === -1 ? '▶' : '◀'}
        </Text>
      )}
      {logo ? (
        <View style={[styles.ballPuck, { width: size, height: size, borderRadius: size / 2 }]}>
          <Image source={{ uri: logo }} style={{ width: size * 0.9, height: size * 0.9 }} resizeMode="contain" />
        </View>
      ) : (
        <View
          style={[
            styles.ballDot,
            { width: size * 0.6, height: size * 0.6, borderRadius: (size * 0.6) / 2, backgroundColor: color },
          ]}
        />
      )}
    </View>
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
  const sit = situation;
  const { height, onLayout } = useFieldSize();
  const possHome = sit.possessionId != null && sit.possessionId === bits.homeId;
  const possColor = (possHome ? bits.homeColor : bits.awayColor) ?? colors.text;
  const possAbbrev = possHome ? bits.homeAbbrev : bits.awayAbbrev;
  const possLogo = possHome ? bits.homeLogo : bits.awayLogo;
  const fd = firstDownYL(sit, sit.attackDir);
  const ballSize = height * 0.5; // matches web's size=7 of h=14

  return (
    <View style={styles.fieldStripWrap}>
      <View
        style={[styles.fieldSurface, { aspectRatio: UNIT_W / 14 }, condensed && styles.fieldSurfaceCondensed]}
        onLayout={onLayout}
        accessibilityLabel={`${possAbbrev ?? 'Offense'} ball, ${sit.downDistanceText ?? ''}`}
      >
        <FieldBackground bits={bits} redZoneDir={sit.isRedZone ? sit.attackDir : null} />
        {fd !== undefined && (
          <View style={[styles.vLine, { left: pct(xOfYL(fd)), width: 2, backgroundColor: FIRST_DOWN_YELLOW }]} />
        )}
        {sit.yardLine != null && (
          <BallMarker
            leftPct={pct(xOfYL(sit.yardLine))}
            color={possColor}
            dir={sit.attackDir}
            logo={possLogo}
            size={ballSize}
          />
        )}
      </View>
      <View style={styles.fieldStripMeta}>
        <Text style={[styles.fieldStripPoss, { color: possColor }]} numberOfLines={1}>
          {possAbbrev ? `${possAbbrev} ball` : ''}
        </Text>
        <Text style={styles.fieldStripDD} numberOfLines={1}>
          {sit.downDistanceText ?? ''}
        </Text>
      </View>
    </View>
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
  const { height, onLayout } = useFieldSize();
  const dir = drive?.attackDir ?? situation?.attackDir ?? undefined;
  const possId = drive?.teamId ?? situation?.possessionId ?? undefined;
  const possHome = possId != null && possId === bits.homeId;
  const possColor = (possHome ? bits.homeColor : bits.awayColor) ?? '#fff';
  const possLogo = drive?.teamLogo ?? (possHome ? bits.homeLogo : bits.awayLogo);
  const ballYL = situation?.yardLine ?? drive?.ballYL;
  const fd = firstDownYL(situation, dir);
  const ballSize = height * (8.5 / 30); // matches web's size=8.5 of h=30

  // The drive band runs from where the possession started to the ball. Use
  // the first scrimmage play (skip the kickoff, whose start is the kicker's
  // spot on the other side of the field).
  const scrim = (drive?.plays ?? []).filter(
    (p) => p.startYL !== undefined && p.typeAbbrev !== 'K' && p.typeAbbrev !== 'EP',
  );
  const bandFrom = scrim.length ? scrim[0].startYL : undefined;
  const bandTo = ballYL ?? undefined;

  return (
    <View style={[styles.driveFieldSurface, { aspectRatio: UNIT_W / 30 }]} onLayout={onLayout}>
      <FieldBackground bits={bits} showNumbers showAbbrevs redZoneDir={situation?.isRedZone ? dir ?? null : null} />
      {bandFrom !== undefined && bandTo !== undefined && bandFrom !== bandTo && (
        <View
          style={[
            styles.driveBand,
            {
              left: pct(Math.min(xOfYL(bandFrom), xOfYL(bandTo))),
              width: pct(Math.abs(xOfYL(bandFrom) - xOfYL(bandTo))),
              backgroundColor: possColor,
            },
          ]}
        />
      )}
      {bandFrom !== undefined && (
        <View style={[styles.vLine, { left: pct(xOfYL(bandFrom)), backgroundColor: 'rgba(255,255,255,0.75)' }]} />
      )}
      {fd !== undefined && (
        <View style={[styles.vLine, { left: pct(xOfYL(fd)), width: 2, backgroundColor: FIRST_DOWN_YELLOW }]} />
      )}
      {ballYL != null && (
        <BallMarker leftPct={pct(xOfYL(ballYL))} color={possColor} dir={dir ?? null} logo={possLogo} size={ballSize} />
      )}
    </View>
  );
}

/* -------------------------------- ProbChart ------------------------------- */

type ProbMode = 'win' | 'cover' | 'over';

// Flat percentage coordinate space over a fixed-height plot (no SVG viewBox,
// no onLayout needed — a fixed pixel height plus percentage children resolve
// cleanly in RN's layout engine).
const PAD_TOP_PCT = 6;
const PAD_BOTTOM_PCT = 20;
const PLOT_LEFT_PCT = 13;
const PLOT_RIGHT_PCT = 97;
const MID_PCT = (PAD_TOP_PCT + (100 - PAD_BOTTOM_PCT)) / 2;

const xPct = (i: number, n: number) =>
  n <= 1 ? PLOT_LEFT_PCT : PLOT_LEFT_PCT + (i / (n - 1)) * (PLOT_RIGHT_PCT - PLOT_LEFT_PCT);
const yPct = (v: number) =>
  PAD_TOP_PCT + (1 - Math.max(0, Math.min(100, v)) / 100) * (100 - PAD_BOTTOM_PCT - PAD_TOP_PCT);

function ProbChart({
  points,
  summary,
  bits,
}: {
  points: ProbPoint[];
  summary: GameSummaryLite | null;
  bits: TeamBits;
}) {
  const [mode, setMode] = useState<ProbMode>('win');
  const hasCover = points.some((p) => p.coverHome !== undefined);
  const hasOver = points.some((p) => p.overPct !== undefined);
  const effMode: ProbMode = mode === 'cover' && !hasCover ? 'win' : mode === 'over' && !hasOver ? 'win' : mode;

  const n = points.length;
  const barWidthPct = (PLOT_RIGHT_PCT - PLOT_LEFT_PCT) / Math.max(n, 1);

  const bars = useMemo(() => {
    const out: { i: number; left: number; top: number; height: number; home: boolean }[] = [];
    points.forEach((p, i) => {
      const v = effMode === 'win' ? p.homeWin : effMode === 'cover' ? p.coverHome : p.overPct;
      if (v === undefined) return;
      const y = yPct(v);
      const top = v >= 50 ? y : MID_PCT;
      const height = Math.abs(y - MID_PCT);
      out.push({ i, left: xPct(i, n), top, height, home: v >= 50 });
    });
    return out;
  }, [points, effMode, n]);

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
      segs.push({ x: xPct(mid, n), label: names[s] });
    }
    return { boundaryX: bounds.map((b) => xPct(b, n)), segments: segs };
  }, [points, n]);

  const last = points[points.length - 1];
  const homeColor = bits.homeColor ?? colors.navy;
  const awayColor = bits.awayColor ?? colors.textDim;
  const overColor = colors.navyLight;

  let leaderLogo: string | undefined;
  let readout = '';
  let caption = 'WIN PROBABILITY';
  if (last) {
    if (effMode === 'win') {
      const homeUp = last.homeWin >= 50;
      leaderLogo = homeUp ? bits.homeLogo : bits.awayLogo;
      readout = `${(homeUp ? bits.homeAbbrev : bits.awayAbbrev) ?? ''} ${(homeUp ? last.homeWin : 100 - last.homeWin).toFixed(1)}%`;
    } else if (effMode === 'cover' && last.coverHome !== undefined) {
      caption = `COVER PROBABILITY${summary?.pickDetails ? ` · ${summary.pickDetails}` : ''}`;
      const homeUp = last.coverHome >= 50;
      leaderLogo = homeUp ? bits.homeLogo : bits.awayLogo;
      readout = `${(homeUp ? bits.homeAbbrev : bits.awayAbbrev) ?? ''} ${(homeUp ? last.coverHome : 100 - last.coverHome).toFixed(1)}%`;
    } else if (effMode === 'over' && last.overPct !== undefined) {
      caption = `OVER${summary?.overUnder !== undefined ? ` ${summary.overUnder}` : ''} PROBABILITY`;
      readout = `${last.overPct.toFixed(1)}%`;
    }
  }

  return (
    <View style={styles.probChart}>
      <View style={styles.probHeader}>
        <Text style={styles.probCaption}>{caption}</Text>
        <View style={styles.probReadout}>
          {leaderLogo && <Image source={{ uri: leaderLogo }} style={styles.probReadoutLogo} resizeMode="contain" />}
          <Text style={styles.probReadoutText}>{readout}</Text>
        </View>
        <View style={styles.probToggle}>
          <Pressable
            style={[styles.probToggleBtn, effMode === 'win' && styles.probToggleBtnOn]}
            onPress={() => setMode('win')}
          >
            <Text style={[styles.probToggleText, effMode === 'win' && styles.probToggleTextOn]}>Win %</Text>
          </Pressable>
          {hasCover && (
            <Pressable
              style={[styles.probToggleBtn, effMode === 'cover' && styles.probToggleBtnOn]}
              onPress={() => setMode('cover')}
            >
              <Text style={[styles.probToggleText, effMode === 'cover' && styles.probToggleTextOn]}>Cover %</Text>
            </Pressable>
          )}
          {hasOver && (
            <Pressable
              style={[styles.probToggleBtn, effMode === 'over' && styles.probToggleBtnOn]}
              onPress={() => setMode('over')}
            >
              <Text style={[styles.probToggleText, effMode === 'over' && styles.probToggleTextOn]}>Over %</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View style={styles.probPlot}>
        {effMode !== 'over' && bits.homeLogo && (
          <Image
            source={{ uri: bits.homeLogo }}
            style={[styles.probPlotLogo, { top: `${PAD_TOP_PCT}%` }]}
            resizeMode="contain"
          />
        )}
        {effMode !== 'over' && bits.awayLogo && (
          <Image
            source={{ uri: bits.awayLogo }}
            style={[styles.probPlotLogo, { top: `${100 - PAD_BOTTOM_PCT}%`, marginTop: -20 }]}
            resizeMode="contain"
          />
        )}

        <View
          style={[
            styles.probMidline,
            { top: `${MID_PCT}%`, left: `${PLOT_LEFT_PCT}%`, right: `${100 - PLOT_RIGHT_PCT}%` },
          ]}
        />
        {boundaryX.map((x, i) => (
          <View
            key={i}
            style={[styles.probBoundary, { left: `${x}%`, top: `${PAD_TOP_PCT}%`, bottom: `${PAD_BOTTOM_PCT}%` }]}
          />
        ))}

        {bars.map((b) => (
          <View
            key={b.i}
            style={[
              styles.probBar,
              {
                left: `${b.left}%`,
                width: `${barWidthPct}%`,
                top: `${b.top}%`,
                height: `${b.height}%`,
                backgroundColor: effMode === 'over' ? overColor : b.home ? homeColor : awayColor,
              },
            ]}
          />
        ))}

        <Text style={[styles.probYLabel, { top: `${PAD_TOP_PCT}%` }]}>100%</Text>
        <Text style={[styles.probYLabel, { top: `${MID_PCT}%` }]}>50%</Text>
        <Text style={[styles.probYLabel, { top: `${100 - PAD_BOTTOM_PCT}%` }]}>100%</Text>

        {segments.map((s, i) => (
          <Text key={i} style={[styles.probSegLabel, { left: `${s.x}%`, top: `${100 - PAD_BOTTOM_PCT + 4}%` }]}>
            {s.label}
          </Text>
        ))}
      </View>
    </View>
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

function driveKey(d: CurrentDrive, i: number): string {
  return d.plays[0]?.id || String(i);
}

function DriveLog({ drives, bits, isLive }: { drives: CurrentDrive[]; bits: TeamBits; isLive: boolean }) {
  const ordered = useMemo(() => [...drives].reverse(), [drives]); // newest first
  const [expanded, setExpanded] = useState<Set<string>>(() => (ordered[0] ? new Set([driveKey(ordered[0], 0)]) : new Set()));

  // Keep the newest drive open by default as new drives arrive, without
  // clobbering picks the user made on other rows.
  const newestKey = ordered[0] ? driveKey(ordered[0], 0) : null;
  useEffect(() => {
    if (!newestKey) return;
    setExpanded((prev) => (prev.has(newestKey) ? prev : new Set(prev).add(newestKey)));
  }, [newestKey]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <View style={styles.driveLog}>
      {ordered.map((d, i) => {
        const key = driveKey(d, i);
        const isOpen = expanded.has(key);
        const possHome = d.teamId != null && d.teamId === bits.homeId;
        const logo = d.teamLogo ?? (possHome ? bits.homeLogo : bits.awayLogo);
        const live = isLive && i === 0 && !d.result;
        const tone = resultTone(d.result, d.isScore);
        const label = live ? 'LIVE DRIVE' : (d.result ?? '—').toUpperCase();
        const badgeColor = live || tone === 'turnover' ? colors.red : tone === 'scoring' ? colors.green : colors.textDim;
        return (
          <View key={key}>
            <Pressable
              style={[styles.driveSummary, i === 0 ? styles.driveSummaryFirst : styles.driveSummaryBorder]}
              onPress={() => toggle(key)}
            >
              {logo ? (
                <Image source={{ uri: logo }} style={styles.driveLogo} resizeMode="contain" />
              ) : (
                <View
                  style={[
                    styles.driveLogo,
                    styles.driveLogoFallback,
                    { backgroundColor: (possHome ? bits.homeColor : bits.awayColor) ?? colors.bg },
                  ]}
                />
              )}
              <Text style={[styles.driveBadge, { color: badgeColor }]}>{label}</Text>
              <Text style={styles.driveDesc} numberOfLines={1}>
                {d.description ?? ''}
              </Text>
              {d.scoreHome !== undefined && d.scoreAway !== undefined && (
                <Text style={styles.driveScore}>
                  {bits.awayAbbrev} {d.scoreAway}–{d.scoreHome} {bits.homeAbbrev}
                </Text>
              )}
            </Pressable>
            {isOpen && (
              <View>
                {[...d.plays].reverse().map((p, j) => (
                  <View key={p.id || j} style={[styles.playRow, p.scoring && styles.playRowScoring]}>
                    {p.startDD && <Text style={styles.playDD}>{p.startDD}</Text>}
                    <Text style={styles.playText}>{p.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------ LiveGamePanel ----------------------------- */

export function LiveGamePanel({
  eventId,
  isLive,
  situation,
  bits,
}: {
  eventId: string;
  isLive: boolean;
  situation?: GamecastSituation;
  bits: TeamBits;
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
    <View style={styles.panel}>
      {isLive && (drive || situation) && (
        <View style={styles.driveFieldWrap}>
          <DriveField drive={drive} situation={situation} bits={bits} />
          <View style={styles.driveFieldMeta}>
            {possLogo && <Image source={{ uri: possLogo }} style={styles.driveFieldMetaLogo} resizeMode="contain" />}
            <Text style={styles.driveFieldTeam}>{drive?.teamAbbrev ? `${drive.teamAbbrev} drive` : ''}</Text>
            {drive?.description && (
              <Text style={styles.driveFieldDesc} numberOfLines={1}>
                {' '}
                · {drive.description}
              </Text>
            )}
            <Text style={styles.driveFieldDD}>{situation?.downDistanceText ?? ''}</Text>
          </View>
        </View>
      )}

      {probs && probs.length > 0 && <ProbChart points={probs} summary={summary} bits={bits} />}

      {drives.length > 0 && <DriveLog drives={drives} bits={bits} isLive={isLive} />}

      {loading && <Text style={styles.note}>Loading live feed…</Text>}
      {nothing && (
        <Text style={styles.note}>
          ESPN provides score-only coverage for this game (no play-by-play or probability feed).
        </Text>
      )}
    </View>
  );
}

/* ---------------------------------- styles --------------------------------- */

const styles = StyleSheet.create({
  // field surfaces (shared background elements)
  stripesRow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  redZoneTint: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: '#dc2626',
    opacity: 0.16,
  },
  endzone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  yardNumber: {
    position: 'absolute',
    bottom: 2,
    width: 20,
    marginLeft: -10,
    textAlign: 'center',
    fontSize: 8,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.4,
  },
  endzoneAbbrevWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endzoneAbbrevText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.8,
  },
  endzoneAbbrevAway: {
    transform: [{ rotate: '-90deg' }],
  },
  endzoneAbbrevHome: {
    transform: [{ rotate: '90deg' }],
  },
  chevron: {
    position: 'absolute',
    color: 'rgba(255,255,255,0.9)',
  },
  ballPuck: {
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballDot: {
    borderWidth: 1.5,
    borderColor: '#fff',
  },

  // FieldStrip
  fieldStripWrap: {
    gap: 2,
  },
  fieldSurface: {
    width: '100%',
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: TURF_A,
    position: 'relative',
  },
  fieldSurfaceCondensed: {
    borderRadius: 3,
  },
  fieldStripMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  fieldStripPoss: {
    fontSize: 10,
    fontWeight: '700',
  },
  fieldStripDD: {
    fontSize: 10,
    color: colors.textDim,
  },

  // DriveField
  driveFieldSurface: {
    width: '100%',
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: TURF_A,
    position: 'relative',
  },
  driveBand: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    opacity: 0.32,
  },

  // LiveGamePanel
  panel: {
    gap: 14,
  },
  driveFieldWrap: {
    gap: 4,
  },
  driveFieldMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  driveFieldMetaLogo: {
    width: 15,
    height: 15,
    marginRight: 6,
  },
  driveFieldTeam: {
    fontWeight: '700',
    color: colors.text,
    fontSize: 12,
  },
  driveFieldDesc: {
    color: colors.textDim,
    fontSize: 11,
    flexShrink: 1,
  },
  driveFieldDD: {
    marginLeft: 'auto',
    fontWeight: '700',
    color: colors.text,
    fontSize: 11,
  },
  note: {
    fontSize: 12,
    color: colors.textDim,
  },

  // ProbChart
  probChart: {
    gap: 6,
  },
  probHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  probCaption: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: colors.textDim,
    textTransform: 'uppercase',
  },
  probReadout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  probReadoutLogo: {
    width: 16,
    height: 16,
  },
  probReadoutText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  probToggle: {
    marginLeft: 'auto',
    flexDirection: 'row',
    gap: 6,
  },
  probToggleBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    backgroundColor: colors.card,
  },
  probToggleBtnOn: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  probToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textDim,
  },
  probToggleTextOn: {
    color: '#fff',
  },
  probPlot: {
    height: 200,
    width: '100%',
    position: 'relative',
  },
  probPlotLogo: {
    position: 'absolute',
    left: '2%',
    width: 16,
    height: 16,
    opacity: 0.95,
    zIndex: 1,
  },
  probMidline: {
    position: 'absolute',
    height: 1,
    backgroundColor: colors.border,
  },
  probBoundary: {
    position: 'absolute',
    width: 1,
    backgroundColor: colors.border,
  },
  probBar: {
    position: 'absolute',
    minWidth: 1,
    borderRadius: 1,
  },
  probYLabel: {
    position: 'absolute',
    left: 0,
    width: `${PLOT_LEFT_PCT - 2}%`,
    marginTop: -6,
    textAlign: 'right',
    fontSize: 9,
    color: colors.textDim,
  },
  probSegLabel: {
    position: 'absolute',
    width: 34,
    marginLeft: -17,
    textAlign: 'center',
    fontSize: 10,
    color: colors.textDim,
  },

  // DriveLog
  driveLog: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  driveSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  driveSummaryBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  driveSummaryFirst: {
    backgroundColor: colors.bg,
  },
  driveLogo: {
    width: 18,
    height: 18,
  },
  driveLogoFallback: {
    borderRadius: 5,
  },
  driveBadge: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  driveDesc: {
    flex: 1,
    fontSize: 11,
    color: colors.textDim,
  },
  driveScore: {
    marginLeft: 'auto',
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
  },
  playRow: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    paddingLeft: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  playRowScoring: {
    backgroundColor: colors.greenSoft,
    borderLeftColor: colors.green,
  },
  playDD: {
    fontWeight: '700',
    fontSize: 11.5,
    color: colors.text,
  },
  playText: {
    color: colors.textDim,
    fontSize: 12,
  },
});
