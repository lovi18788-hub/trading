import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ══════════════════════════════════════════════════════════════
//  THEME
// ══════════════════════════════════════════════════════════════
const DARK = {
  bg: '#0d1117', bg2: '#161b22', bg3: '#21262d', bg4: '#30363d',
  border: '#21262d', text: '#e6edf3', dim: '#7d8590', dimmer: '#484f58',
  green: '#26a69a', greenBright: '#4caf93', red: '#ef5350', redBright: '#f44336',
  blue: '#388bfd', blueDim: '#1f6feb', yellow: '#e3b341', purple: '#bc8cff',
  teal: '#39d353', orange: '#f0883e',
};
const LIGHT = {
  bg: '#ffffff', bg2: '#f6f8fa', bg3: '#eaeef2', bg4: '#d0d7de',
  border: '#d0d7de', text: '#24292f', dim: '#57606a', dimmer: '#8c959f',
  green: '#1a9e96', greenBright: '#0d7a73', red: '#cf2626', redBright: '#b91c1c',
  blue: '#0969da', blueDim: '#0550ae', yellow: '#9a6700', purple: '#6639ba',
  teal: '#116329', orange: '#953800',
};

// ══════════════════════════════════════════════════════════════
//  DATA GENERATION (realistic price simulation)
// ══════════════════════════════════════════════════════════════
function genOHLCV(n = 900, p0 = 67_234) {
  const d = []; let p = p0;
  // Add trend bias with mean reversion
  let trend = 0;
  const t0 = Date.now() - n * 3_600_000;
  for (let i = 0; i < n; i++) {
    trend = trend * 0.95 + (Math.random() - 0.5) * 0.1;
    const σ = p * (0.004 + Math.random() * 0.012);
    const o = p;
    const c = o + (trend + (Math.random() - 0.5)) * σ;
    const wicky = Math.random() > 0.7;
    const h = Math.max(o, c) + (wicky ? Math.random() * σ * 1.2 : Math.random() * σ * 0.3);
    const l = Math.min(o, c) - (wicky ? Math.random() * σ * 1.2 : Math.random() * σ * 0.3);
    const spike = Math.random() > 0.96;
    const v = (50 + Math.random() * 300) * (spike ? 3 + Math.random() * 4 : 1);
    d.push({ t: t0 + i * 3_600_000, o, h, l, c, v });
    p = c;
  }
  return d;
}

// ══════════════════════════════════════════════════════════════
//  INDICATORS
// ══════════════════════════════════════════════════════════════
const calcSMA = (data, n) =>
  data.map((_, i) => i < n - 1 ? null : data.slice(i - n + 1, i + 1).reduce((s, x) => s + x.c, 0) / n);

const calcEMA = (data, n) => {
  const k = 2 / (n + 1), e = [data[0].c];
  for (let i = 1; i < data.length; i++) e.push(data[i].c * k + e[i - 1] * (1 - k));
  return e;
};

const calcBB = (data, n = 20, m = 2) => {
  const s = calcSMA(data, n);
  return data.map((_, i) => {
    if (i < n - 1) return null;
    const sl = data.slice(i - n + 1, i + 1);
    const std = Math.sqrt(sl.reduce((a, x) => a + (x.c - s[i]) ** 2, 0) / n);
    return { u: s[i] + m * std, mid: s[i], l: s[i] - m * std };
  });
};

const calcRSI = (data, n = 14) => {
  let ag = 0, al = 0;
  return data.map((x, i) => {
    if (i === 0) return null;
    const df = x.c - data[i - 1].c;
    if (i < n) { ag += Math.max(0, df) / n; al += Math.max(0, -df) / n; return null; }
    if (i === n) { ag += Math.max(0, df) / n; al += Math.max(0, -df) / n; }
    else { ag = (ag * (n - 1) + Math.max(0, df)) / n; al = (al * (n - 1) + Math.max(0, -df)) / n; }
    return 100 - 100 / (1 + ag / (al || 0.001));
  });
};

const calcStoch = (data, n = 14) =>
  data.map((_, i) => {
    if (i < n - 1) return null;
    const sl = data.slice(i - n + 1, i + 1);
    const hi = Math.max(...sl.map(x => x.h)), lo = Math.min(...sl.map(x => x.l));
    return hi === lo ? 50 : ((data[i].c - lo) / (hi - lo)) * 100;
  });

const calcMACD = (data, f = 12, s = 26, sg = 9) => {
  const ef = calcEMA(data, f), es = calcEMA(data, s);
  const ml = ef.map((v, i) => v - es[i]);
  const k = 2 / (sg + 1); const sl = [ml[0]];
  for (let i = 1; i < ml.length; i++) sl.push(ml[i] * k + sl[i - 1] * (1 - k));
  return { ml, sl, hist: ml.map((v, i) => v - sl[i]) };
};

const calcVWAP = (data) => {
  let cp = 0, cv = 0;
  return data.map(d => { const tp = (d.h + d.l + d.c) / 3; cp += tp * d.v; cv += d.v; return cp / cv; });
};

// ══════════════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════════════
const fmtP = p => p >= 10000 ? p.toFixed(2) : p >= 100 ? p.toFixed(2) : p.toFixed(4);
const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toFixed(0);
const fmtT = t => {
  const d = new Date(t);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
};
const fmtTShort = t => {
  const d = new Date(t);
  const now = Date.now();
  if (now - t < 86400000 * 30) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function niceScale(lo, hi, n = 6) {
  if (lo === hi) return [lo];
  const range = hi - lo, raw = range / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1, 2, 2.5, 5, 10].map(f => f * mag).find(f => range / f <= n * 1.5) || mag;
  const start = Math.ceil(lo / nice) * nice;
  const res = [];
  for (let v = start; v <= hi + nice * 0.001; v += nice) { res.push(+v.toPrecision(8)); if (res.length > 12) break; }
  return res;
}

