// src/components/CentralPeripheralSpanTask.jsx
import React, { useState, useRef, useCallback, useEffect } from "react";

export default function CentralPeripheralSpanTask({ sessionId, emitEvent, emitScore }) {
  const GRID = 10;
  const CELLS = GRID * GRID;
  const BLOCKS = ["central", "peripheral"];
  const SEQS_PER_BLOCK = 10;
  const START_LEN = 3, MIN_LEN = 2, MAX_LEN = 7;
  const ON_MS = 600, GAP_MS = 400;

  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [blockIdx, setBlockIdx] = useState(0);
  const [seq, setSeq] = useState([]);
  const [lit, setLit] = useState(null);
  const [trialIdx, setTrialIdx] = useState(0);
  const [seqLen, setSeqLen] = useState(START_LEN);
  const [replayPos, setReplayPos] = useState(0);

  const logsRef = useRef([]);
  const timersRef = useRef([]);
  const spanMaxRef = useRef({ central: 0, peripheral: 0 });
  const startTsRef = useRef(null);

  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };

  const regionFilter = useCallback((region) => {
    const indices = [];
    for (let r = 0; r < GRID; r++)
      for (let c = 0; c < GRID; c++) {
        const idx = r * GRID + c;
        const inCenter = r >= 3 && r <= 6 && c >= 3 && c <= 6;
        if (region === "central" ? inCenter : !inCenter) indices.push(idx);
      }
    return indices;
  }, []);

  const randSeq = (len, region) => {
    const available = regionFilter(region);
    const used = new Set();
    const seq = [];
    while (seq.length < len) {
      const idx = available[Math.floor(Math.random() * available.length)];
      if (!used.has(idx)) { seq.push(idx); used.add(idx); }
    }
    return seq;
  };

  const presentSeq = useCallback((arr) => {
    setPhase("present");
    let t = 0;
    arr.forEach((cell) => {
      timersRef.current.push(setTimeout(() => setLit(cell), t));
      t += ON_MS;
      timersRef.current.push(setTimeout(() => setLit(null), t));
      t += GAP_MS;
    });
    timersRef.current.push(setTimeout(() => setPhase("respond"), t));
  }, []);

  const startTrial = useCallback((len) => {
    const region = BLOCKS[blockIdx];
    const arr = randSeq(len, region);
    setSeq(arr);
    presentSeq(arr);
  }, [blockIdx, presentSeq]);

  const finishTrial = useCallback((ok) => {
    const region = BLOCKS[blockIdx];
    if (ok) spanMaxRef.current[region] = Math.max(spanMaxRef.current[region], seq.length);
    const nextLen = Math.max(MIN_LEN, Math.min(MAX_LEN, seqLen + (ok ? 1 : -1)));
    setSeqLen(nextLen);

    if (trialIdx + 1 >= SEQS_PER_BLOCK) {
      if (blockIdx + 1 >= BLOCKS.length) {
        setRunning(false);
        setPhase("idle");
        emitScore?.({
          taskId: "central-peripheral-span",
          sessionId,
          durationMs: Date.now() - startTsRef.current,
          metrics: {
            span_central: spanMaxRef.current.central,
            span_peripheral: spanMaxRef.current.peripheral,
          },
          details: { logs: logsRef.current },
        });
      } else {
        setBlockIdx(blockIdx + 1);
        setTrialIdx(0);
        setSeqLen(START_LEN);
        setPhase("between");
        setTimeout(() => startTrial(START_LEN), 800);
      }
    } else {
      setTrialIdx(trialIdx + 1);
      setPhase("between");
      setTimeout(() => startTrial(nextLen), 600);
    }
  }, [seq, blockIdx, trialIdx, seqLen, emitScore, startTrial]);

  const onCellClick = (i) => {
    if (phase !== "respond") return;
    const correct = i === seq[replayPos];
    logsRef.current.push({ ts: Date.now(), i, correct, block: BLOCKS[blockIdx], pos: replayPos });
    if (correct) {
      if (replayPos + 1 >= seq.length) finishTrial(true);
      else setReplayPos(replayPos + 1);
    } else finishTrial(false);
  };

  const start = () => {
    clearTimers();
    setRunning(true);
    setPhase("between");
    startTsRef.current = Date.now();
    setBlockIdx(0);
    setTrialIdx(0);
    setSeqLen(START_LEN);
    setTimeout(() => startTrial(START_LEN), 500);
  };

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#1A4E8A", color: "white", padding: 16 }}>
      <h2>Central–Peripheral Span Task</h2>
      <div>
        {!running ? <button onClick={start}>Start</button> : <div>Running...</div>}
        <div>Block: {BLOCKS[blockIdx]}</div>
        <div>Trial: {trialIdx + 1}/{SEQS_PER_BLOCK}</div>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${GRID}, 1fr)`,
        gridTemplateRows: `repeat(${GRID}, 1fr)`,
        width: "90vmin", height: "90vmin", margin: "auto", gap: 4,
        background: "#0D2B55", borderRadius: 12, padding: 8,
      }}>
        {Array.from({ length: CELLS }, (_, i) => (
          <button key={i} onClick={() => onCellClick(i)}
            style={{
              background: lit === i ? "#F87171" : "#fff",
              borderRadius: 6, border: "1px solid #333"
            }} />
        ))}
      </div>
    </div>
  );
}
