// src/components/SpamperceptionBlocks.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Spamperception Blocks – diagnostická verze (4 min)
 * - 4 modality: digits, letters, colors, shapes
 * - 10 sekvencí / modalitu (≈ 1 min), celkem 40 sekvencí
 * - sekvence start=3 prvky, +1 při úspěchu, -1 při chybě, clamp 2..7
 * - prezentace: on=600ms, gap=400ms; poté reprodukce kliky na stejné buňky
 * - grid 10x10
 * Metriky (per modality): spanMax, accuracy, errors, rtAvg, rtBest
 * Detail: trial logs, serial-position accuracy
 */
export default function SpamperceptionBlocks({ sessionId, taskId = "spamperception-blocks-v1", emitEvent, emitScore }) {
  const GRID = 10;
  const CELLS = GRID * GRID;

  const MODES = ["digits", "letters", "colors", "shapes"] as const;
  const SEQS_PER_BLOCK = 10;
  const ON_MS = 600;
  const GAP_MS = 400;
  const MIN_LEN = 2;
  const MAX_LEN = 7;
  const START_LEN = 3;

  // běh
  const [running, setRunning] = useState(false);
  const [blockIdx, setBlockIdx] = useState(0);                 // 0..3
  const [trialIdx, setTrialIdx] = useState(0);                 // 0..9 v rámci bloku
  const [phase, setPhase] = useState<"idle"|"present"|"respond"|"between">("idle");

  // grid / prezentace
  const [litIdx, setLitIdx] = useState<number | null>(null);
  const [seq, setSeq] = useState<number[]>([]);
  const [seqLen, setSeqLen] = useState(START_LEN);
  const [replayPos, setReplayPos] = useState(0);

  // metriky a logy
  const startTsRef = useRef<number | null>(null);
  const presentTimersRef = useRef<number[]>([]);
  const responseStartRef = useRef<number | null>(null);
  const lastClickPerfRef = useRef<number | null>(null);

  // agregace per modalita
  type ModStats = {
    spanMax: number;
    hits: number; // správné kliky v reprodukci
    total: number; // všechny požadované kroky
    errors: number; // špatné kliky / pořadí
    rtList: number[];
    spCorrByPos: number[]; // serial-position correct counts
    spTotalByPos: number[]; // serial-position totals
    trials: Array<{len:number, ok:boolean}>;
  };
  const statsRef = useRef<Record<string, ModStats>>({});
  const trialLogRef = useRef<any[]>([]);

  // util
  const mode = MODES[blockIdx] || MODES[MODES.length - 1];

  const symFor = useCallback((m:string, n:number) => {
    if (m === "digits") return String((n % 10));
    if (m === "letters") {
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      return letters[n % letters.length];
    }
    if (m === "colors") {
      const palette = ["#F87171","#34D399","#60A5FA","#FBBF24","#A78BFA","#F472B6"];
      return palette[n % palette.length];
    }
    if (m === "shapes") {
      // vrací název tvaru, vykreslíme jako borderRadius apod.
      const list = ["square","circle","diamond","triangle"];
      return list[n % list.length];
    }
    return String(n);
  }, []);

  const clearTimers = useCallback(() => {
    presentTimersRef.current.forEach(t => clearTimeout(t));
    presentTimersRef.current = [];
  }, []);

  const resetStatsIfNeeded = useCallback(() => {
    MODES.forEach(m => {
      if (!statsRef.current[m]) {
        statsRef.current[m] = {
          spanMax: 0,
          hits: 0,
          total: 0,
          errors: 0,
          rtList: [],
          spCorrByPos: Array(MAX_LEN).fill(0),
          spTotalByPos: Array(MAX_LEN).fill(0),
          trials: [],
        };
      }
    });
  }, []);

  const randUniqueSeq = useCallback((len:number) => {
    const used = new Set<number>();
    const arr:number[] = [];
    while (arr.length < len) {
      const idx = Math.floor(Math.random()*CELLS);
      if (!used.has(idx)) { used.add(idx); arr.push(idx); }
    }
    return arr;
  }, []);

  const clamp = (v:number,min:number,max:number)=> Math.max(min, Math.min(max, v));

  // prezentace jedné sekvence (svícení postupně)
  const presentSequence = useCallback((arr:number[]) => {
    setPhase("present");
    responseStartRef.current = null;
    setReplayPos(0);
    let t = 0;
    arr.forEach((cell, i) => {
      const onT = window.setTimeout(()=> setLitIdx(cell), t);
      presentTimersRef.current.push(onT);
      t += ON_MS;
      const offT = window.setTimeout(()=> setLitIdx(null), t);
      presentTimersRef.current.push(offT);
      t += GAP_MS;
    });
    const doneT = window.setTimeout(()=> {
      setPhase("respond");
      responseStartRef.current = performance.now();
      lastClickPerfRef.current = responseStartRef.current;
      emitEvent?.({type:"SEQ_PRESENTED", ts: Date.now(), data:{mode, len: arr.length, trial: trialIdx+1}});
    }, t);
    presentTimersRef.current.push(doneT);
  }, [emitEvent, mode, trialIdx]);

  const startTrial = useCallback((len:number) => {
    const arr = randUniqueSeq(len);
    setSeq(arr);
    presentSequence(arr);
  }, [randUniqueSeq, presentSequence]);

  const finishTrial = useCallback((ok:boolean) => {
    // update stats
    const st = statsRef.current[mode];
    st.trials.push({len: seq.length, ok});
    if (ok) st.spanMax = Math.max(st.spanMax, seq.length);

    // advance len
    const nextLen = clamp(seqLen + (ok ? 1 : -1), MIN_LEN, MAX_LEN);
    setSeqLen(nextLen);

    // další trial nebo další blok
    if (trialIdx + 1 >= SEQS_PER_BLOCK) {
      // blok hotov
      emitEvent?.({type:"BLOCK_END", ts: Date.now(), data:{mode, trials: SEQS_PER_BLOCK}});
      setPhase("between");
      const nextBlock = blockIdx + 1;
      if (nextBlock >= MODES.length) {
        // komplet test hotov
        setRunning(false);
        setBlockIdx(MODES.length - 1);
        // vyhodnoť
        const report = buildReport();
        emitScore?.(report);
      } else {
        // další blok po krátké pauze
        window.setTimeout(()=>{
          setBlockIdx(nextBlock);
          setTrialIdx(0);
          setSeqLen(START_LEN);
          setPhase("present");
          startTrial(START_LEN);
        }, 600);
      }
    } else {
      // další trial v rámci bloku
      setTrialIdx(trialIdx + 1);
      setPhase("present");
      startTrial(nextLen);
    }
  }, [mode, seq, seqLen, trialIdx, blockIdx, emitEvent, emitScore]);

  const onCellClick = useCallback((cellIdx:number) => {
    if (phase !== "respond") return;
    const nowPerf = performance.now();
    const st = statsRef.current[mode];

    // očekávaný index
    const expected = seq[replayPos];
    const correct = (cellIdx === expected);

    // metriky
    const rt = lastClickPerfRef.current ? Math.round(nowPerf - lastClickPerfRef.current) : 0;
    lastClickPerfRef.current = nowPerf;

    st.total += 1;
    st.spTotalByPos[replayPos] += 1;

    if (correct) {
      st.hits += 1;
      if (rt>0) st.rtList.push(rt);
      st.spCorrByPos[replayPos] += 1;

      trialLogRef.current.push({
        ts: Date.now(),
        mode,
        trial: trialIdx+1,
        pos: replayPos,
        expected,
        clicked: cellIdx,
        correct: true,
        rt,
      });

      const nextPos = replayPos + 1;
      setReplayPos(nextPos);
      if (nextPos >= seq.length) {
        // celé správně
        emitEvent?.({type:"RESP_OK", ts: Date.now(), data:{mode, len: seq.length}});
        finishTrial(true);
      }
    } else {
      statsRef.current[mode].errors += 1;
      trialLogRef.current.push({
        ts: Date.now(),
        mode,
        trial: trialIdx+1,
        pos: replayPos,
        expected,
        clicked: cellIdx,
        correct: false,
        rt,
      });
      emitEvent?.({type:"RESP_ERR", ts: Date.now(), data:{mode, pos: replayPos}});
      finishTrial(false);
    }
  }, [phase, mode, seq, replayPos, trialIdx, emitEvent, finishTrial]);

  const buildReport = useCallback(() => {
    const summary:any = { taskId, sessionId, durationMs: startTsRef.current ? (Date.now() - startTsRef.current) : 0, metrics:{}, details:{} };

    // per modality metrics
    MODES.forEach(m => {
      const st = statsRef.current[m];
      const acc = st.total>0 ? Math.round((st.hits/st.total)*100) : 0;
      const rtAvg = st.rtList.length ? Math.round(st.rtList.reduce((a,b)=>a+b,0)/st.rtList.length) : 0;
      const rtBest = st.rtList.length ? Math.min(...st.rtList) : 0;

      summary.metrics[`spanMax_${m}`] = st.spanMax;
      summary.metrics[`accuracyPct_${m}`] = acc;
      summary.metrics[`errors_${m}`] = st.errors;
      summary.metrics[`reactionTimeAvgMs_${m}`] = rtAvg;
      summary.metrics[`reactionTimeBestMs_${m}`] = rtBest;
    });

    summary.details = {
      perModality: Object.fromEntries(MODES.map(m => {
        const st = statsRef.current[m];
        return [m, {
          spanMax: st.spanMax,
          hits: st.hits,
          total: st.total,
          errors: st.errors,
          rtList: st.rtList,
          serialPosition: {
            correct: st.spCorrByPos,
            total: st.spTotalByPos
          },
          trials: st.trials
        }];
      })),
      trialLog: trialLogRef.current
    };

    // high-level scores (STM index = průměr normalizovaných spanMax a accuracy)
    const spans = MODES.map(m => statsRef.current[m].spanMax);
    const accs  = MODES.map(m => (statsRef.current[m].total>0 ? (statsRef.current[m].hits/statsRef.current[m].total) : 0));
    const spanScore = spans.reduce((a,b)=>a+b,0) / (MODES.length*MAX_LEN);
    const accScore = accs.reduce((a,b)=>a+b,0) / MODES.length;
    const stmIndex = Math.round((0.6*spanScore + 0.4*accScore)*100);

    summary.metrics["STM_Index"] = stmIndex;
    return summary;
  }, [taskId, sessionId]);

  const start = useCallback(() => {
    resetStatsIfNeeded();
    setRunning(true);
    setBlockIdx(0);
    setTrialIdx(0);
    setSeqLen(START_LEN);
    setPhase("present");
    setSeq([]);
    trialLogRef.current = [];
    startTsRef.current = Date.now();
    emitEvent?.({type:"START", ts: startTsRef.current, data:{sessionId, taskId, version:"diag-4min"}});

    // první trial
    window.setTimeout(()=> startTrial(START_LEN), 50);
  }, [emitEvent, resetStatsIfNeeded, sessionId, taskId, startTrial]);

  const stop = useCallback(() => {
    clearTimers();
    setRunning(false);
    const report = buildReport();
    emitEvent?.({type:"END", ts: Date.now()});
    emitScore?.(report);
  }, [clearTimers, buildReport, emitEvent, emitScore]);

  useEffect(()=>() => { clearTimers(); }, [clearTimers]);

  // vykreslení buněk
  const renderCell = useCallback((idx:number) => {
    // během prezentace ukazujeme symbol modality
    const isLit = (litIdx === idx && phase === "present");
    const shape = symFor("shapes", idx); // pro shapes
    const color = symFor("colors", idx);

    const inner =
      mode === "digits"   ? (isLit ? symFor("digits", idx) : "") :
      mode === "letters"  ? (isLit ? symFor("letters", idx) : "") :
      mode === "colors"   ? "" :
      mode === "shapes"   ? "" : "";

    const bg =
      mode === "colors" && isLit ? (color as string) :
      "#FFFFFF";

    const styleShape = (mode === "shapes" && isLit) ? {
      borderRadius: shape==="circle" ? 999 : 8,
      clipPath: shape==="triangle" ? "polygon(50% 5%, 95% 95%, 5% 95%)"
        : (shape==="diamond" ? "polygon(50% 5%, 95% 50%, 50% 95%, 5% 50%)" : "none")
    } : {};

    return (
      <button
        key={idx}
        id={`cell-${idx}`}
        onClick={()=> onCellClick(idx)}
        disabled={!running || phase!=="respond"}
        style={{
          border: "2px solid #D50032",
          background: bg,
          color: "#111",
          borderRadius: 8,
          fontWeight: 700,
          fontSize: 18,
          userSelect: "none",
          cursor: (running && phase==="respond") ? "pointer" : "default",
          ...styleShape as any
        }}
      >
        {inner}
      </button>
    );
  }, [litIdx, phase, mode, onCellClick, running, symFor]);

  return (
    <div style={{width:"100vw", height:"100vh", display:"flex", flexDirection:"column", background:"#1A4E8A", color:"#fff", padding:16, gap:12}}>
      <div style={{display:"flex", justifyContent:"space-between"}}>
        <div style={{fontSize:20, fontWeight:600}}>Spamperception Blocks</div>
        <div style={{fontSize:12, opacity:.85}}>
          session: {sessionId||"–"} · task: {taskId} · block: {blockIdx+1}/{MODES.length} ({mode})
          · trial: {trialIdx+1}/{SEQS_PER_BLOCK} · len: {seqLen}
        </div>
      </div>

      <div style={{display:"flex", gap:12, alignItems:"center"}}>
        {!running ? (
          <button onClick={start} style={{padding:"8px 16px", borderRadius:8, background:"#fff", color:"#000", border:"none"}}>Start</button>
        ) : (
          <button onClick={stop} style={{padding:"8px 16px", borderRadius:8, background:"#fff", color:"#000", border:"none"}}>Stop</button>
        )}
        <div>Fáze: {phase}</div>
        <div>Mod: {mode}</div>
      </div>

      <div style={{
        flex:1,
        display:"grid",
        gridTemplateColumns:`repeat(${GRID}, 1fr)`,
        gridTemplateRows:`repeat(${GRID}, 1fr)`,
        gap:4,
        background:"#0D2B55",
        borderRadius:12,
        padding:8
      }}>
        {Array.from({length: CELLS}, (_,i)=> renderCell(i))}
      </div>

      <div style={{fontSize:12, opacity:.85}}>
        V bloku se zobrazí 10 sekvencí. Každá správná reprodukce prodlouží sekvenci o 1, chyba zkrátí o 1 (meze 2–7).
        Prezentace: 600 ms on / 400 ms off.
      </div>
    </div>
  );
}