const linScale = ([d0, d1], [r0, r1]) => { const sp = d1 - d0 || 1; return v => r0 + ((v - d0) / sp) * (r1 - r0); };

function buildPath(data, getVal, spacing, scale) {
  let path = '', on = false;
  data.forEach((d, i) => {
    const v = getVal(d);
    if (v == null || isNaN(v)) { on = false; return; }
    const x = i * spacing + spacing / 2, y = scale(v);
    path += `${on ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `;
    on = true;
  });
  return path.trim();
}

// ══════════════════════════════════════════════════════════════
//  SVG CHART COMPONENTS
// ══════════════════════════════════════════════════════════════

function Candles({ data, spacing, cw, yScale, C }) {
  return (
    <g>
      {data.map((d, i) => {
        const x = i * spacing + spacing / 2;
        const bull = d.c >= d.o;
        const col = bull ? C.green : C.red;
        const by = yScale(Math.max(d.o, d.c));
        const bh = Math.max(1, yScale(Math.min(d.o, d.c)) - by);
        return (
          <g key={d.t}>
            <line x1={x} y1={yScale(d.h)} x2={x} y2={yScale(d.l)} stroke={col} strokeWidth={Math.max(0.5, cw * 0.12)} />
            <rect x={x - cw / 2} y={by} width={cw} height={bh} fill={bull ? 'none' : col} stroke={col} strokeWidth="0.8" />
            {bull && <rect x={x - cw / 2} y={by} width={cw} height={bh} fill={col} opacity="0.15" />}
          </g>
        );
      })}
    </g>
  );
}

function HeikinAshi({ data, spacing, cw, yScale, C }) {
  let haO = data[0].o;
  const haData = data.map(d => {
    const haC = (d.o + d.h + d.l + d.c) / 4;
    const newHaO = (haO + (haO + (data[data.indexOf(d) > 0 ? data.indexOf(d) - 1 : 0].o + data[data.indexOf(d) > 0 ? data.indexOf(d) - 1 : 0].c) / 2)) / 2;
    const haH = Math.max(d.h, Math.max(newHaO, haC));
    const haL = Math.min(d.l, Math.min(newHaO, haC));
    haO = newHaO;
    return { ...d, o: newHaO, c: haC, h: haH, l: haL };
  });
  return <Candles data={haData} spacing={spacing} cw={cw} yScale={yScale} C={C} />;
}

function OHLCBars({ data, spacing, yScale, C }) {
  return (
    <g>
      {data.map((d, i) => {
        const x = i * spacing + spacing / 2;
        const col = d.c >= d.o ? C.green : C.red;
        const tick = Math.max(2, spacing * 0.25);
        return (
          <g key={d.t}>
            <line x1={x} y1={yScale(d.h)} x2={x} y2={yScale(d.l)} stroke={col} strokeWidth="1.2" />
            <line x1={x - tick} y1={yScale(d.o)} x2={x} y2={yScale(d.o)} stroke={col} strokeWidth="1.2" />
            <line x1={x} y1={yScale(d.c)} x2={x + tick} y2={yScale(d.c)} stroke={col} strokeWidth="1.2" />
          </g>
        );
      })}
    </g>
  );
}

function BBOverlay({ data, bbVals, spacing, yScale, C }) {
  const up = buildPath(data, d => bbVals[d.idx]?.u, spacing, yScale);
  const lo = buildPath(data, d => bbVals[d.idx]?.l, spacing, yScale);
  const md = buildPath(data, d => bbVals[d.idx]?.mid, spacing, yScale);

  const fillPts = data.map((d, i) => bbVals[d.idx] ? `${i * spacing + spacing / 2},${yScale(bbVals[d.idx].u).toFixed(1)}` : null).filter(Boolean);
  const fillPtsLo = data.map((d, i) => bbVals[d.idx] ? `${i * spacing + spacing / 2},${yScale(bbVals[d.idx].l).toFixed(1)}` : null).filter(Boolean).reverse();
  const fillPath = fillPts.length ? `M${fillPts.join('L')}L${fillPtsLo.join('L')}Z` : '';

  return (
    <g opacity="0.8">
      {fillPath && <path d={fillPath} fill={C.blue} fillOpacity="0.04" />}
      <path d={up} fill="none" stroke={C.blue} strokeWidth="0.7" opacity="0.6" />
      <path d={lo} fill="none" stroke={C.blue} strokeWidth="0.7" opacity="0.6" />
      <path d={md} fill="none" stroke={C.yellow} strokeWidth="0.7" opacity="0.5" strokeDasharray="3,2" />
    </g>
  );
}

function IndLine({ data, vals, spacing, yScale, color, width = 1.2, dash = '' }) {
  const path = buildPath(data, d => vals[d.idx], spacing, yScale);
  return <path d={path} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash} />;
}

function VolumePanel({ data, spacing, cw, volMax, top, height, C }) {
  const s = v => top + height - (v / volMax) * height * 0.92;
  return (
    <g>
      <text x={3} y={top + 11} fill={C.dimmer} fontSize={8} fontFamily="monospace">VOL</text>
      {data.map((d, i) => {
        const x = i * spacing + spacing / 2;
        const h = Math.max(1, (d.v / volMax) * height * 0.92);
        return (
          <rect key={d.t} x={x - cw / 2} y={s(d.v)} width={cw} height={h}
            fill={d.c >= d.o ? C.green : C.red} opacity="0.45" />
        );
      })}
    </g>
  );
}

function RSIPanel({ data, vals, spacing, top, height, C }) {
  const yS = linScale([0, 100], [top + height - 3, top + 3]);
  const path = buildPath(data, d => vals[d.idx], spacing, yS);
  const last = vals[data[data.length - 1]?.idx];
  const lastColor = last > 70 ? C.red : last < 30 ? C.green : C.purple;
  return (
    <g>
      <text x={3} y={top + 11} fill={C.dimmer} fontSize={8} fontFamily="monospace">RSI(14)</text>
      {[70, 50, 30].map(lv => (
        <g key={lv}>
          <line x1={0} y1={yS(lv)} x2={9999} y2={yS(lv)} stroke={lv === 50 ? C.dimmer : lv === 70 ? C.red : C.green} strokeWidth="0.5" strokeDasharray="3,3" opacity="0.5" />
          <text x={3} y={yS(lv) - 2} fill={C.dimmer} fontSize={7}>{lv}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke={C.purple} strokeWidth="1.2" />
      {last != null && (
        <>
          <line x1={0} y1={yS(last)} x2={9999} y2={yS(last)} stroke={lastColor} strokeWidth="0.4" strokeDasharray="2,4" opacity="0.6" />
          <rect x={-1} y={yS(last) - 8} width={32} height={14} fill={lastColor} rx="2" />
          <text x={15} y={yS(last) + 3} fill="#fff" fontSize={8} textAnchor="middle">{last.toFixed(1)}</text>
        </>
      )}
    </g>
  );
}

function StochPanel({ data, vals, spacing, top, height, C }) {
  const yS = linScale([0, 100], [top + height - 3, top + 3]);
  const path = buildPath(data, d => vals[d.idx], spacing, yS);
  const last = vals[data[data.length - 1]?.idx];
  return (
    <g>
      <text x={3} y={top + 11} fill={C.dimmer} fontSize={8} fontFamily="monospace">STOCH(14)</text>
      {[80, 20].map(lv => (
        <g key={lv}>
          <line x1={0} y1={yS(lv)} x2={9999} y2={yS(lv)} stroke={lv === 80 ? C.red : C.green} strokeWidth="0.5" strokeDasharray="3,3" opacity="0.5" />
        </g>
      ))}
      <path d={path} fill="none" stroke={C.teal} strokeWidth="1.2" />
    </g>
  );
}

function MACDPanel({ data, macdData, spacing, top, height, cw, C }) {
  const { ml, sl, hist } = macdData;
  const vis = data.map(d => hist[d.idx]).filter(v => v != null);
  const ext = vis.length ? Math.max(Math.abs(Math.min(...vis)), Math.abs(Math.max(...vis))) * 1.3 : 1;
  const yS = linScale([-ext, ext], [top + height - 3, top + 3]);
  const zero = yS(0);
  const mlPath = buildPath(data, d => ml[d.idx], spacing, yS);
  const slPath = buildPath(data, d => sl[d.idx], spacing, yS);
  return (
    <g>
      <text x={3} y={top + 11} fill={C.dimmer} fontSize={8} fontFamily="monospace">MACD(12,26,9)</text>
      <line x1={0} y1={zero} x2={9999} y2={zero} stroke={C.dimmer} strokeWidth="0.4" opacity="0.5" />
      {data.map((d, i) => {
        const h = hist[d.idx]; if (h == null) return null;
        const x = i * spacing + spacing / 2;
        const y1 = yS(h), bh = Math.abs(y1 - zero);
        return <rect key={d.t} x={x - cw / 2} y={Math.min(y1, zero)} width={cw} height={Math.max(1, bh)} fill={h >= 0 ? C.green : C.red} opacity="0.5" />;
      })}
      <path d={mlPath} fill="none" stroke={C.blue} strokeWidth="1" />
      <path d={slPath} fill="none" stroke={C.orange} strokeWidth="1" />
    </g>
  );
}

function PriceAxis({ ticks, yScale, chartW, C, currentPrice, W }) {
  return (
    <g>
      <rect x={chartW} y={0} width={W - chartW} height={9999} fill={C.bg2} />
      <line x1={chartW} y1={0} x2={chartW} y2={9999} stroke={C.border} strokeWidth="0.5" />
      {ticks.map(v => (
        <g key={v}>
          <line x1={chartW} y1={yScale(v)} x2={chartW + 3} y2={yScale(v)} stroke={C.dimmer} strokeWidth="0.5" />
          <text x={chartW + 6} y={yScale(v) + 3.5} fill={C.dim} fontSize={9.5} fontFamily="'JetBrains Mono',monospace">{fmtP(v)}</text>
        </g>
      ))}
      {/* Current price marker */}
      {currentPrice && (
        <g>
          <line x1={0} y1={yScale(currentPrice)} x2={chartW} y2={yScale(currentPrice)} stroke={C.blue} strokeWidth="0.5" strokeDasharray="3,3" opacity="0.6" />
          <rect x={chartW} y={yScale(currentPrice) - 9} width={W - chartW} height={18} fill={C.blue} />
          <text x={chartW + 6} y={yScale(currentPrice) + 4} fill="#fff" fontSize={9.5} fontFamily="'JetBrains Mono',monospace">{fmtP(currentPrice)}</text>
        </g>
      )}
    </g>
  );
}

function TimeAxis({ data, spacing, top, C }) {
  const step = Math.max(1, Math.ceil(90 / spacing));
  return (
    <g>
      <line x1={0} y1={top} x2={9999} y2={top} stroke={C.border} strokeWidth="0.5" />
      {data.filter((_, i) => i % step === 0).map((d, _, arr) => {
        const i = data.findIndex(x => x.t === d.t);
        const x = i * spacing + spacing / 2;
        return (
          <g key={d.t}>
            <line x1={x} y1={top} x2={x} y2={top + 4} stroke={C.dimmer} strokeWidth="0.5" />
            <text x={x} y={top + 14} fill={C.dim} fontSize={9} textAnchor="middle" fontFamily="'JetBrains Mono',monospace">
              {fmtTShort(d.t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Crosshair({ cx, cy, d, chartW, yScale, C, W, mainTop, mainBot }) {
  if (!d) return null;
  const priceY = yScale(d.c);
  const bull = d.c >= d.o;
  return (
    <g pointerEvents="none">
      <line x1={0} y1={cy} x2={W} y2={cy} stroke={C.dim} strokeWidth="0.5" strokeDasharray="4,3" opacity="0.7" />
      <line x1={cx} y1={0} x2={cx} y2={9999} stroke={C.dim} strokeWidth="0.5" strokeDasharray="4,3" opacity="0.7" />
      {/* Price tag */}
      <rect x={chartW} y={cy - 9} width={W - chartW} height={18} fill={C.bg4} rx="1" />
      <text x={chartW + 6} y={cy + 3.5} fill={C.text} fontSize={9.5} fontFamily="'JetBrains Mono',monospace">{fmtP(d.c)}</text>
      {/* OHLCV card */}
      <rect x={6} y={mainTop} width={270} height={56} rx="4" fill={C.bg2} opacity="0.96" />
      <rect x={6} y={mainTop} width={270} height={56} rx="4" stroke={C.border} strokeWidth="0.5" fill="none" />
      <text y={mainTop + 18} fontSize={10} fontFamily="'JetBrains Mono',monospace">
        <tspan x={14} fill={C.dimmer}>O </tspan><tspan fill={bull ? C.green : C.red}>{fmtP(d.o)} </tspan>
        <tspan fill={C.dimmer}> H </tspan><tspan fill={C.green}>{fmtP(d.h)} </tspan>
        <tspan fill={C.dimmer}> L </tspan><tspan fill={C.red}>{fmtP(d.l)} </tspan>
        <tspan fill={C.dimmer}> C </tspan><tspan fill={bull ? C.green : C.red}>{fmtP(d.c)}</tspan>
      </text>
      <text x={14} y={mainTop + 34} fontSize={9} fontFamily="'JetBrains Mono',monospace" fill={C.dimmer}>
        Vol <tspan fill={C.dim}>{fmtK(d.v)}</tspan>
        <tspan>  </tspan>
        <tspan fill={C.dimmer}>{fmtT(d.t)}</tspan>
      </text>
      <text x={14} y={mainTop + 48} fontSize={9} fontFamily="'JetBrains Mono',monospace">
        <tspan fill={C.dimmer}>Chg </tspan>
        <tspan fill={bull ? C.green : C.red}>
          {bull ? '+' : ''}{((d.c - d.o) / d.o * 100).toFixed(2)}%
        </tspan>
      </text>
    </g>
  );
}

// ══════════════════════════════════════════════════════════════
//  TOOLBAR
// ══════════════════════════════════════════════════════════════
const SYMBOLS = ['BTCUSD', 'ETHUSD', 'AAPL', 'TSLA', 'SPY', 'NVDA', 'AMZN', 'GOOGL'];
const TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W'];
const CHART_TYPES = [
  { id: 'candle', label: 'Candles', icon: '🕯' },
  { id: 'ha', label: 'Heikin Ashi', icon: '📊' },
  { id: 'ohlc', label: 'OHLC Bars', icon: '⊟' },
  { id: 'line', label: 'Line', icon: '〰' },
  { id: 'area', label: 'Area', icon: '▲' },
];

const ALL_INDS = [
  { id: 'sma20', label: 'SMA 20', group: 'Overlay' },
  { id: 'sma50', label: 'SMA 50', group: 'Overlay' },
  { id: 'ema20', label: 'EMA 20', group: 'Overlay' },
  { id: 'ema50', label: 'EMA 50', group: 'Overlay' },
  { id: 'ema200', label: 'EMA 200', group: 'Overlay' },
  { id: 'bb', label: 'Bollinger Bands', group: 'Overlay' },
  { id: 'vwap', label: 'VWAP', group: 'Overlay' },
  { id: 'volume', label: 'Volume', group: 'Panel' },
  { id: 'rsi', label: 'RSI (14)', group: 'Panel' },
  { id: 'macd', label: 'MACD', group: 'Panel' },
  { id: 'stoch', label: 'Stochastic', group: 'Panel' },
];

function Toolbar({ symbol, setSymbol, tf, setTf, chartType, setChartType, inds, setInds, darkMode, setDarkMode, C, lastPrice, change }) {
  const [showInds, setShowInds] = useState(false);
  const [showChartTypes, setShowChartTypes] = useState(false);
  const [showSymbols, setShowSymbols] = useState(false);
  const bull = change >= 0;

  return (
    <div style={{ background: C.bg2, borderBottom: `1px solid ${C.border}`, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', overflowX: 'auto', position: 'relative', zIndex: 50 }}>
      {/* Symbol */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setShowSymbols(s => !s)} style={{ background: C.bg3, border: `1px solid ${C.border}`, color: C.text, padding: '5px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 5 }}>
          {symbol} <span style={{ fontSize: 9, color: C.dimmer }}>▼</span>
        </button>
        {showSymbols && (
          <div style={{ position: 'absolute', top: '100%', left: 0, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 6, padding: 4, zIndex: 200, width: 130, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', marginTop: 3 }}>
            {SYMBOLS.map(s => (
              <div key={s} onClick={() => { setSymbol(s); setShowSymbols(false); }}
                style={{ padding: '6px 10px', cursor: 'pointer', borderRadius: 4, color: s === symbol ? C.blue : C.text, background: s === symbol ? C.bg3 : 'transparent', fontSize: 12, fontFamily: 'monospace' }}>
                {s}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ width: 1, height: 20, background: C.border }} />

      {/* Timeframes */}
      {TFS.map(t => (
        <button key={t} onClick={() => setTf(t)} style={{ background: t === tf ? C.bg4 : 'transparent', border: 'none', color: t === tf ? C.text : C.dim, padding: '4px 7px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontFamily: 'monospace' }}>
          {t}
        </button>
      ))}

      <div style={{ width: 1, height: 20, background: C.border }} />

      {/* Chart type */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setShowChartTypes(s => !s)} style={{ background: C.bg3, border: `1px solid ${C.border}`, color: C.text, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          {CHART_TYPES.find(x => x.id === chartType)?.icon} <span style={{ fontSize: 9, color: C.dimmer }}>▼</span>
        </button>
        {showChartTypes && (
          <div style={{ position: 'absolute', top: '100%', left: 0, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 6, padding: 4, zIndex: 200, width: 150, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', marginTop: 3 }}>
            {CHART_TYPES.map(ct => (
              <div key={ct.id} onClick={() => { setChartType(ct.id); setShowChartTypes(false); }}
                style={{ padding: '6px 10px', cursor: 'pointer', borderRadius: 4, color: ct.id === chartType ? C.blue : C.text, background: ct.id === chartType ? C.bg3 : 'transparent', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{ct.icon}</span>{ct.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Indicators */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setShowInds(s => !s)} style={{ background: C.bg3, border: `1px solid ${C.border}`, color: C.text, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
          Indicators ▾
        </button>
        {showInds && (
          <div style={{ position: 'absolute', top: '100%', left: 0, background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, zIndex: 200, width: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', marginTop: 3 }}>
            {['Overlay', 'Panel'].map(group => (
              <div key={group}>
                <div style={{ color: C.dimmer, fontSize: 9, fontFamily: 'monospace', padding: '4px 6px 2px', textTransform: 'uppercase', letterSpacing: 1 }}>{group}</div>
                {ALL_INDS.filter(x => x.group === group).map(ind => (
                  <div key={ind.id} onClick={() => setInds(s => ({ ...s, [ind.id]: !s[ind.id] }))}
                    style={{ padding: '5px 8px', cursor: 'pointer', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8, color: C.text, fontSize: 12 }}>
                    <div style={{ width: 13, height: 13, border: `1.5px solid ${C.dim}`, borderRadius: 3, background: inds[ind.id] ? C.blue : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {inds[ind.id] && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>✓</span>}
                    </div>
                    {ind.label}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ width: 1, height: 20, background: C.border }} />

      {/* Drawing tools */}
      {['↗', '—', '╱', '○', '✏'].map((icon, i) => (
        <button key={i} title={['Trend Line', 'Horizontal Line', 'Ray', 'Circle', 'Brush'][i]}
          style={{ background: 'transparent', border: 'none', color: C.dim, padding: '4px 6px', cursor: 'pointer', fontSize: 14, borderRadius: 3 }}>
          {icon}
        </button>
      ))}

      {/* Right side */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ color: C.text, fontSize: 14, fontWeight: 700, fontFamily: 'monospace' }}>{fmtP(lastPrice)}</span>
          <span style={{ color: bull ? C.green : C.red, fontSize: 10, fontFamily: 'monospace' }}>{bull ? '+' : ''}{change.toFixed(2)}%</span>
        </div>
        <button onClick={() => setDarkMode(m => !m)}
          style={{ background: C.bg3, border: `1px solid ${C.border}`, color: C.text, padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}>
          {darkMode ? '☀' : '🌙'}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  REPLAY BAR
// ══════════════════════════════════════════════════════════════
function ReplayBar({ idx, setIdx, playing, setPlaying, speed, setSpeed, total, onStart, onExit, C }) {
  return (
    <div style={{ background: C.bg2, borderTop: `1px solid ${C.border}`, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }}>
      <span style={{ color: C.dimmer, fontSize: 10, fontFamily: 'monospace', fontWeight: 600, letterSpacing: 1 }}>BAR REPLAY</span>
      {idx === null ? (
        <button onClick={onStart} style={{ background: C.blue, border: 'none', color: '#fff', padding: '4px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          ▶ Start Replay
        </button>
      ) : (
        <>
          <button onClick={() => setIdx(i => Math.max(10, i - 50))} style={rBtn(C)} title="Back 50">⏮</button>
          <button onClick={() => setIdx(i => Math.max(1, i - 1))} style={rBtn(C)} title="Back 1">◀</button>
          <button onClick={() => setPlaying(p => !p)} style={{ ...rBtn(C), background: playing ? C.red : C.green, color: '#fff', minWidth: 36 }}>
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={() => setIdx(i => Math.min(total, i + 1))} style={rBtn(C)} title="Fwd 1">▶</button>
          <button onClick={() => setIdx(i => Math.min(total, i + 50))} style={rBtn(C)} title="Fwd 50">⏭</button>
          <div style={{ width: 1, height: 18, background: C.border }} />
          <span style={{ color: C.dimmer, fontSize: 10 }}>Speed:</span>
          {[0.25, 0.5, 1, 2, 5, 10].map(s => (
            <button key={s} onClick={() => setSpeed(s)} style={{ ...rBtn(C), background: speed === s ? C.blue : C.bg3, color: speed === s ? '#fff' : C.dim, padding: '3px 7px' }}>
              {s}×
            </button>
          ))}
          <div style={{ flex: 1, height: 5, background: C.bg3, borderRadius: 3, cursor: 'pointer', margin: '0 6px' }}
            onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setIdx(Math.max(10, Math.round((e.clientX - r.left) / r.width * total))); }}>
            <div style={{ width: `${(idx / total) * 100}%`, height: '100%', background: C.blue, borderRadius: 3, transition: 'width 0.1s' }} />
          </div>
          <span style={{ color: C.dim, fontSize: 10, fontFamily: 'monospace', minWidth: 70 }}>{idx} / {total}</span>
          <button onClick={onExit} style={{ ...rBtn(C), color: C.red }}>✕ Exit</button>
        </>
      )}
    </div>
  );
}
const rBtn = C => ({ background: C.bg3, border: `1px solid ${C.border}`, color: C.text, padding: '3px 9px', borderRadius: 4, cursor: 'pointer', fontSize: 12 });

// ══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════
const W = 1400, H = 700, PR = 75, PB = 26, PT = 6;

export default function TradingViewApp() {
  const allData = useMemo(() => genOHLCV(900), []);
  const [darkMode, setDarkMode] = useState(true);
  const C = darkMode ? DARK : LIGHT;

  const [symbol, setSymbol] = useState('BTCUSD');
  const [tf, setTf] = useState('1h');
  const [chartType, setChartType] = useState('candle');
  const [inds, setInds] = useState({ sma20: false, sma50: false, ema20: false, ema50: true, ema200: false, bb: false, vwap: false, volume: true, rsi: true, macd: false, stoch: false });

  const [view, setView] = useState({ s: 770, e: 900 });
  const [drag, setDrag] = useState(null);
  const [crosshair, setCrosshair] = useState(null);
  const [replayIdx, setReplayIdx] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const svgRef = useRef();
  const replayTimer = useRef();

  // Effective data
  const data = useMemo(() => replayIdx !== null ? allData.slice(0, replayIdx) : allData, [allData, replayIdx]);

  const viewS = Math.max(0, Math.min(view.s, data.length - 5));
  const viewE = Math.min(data.length, Math.max(viewS + 5, view.e));
  const visData = useMemo(() =>
    data.slice(viewS, viewE).map((d, i) => ({ ...d, idx: viewS + i })),
    [data, viewS, viewE]);

  // Panel heights
  const volH = inds.volume ? 70 : 0;
  const rsiH = inds.rsi ? 90 : 0;
  const macdH = inds.macd ? 90 : 0;
  const stochH = inds.stoch ? 90 : 0;
  const mainH = H - PT - PB - volH - rsiH - macdH - stochH;
  const chartW = W - PR;

  const n = Math.max(1, visData.length);
  const spacing = chartW / n;
  const cw = Math.max(0.5, Math.min(22, spacing * 0.72));

  const [priceMin, priceMax] = useMemo(() => {
    if (!visData.length) return [0, 1];
    let lo = Infinity, hi = -Infinity;
    visData.forEach(d => { lo = Math.min(lo, d.l); hi = Math.max(hi, d.h); });
    const pad = (hi - lo) * 0.07;
    return [lo - pad, hi + pad];
  }, [visData]);

  const yScale = linScale([priceMin, priceMax], [PT + mainH, PT]);
  const priceTicks = useMemo(() => niceScale(priceMin, priceMax, 6), [priceMin, priceMax]);
  const volMax = useMemo(() => Math.max(1, ...visData.map(d => d.v)), [visData]);

  // All indicators calculated on full data
  const indCalc = useMemo(() => ({
    sma20: calcSMA(data, 20),
    sma50: calcSMA(data, 50),
    ema20: calcEMA(data, 20),
    ema50: calcEMA(data, 50),
    ema200: calcEMA(data, 200),
    bb: calcBB(data),
    vwap: calcVWAP(data),
    rsi: calcRSI(data),
    stoch: calcStoch(data),
    macd: calcMACD(data),
  }), [data]);

  // Replay logic
  useEffect(() => {
    clearInterval(replayTimer.current);
    if (playing && replayIdx !== null) {
      replayTimer.current = setInterval(() => {
        setReplayIdx(i => {
          if (i >= allData.length) { setPlaying(false); return allData.length; }
          return i + 1;
        });
      }, 350 / speed);
    }
    return () => clearInterval(replayTimer.current);
  }, [playing, speed, allData.length]);

  useEffect(() => {
    if (replayIdx !== null) {
      setView(v => {
        const range = Math.max(10, v.e - v.s);
        return { s: Math.max(0, replayIdx - range), e: replayIdx };
      });
    }
  }, [replayIdx]);

  // Interaction helpers
  const getSVGX = useCallback(e => {
    if (!svgRef.current) return 0;
    const r = svgRef.current.getBoundingClientRect();
    return (e.clientX - r.left) * (W / r.width);
  }, []);

  const getSVGY = useCallback(e => {
    if (!svgRef.current) return 0;
    const r = svgRef.current.getBoundingClientRect();
    return (e.clientY - r.top) * (H / r.height);
  }, []);

  const getDataAt = useCallback(svgX => {
    const i = Math.max(0, Math.min(visData.length - 1, Math.floor(svgX / chartW * visData.length)));
    return visData[i];
  }, [chartW, visData]);

  const onWheel = useCallback(e => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 1.18 : 0.85;
    setView(v => {
      const range = v.e - v.s;
      const mid = Math.round((v.s + v.e) / 2);
      const nr = Math.round(Math.max(8, Math.min(data.length, range * f)));
      return { s: Math.max(0, mid - Math.floor(nr / 2)), e: Math.min(data.length, mid + Math.ceil(nr / 2)) };
    });
  }, [data.length]);

  const onMouseMove = useCallback(e => {
    const sx = getSVGX(e), sy = getSVGY(e);
    if (sx > chartW) { setCrosshair(null); return; }
    if (drag) {
      const dC = Math.round((drag.x - sx) / spacing);
      const range = drag.e - drag.s;
      const ns = Math.max(0, Math.min(data.length - range, drag.s + dC));
      setView({ s: ns, e: ns + range });
    }
    const d = getDataAt(sx);
    if (d) setCrosshair({ x: sx, y: sy, d });
  }, [drag, spacing, data.length, getSVGX, getSVGY, getDataAt, chartW]);

  const onMouseDown = useCallback(e => {
    const sx = getSVGX(e);
    if (sx < chartW) setDrag({ x: sx, s: viewS, e: viewE });
  }, [getSVGX, chartW, viewS, viewE]);

  const onMouseUp = useCallback(() => setDrag(null), []);

  // Line/area paths
  const linePath = useMemo(() => buildPath(visData, d => d.c, spacing, yScale), [visData, spacing, yScale]);
  const areaClose = `${linePath} L${(visData.length - 1) * spacing + spacing / 2},${PT + mainH} L${spacing / 2},${PT + mainH}Z`;

  // Panel tops
  const volTop = PT + mainH;
  const rsiTop = volTop + volH;
  const macdTop = rsiTop + rsiH;
  const stochTop = macdTop + macdH;
  const currentPrice = data[data.length - 1]?.c;
  const firstPrice = data[0]?.c;
  const change = currentPrice && firstPrice ? (currentPrice - firstPrice) / firstPrice * 100 : 0;

  return (
    <div style={{ background: C.bg, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", height: '100vh', display: 'flex', flexDirection: 'column', color: C.text }}>
      <Toolbar symbol={symbol} setSymbol={setSymbol} tf={tf} setTf={setTf}
        chartType={chartType} setChartType={setChartType}
        inds={inds} setInds={setInds}
        darkMode={darkMode} setDarkMode={setDarkMode}
        C={C} lastPrice={currentPrice || 0} change={change} />

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <svg ref={svgRef} width="100%" height="100%"
          viewBox={`0 0 ${W} ${H}`}
          onWheel={onWheel} onMouseMove={onMouseMove}
          onMouseDown={onMouseDown} onMouseUp={onMouseUp}
          onMouseLeave={() => { onMouseUp(); setCrosshair(null); }}
          style={{ display: 'block', cursor: drag ? 'grabbing' : 'crosshair', userSelect: 'none' }}>

          <defs>
            <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.blue} stopOpacity="0.25" />
              <stop offset="100%" stopColor={C.blue} stopOpacity="0.01" />
            </linearGradient>
            <clipPath id="main"><rect x={0} y={PT} width={chartW} height={mainH} /></clipPath>
            <clipPath id="vol"><rect x={0} y={volTop} width={chartW} height={volH} /></clipPath>
            <clipPath id="rsi"><rect x={0} y={rsiTop} width={chartW} height={rsiH} /></clipPath>
            <clipPath id="macd"><rect x={0} y={macdTop} width={chartW} height={macdH} /></clipPath>
            <clipPath id="stoch"><rect x={0} y={stochTop} width={chartW} height={stochH} /></clipPath>
          </defs>

          {/* BG */}
          <rect width={W} height={H} fill={C.bg} />

          {/* Grid lines */}
          {priceTicks.map(v => (
            <line key={v} x1={0} y1={yScale(v)} x2={chartW} y2={yScale(v)} stroke={C.border} strokeWidth="0.4" />
          ))}
          {/* Vertical grid */}
          {visData.filter((_, i) => i % Math.max(1, Math.floor(100 / spacing)) === 0).map((d, _, arr) => {
            const i = visData.findIndex(x => x.t === d.t);
            const x = i * spacing + spacing / 2;
            return <line key={d.t} x1={x} y1={PT} x2={x} y2={PT + mainH} stroke={C.border} strokeWidth="0.4" />;
          })}

          {/* BB overlay */}
          {inds.bb && <g clipPath="url(#main)"><BBOverlay data={visData} bbVals={indCalc.bb} spacing={spacing} yScale={yScale} C={C} /></g>}

          {/* VWAP */}
          {inds.vwap && <g clipPath="url(#main)"><IndLine data={visData} vals={indCalc.vwap} spacing={spacing} yScale={yScale} color={C.teal} width={1.2} dash="6,2" /></g>}

          {/* Main chart */}
          <g clipPath="url(#main)">
            {chartType === 'candle' && <Candles data={visData} spacing={spacing} cw={cw} yScale={yScale} C={C} />}
            {chartType === 'ha' && <HeikinAshi data={visData} spacing={spacing} cw={cw} yScale={yScale} C={C} />}
            {chartType === 'ohlc' && <OHLCBars data={visData} spacing={spacing} yScale={yScale} C={C} />}
            {chartType === 'line' && <path d={linePath} fill="none" stroke={C.blue} strokeWidth="1.5" />}
            {chartType === 'area' && (
              <>
                <path d={areaClose} fill="url(#areaG)" />
                <path d={linePath} fill="none" stroke={C.blue} strokeWidth="1.5" />
              </>
            )}
          </g>

          {/* Overlay indicators */}
          {inds.sma20 && <g clipPath="url(#main)"><IndLine data={visData} vals={indCalc.sma20} spacing={spacing} yScale={yScale} color="#e3b341" /></g>}
          {inds.sma50 && <g clipPath="url(#main)"><IndLine data={visData} vals={indCalc.sma50} spacing={spacing} yScale={yScale} color="#ff9800" /></g>}
          {inds.ema20 && <g clipPath="url(#main)"><IndLine data={visData} vals={indCalc.ema20} spacing={spacing} yScale={yScale} color="#4fc3f7" /></g>}
          {inds.ema50 && <g clipPath="url(#main)"><IndLine data={visData} vals={indCalc.ema50} spacing={spacing} yScale={yScale} color="#bc8cff" /></g>}
          {inds.ema200 && <g clipPath="url(#main)"><IndLine data={visData} vals={indCalc.ema200} spacing={spacing} yScale={yScale} color="#ef9a9a" /></g>}

          {/* Volume */}
          {inds.volume && (
            <g clipPath="url(#vol)">
              <rect x={0} y={volTop} width={chartW} height={volH} fill={C.bg} />
              <VolumePanel data={visData} spacing={spacing} cw={cw} volMax={volMax} top={volTop} height={volH} C={C} />
              <line x1={0} y1={volTop} x2={chartW} y2={volTop} stroke={C.border} strokeWidth="0.5" />
            </g>
          )}

          {/* RSI */}
          {inds.rsi && (
            <g clipPath="url(#rsi)">
              <rect x={0} y={rsiTop} width={chartW} height={rsiH} fill={C.bg} />
              <RSIPanel data={visData} vals={indCalc.rsi} spacing={spacing} top={rsiTop} height={rsiH} C={C} />
              <line x1={0} y1={rsiTop} x2={chartW} y2={rsiTop} stroke={C.border} strokeWidth="0.8" />
            </g>
          )}

          {/* MACD */}
          {inds.macd && (
            <g clipPath="url(#macd)">
              <rect x={0} y={macdTop} width={chartW} height={macdH} fill={C.bg} />
              <MACDPanel data={visData} macdData={indCalc.macd} spacing={spacing} top={macdTop} height={macdH} cw={cw} C={C} />
              <line x1={0} y1={macdTop} x2={chartW} y2={macdTop} stroke={C.border} strokeWidth="0.8" />
            </g>
          )}

          {/* Stochastic */}
          {inds.stoch && (
            <g clipPath="url(#stoch)">
              <rect x={0} y={stochTop} width={chartW} height={stochH} fill={C.bg} />
              <StochPanel data={visData} vals={indCalc.stoch} spacing={spacing} top={stochTop} height={stochH} C={C} />
              <line x1={0} y1={stochTop} x2={chartW} y2={stochTop} stroke={C.border} strokeWidth="0.8" />
            </g>
          )}

          {/* Price Axis */}
          <PriceAxis ticks={priceTicks} yScale={yScale} chartW={chartW} C={C} currentPrice={currentPrice} W={W} />

          {/* Time Axis */}
          <TimeAxis data={visData} spacing={spacing} top={H - PB} C={C} />

          {/* Crosshair */}
          {crosshair && <Crosshair cx={crosshair.x} cy={crosshair.y} d={crosshair.d} chartW={chartW} yScale={yScale} C={C} W={W} mainTop={PT} mainBot={PT + mainH} />}
        </svg>

        {/* Indicator legend */}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 10, flexWrap: 'wrap', pointerEvents: 'none' }}>
          {inds.ema50 && <span style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 3, padding: '2px 7px', fontSize: 9, color: '#bc8cff' }}>EMA 50</span>}
          {inds.ema200 && <span style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 3, padding: '2px 7px', fontSize: 9, color: '#ef9a9a' }}>EMA 200</span>}
          {inds.sma20 && <span style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 3, padding: '2px 7px', fontSize: 9, color: '#e3b341' }}>SMA 20</span>}
          {inds.sma50 && <span style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 3, padding: '2px 7px', fontSize: 9, color: '#ff9800' }}>SMA 50</span>}
          {inds.ema20 && <span style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 3, padding: '2px 7px', fontSize: 9, color: '#4fc3f7' }}>EMA 20</span>}
          {inds.bb && <span style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 3, padding: '2px 7px', fontSize: 9, color: C.blue }}>BB(20,2)</span>}
          {inds.vwap && <span style={{ background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 3, padding: '2px 7px', fontSize: 9, color: C.teal }}>VWAP</span>}
        </div>

        {/* Zoom hint */}
        <div style={{ position: 'absolute', bottom: PB + 8, right: PR + 8, color: C.dimmer, fontSize: 9, pointerEvents: 'none' }}>
          Scroll to zoom · Drag to pan
        </div>
      </div>

      <ReplayBar idx={replayIdx} setIdx={setReplayIdx}
        playing={playing} setPlaying={setPlaying}
        speed={speed} setSpeed={setSpeed}
        total={allData.length}
        onStart={() => { setReplayIdx(80); setPlaying(true); setView({ s: 0, e: 80 }); }}
        onExit={() => { setReplayIdx(null); setPlaying(false); setView({ s: 770, e: 900 }); }}
        C={C} />
    </div>
  );
}
