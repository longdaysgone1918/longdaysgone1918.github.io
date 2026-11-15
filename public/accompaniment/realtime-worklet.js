// 自动生成，请勿手动修改：源代码在 src/lib/accompaniment/realtime-processor.ts，用 node scripts/build-worklet.mjs 重新生成
// Generated file, do not edit by hand: source in src/lib/accompaniment/realtime-processor.ts; rebuild with node scripts/build-worklet.mjs
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/lib/accompaniment/params.ts
  var ENGINE = {
    TEMPO_PRIOR: 0.865,
    // 开始时假设的速度（相对 MIDI 原速）/ initial tempo guess relative to MIDI
    CONFIRM_FRAMES: 2,
    // 新音符需要连续几帧确认 / frames to confirm a new note
    REENTRY_CONFIRM_FRAMES: 6,
    // 休止或停顿后重新进入需要的帧数 / frames to confirm a re-entry
    PAUSE_SILENCE_FRAMES: 40,
    // 至少安静 0.4 秒才算停下 / at least 0.4 s of silence counts as a pause
    PAUSE_FREEZE: true,
    // 停顿时跟随器停在原处 / hold position while the player pauses
    PAUSE_SEC: 0.4,
    // 停顿判定时间 / pause detection time (s)
    UNFREEZE_FRAMES: 100,
    // 停顿中听到 1 秒像乐器但不是预期的音：认为在别处继续 / resume elsewhere
    LATE_DROP: 0.15,
    // 错过超过这么久的伴奏音直接跳过 / skip accompaniment notes missed by more than this (s)
    SELF_TAIL: 0.3,
    // 伴奏音结束后屏蔽还延续多久 / masking tail after an accompaniment note (s)
    ECHO_MAX_DELAY: 0.35,
    // 扬声器回声最多晚多少秒 / maximum loudspeaker echo delay (s)
    OBS_NOISE: 0.03,
    // 卡尔曼：起音观测噪声（秒）/ Kalman: onset observation noise (s)
    DRIFT_TIME: 0.02,
    // 卡尔曼：每拍的时间漂移 / Kalman: timing drift per quarter note (s)
    DRIFT_TEMPO: 0.03,
    // 卡尔曼：每拍的相对速度变化 / Kalman: relative tempo drift per quarter note
    SMOOTHING: true,
    // 平滑的相位校正 / smooth phase correction
    ALPHA: 0.8,
    // 每个四分音符修正多少比例的偏差 / fraction corrected per quarter note
    IOI_MIN: 0.8,
    // 间隔最多压缩到 0.8 倍 / shortest interval x nominal
    IOI_MAX: 1.25,
    // 间隔最多拉长到 1.25 倍 / longest interval x nominal
    SKIP_BEHIND_QN: 0.5,
    // 落后超过半拍时跳过填充音 / skip filler notes when behind by more than this (qn)
    RESYNC_QN: 1,
    // 偏差超过一拍时直接对齐 / snap when off by more than this (qn)
    SNAP_GUARD: true,
    // 直接对齐时也保持最小间隔 / keep a minimum interval when snapping
    SUSTAIN_MAX: 1.5,
    // 等待时伴奏音最多延长多少秒 / maximum sustain while waiting (s)
    MIN_IOI_RATIO: 0.5,
    // 仅在 SMOOTHING = false 时使用 / only used when SMOOTHING = false
    PATIENCE_SEC: 0.25,
    // 下一个音最多可以晚多久（固定部分）/ patience before stopping (s)
    PATIENCE_RATIO: 0.25,
    // 以及按乐谱间隔计算的部分 / plus this fraction of the expected interval
    HOP_SEC: 0.01
    // 帧移 / frame hop (s)
  };

  // src/lib/accompaniment/follower.ts
  var ScoreFollower = class {
    constructor(piano, states, secPerQn) {
      __publicField(this, "S");
      __publicField(this, "pitch");
      __publicField(this, "isNote");
      __publicField(this, "optional");
      __publicField(this, "qdur");
      __publicField(this, "qStart");
      __publicField(this, "qEnd");
      __publicField(this, "alpha");
      __publicField(this, "stay");
      // 每帧复用的缓冲区，避免在音频线程里反复分配内存 / buffers reused every frame (no allocation on the audio thread)
      __publicField(this, "move");
      __publicField(this, "spare");
      __publicField(this, "outside");
      const S = states.length;
      this.S = S;
      this.pitch = new Float64Array(S);
      this.isNote = new Uint8Array(S);
      this.optional = new Uint8Array(S);
      const qdur = new Float64Array(S);
      states.forEach((st, s) => {
        this.pitch[s] = st.type === "note" ? piano[st.k].pitch : NaN;
        this.isNote[s] = st.type === "note" ? 1 : 0;
        this.optional[s] = st.type === "note" && piano[st.k].final ? 1 : 0;
        if (st.type === "sil") {
          qdur[s] = 50;
        } else if (st.type === "note") {
          const k = st.k;
          const nxt = k + 1 < piano.length ? piano[k + 1].qn : piano[k].qn + 1;
          const restFollows = s + 1 < S && states[s + 1].type === "rest";
          qdur[s] = restFollows ? piano[k].dur : nxt - piano[k].qn;
        } else {
          const k = st.k;
          qdur[s] = piano[k + 1].qn - (piano[k].qn + piano[k].dur);
        }
      });
      this.qdur = qdur.map((v) => Math.max(v, 0.05));
      this.qStart = new Float64Array(S);
      states.forEach((st, s) => {
        if (st.type === "note") this.qStart[s] = piano[st.k].qn;
        else if (st.type === "rest") this.qStart[s] = piano[st.k].qn + piano[st.k].dur;
        else {
          const last = piano[piano.length - 1];
          this.qStart[s] = s === 0 ? -1e9 : last.qn + last.dur;
        }
      });
      this.qEnd = new Float64Array(S);
      for (let s = 0; s < S; s++) this.qEnd[s] = s === S - 1 ? 1e9 : this.qStart[s] + this.qdur[s];
      this.alpha = new Float64Array(S);
      this.alpha[0] = 1;
      this.stay = new Float64Array(S);
      this.move = new Float64Array(S);
      this.spare = new Float64Array(S);
      this.outside = new Uint8Array(S);
      this.setTempo(secPerQn);
    }
    setTempo(secPerQn) {
      for (let s = 0; s < this.S; s++) {
        const frames = this.qdur[s] * secPerQn / ENGINE.HOP_SEC;
        const v = 1 - 1 / Math.max(frames, 1);
        this.stay[s] = Math.min(Math.max(v, 0.5), 0.999);
      }
      this.stay[0] = 0.995;
    }
    step(midi, voiced, qWindow, eps = 0.02, back = 5e-3, ahead = 6, behind = 2) {
      const S = this.S;
      const a = this.alpha;
      const move = this.move;
      const nw = this.spare === a ? new Float64Array(S) : this.spare;
      for (let s = 0; s < S; s++) {
        move[s] = a[s] * (1 - this.stay[s]);
        nw[s] = a[s] * this.stay[s];
      }
      for (let s = 1; s < S; s++) nw[s] += move[s - 1] * (1 - eps);
      for (let s = 3; s < S; s++) nw[s] += move[s - 1] * eps;
      nw[1] += move[0] * eps;
      for (let s = 0; s < S - 1; s++) nw[s] += a[s + 1] * back;
      for (let s = 0; s < S; s++) {
        let e;
        if (voiced) {
          if (this.isNote[s]) {
            const d = Math.abs(midi - this.pitch[s]) / 0.35;
            e = 0.05 + 0.95 * Math.exp(-0.5 * d * d);
          } else e = 0.05;
        } else {
          e = this.isNote[s] ? this.optional[s] ? 0.6 : 0.3 : 0.9;
        }
        nw[s] *= e;
      }
      let c = 0;
      for (let s = 1; s < S; s++) if (nw[s] > nw[c]) c = s;
      for (let s = 0; s < Math.max(0, c - behind); s++) nw[s] = 0;
      for (let s = c + ahead + 1; s < S; s++) nw[s] = 0;
      if (qWindow) {
        const [lo, hi] = qWindow;
        let inside = 0;
        const outside = this.outside;
        for (let s = 0; s < S; s++) {
          outside[s] = this.qEnd[s] < lo || this.qStart[s] > hi ? 1 : 0;
          if (!outside[s]) inside += nw[s];
        }
        if (inside > 0) {
          for (let s = 0; s < S; s++) if (outside[s]) nw[s] = 0;
        }
      }
      let sum = 0;
      for (let s = 0; s < S; s++) sum += nw[s];
      const denom = Math.max(sum, 1e-300);
      for (let s = 0; s < S; s++) nw[s] /= denom;
      this.spare = a;
      this.alpha = nw;
      let best = 0;
      for (let s = 1; s < S; s++) if (nw[s] > nw[best]) best = s;
      return [best, nw[best]];
    }
  };

  // src/lib/accompaniment/kalman.ts
  var TempoKalman = class {
    constructor(q0, t0, s0) {
      __publicField(this, "qRef");
      __publicField(this, "x");
      __publicField(this, "P");
      this.qRef = q0;
      this.x = [t0, s0];
      this.P = [
        [0.02 ** 2, 0],
        [0, (0.1 * s0) ** 2]
      ];
    }
    predictTime(q) {
      return this.x[0] + this.x[1] * (q - this.qRef);
    }
    update(q, t) {
      const dq = q - this.qRef;
      const [T, s] = this.x;
      const P = this.P;
      const x0 = T + dq * s;
      const x1 = s;
      const q00 = ENGINE.DRIFT_TIME ** 2 * Math.abs(dq);
      const q11 = (ENGINE.DRIFT_TEMPO * s) ** 2 * Math.abs(dq);
      const fp00 = P[0][0] + dq * P[1][0];
      const fp01 = P[0][1] + dq * P[1][1];
      const fp10 = P[1][0];
      const fp11 = P[1][1];
      const p00 = fp00 + fp01 * dq + q00;
      const p01 = fp01;
      const p10 = fp10 + fp11 * dq;
      const p11 = fp11 + q11;
      const S = p00 + ENGINE.OBS_NOISE ** 2;
      const k0 = p00 / S;
      const k1 = p10 / S;
      const innovation = t - x0;
      const sOld = s;
      this.x = [x0 + k0 * innovation, x1 + k1 * innovation];
      this.P = [
        [p00 - k0 * p00, p01 - k0 * p01],
        [p10 - k1 * p00, p11 - k1 * p01]
      ];
      this.x[1] = Math.min(Math.max(this.x[1], sOld / 1.2), sOld * 1.2);
      this.qRef = q;
      return innovation;
    }
    // 休止后重新进入：只校正时间，不改变速度 / re-entry after a rest: correct the time only, keep the tempo
    reenter(q, t) {
      this.x[0] = t;
      this.qRef = q;
      this.P[0][0] = ENGINE.OBS_NOISE ** 2;
      this.P[0][1] = 0;
      this.P[1][0] = 0;
      this.P[1][1] = Math.max(this.P[1][1], (0.12 * this.x[1]) ** 2);
    }
    clone() {
      return {
        x: [this.x[0], this.x[1]],
        P: [
          [this.P[0][0], this.P[0][1]],
          [this.P[1][0], this.P[1][1]]
        ],
        qRef: this.qRef
      };
    }
  };

  // src/lib/accompaniment/score.ts
  var toNote = (n) => ({
    index: n.index,
    measure: n.measure,
    beat: n.beat_eighth,
    qn: n.qn,
    dur: n.dur_qn,
    pitch: n.pitch,
    vel: n.velocity,
    final: n.final,
    category: n.category
  });
  function parseScore(raw) {
    return {
      piano: raw.piano.map(toNote),
      violin: raw.violin.map(toNote),
      midiSecPerQuarter: raw.midi_sec_per_quarter_note,
      tempoPriorRelativeToMidi: raw.tempo_prior_relative_to_midi
    };
  }
  function buildStates(piano, restMin = 0.2) {
    const states = [{ type: "sil", k: -1 }];
    piano.forEach((n, k) => {
      states.push({ type: "note", k });
      if (k + 1 < piano.length && piano[k + 1].qn - (n.qn + n.dur) > restMin) {
        states.push({ type: "rest", k });
      }
    });
    states.push({ type: "sil", k: -1 });
    return states;
  }
  function interp(x, xp, fp) {
    if (x <= xp[0]) return fp[0];
    const n = xp.length;
    if (x >= xp[n - 1]) return fp[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = lo + hi >> 1;
      if (xp[mid] <= x) lo = mid;
      else hi = mid;
    }
    const t = (x - xp[lo]) / (xp[hi] - xp[lo]);
    return fp[lo] + t * (fp[hi] - fp[lo]);
  }

  // src/lib/accompaniment/engine.ts
  var key4 = (x) => (Math.round(x * 1e4) / 1e4).toFixed(4);
  function polyfit1(x, y) {
    const n = x.length;
    const mx = x.reduce((a, b) => a + b, 0) / n;
    const my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (x[i] - mx) * (y[i] - my);
      sxx += (x[i] - mx) * (x[i] - mx);
    }
    const slope = sxy / sxx;
    return [slope, my - slope * mx];
  }
  function searchsorted(a, v) {
    let lo = 0;
    let hi = a.length;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (a[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  var FollowerEngine = class {
    constructor(score, secPerQnMidi, mode = "strict", options = {}) {
      __publicField(this, "mode");
      __publicField(this, "piano");
      __publicField(this, "violin");
      __publicField(this, "states");
      __publicField(this, "s0");
      __publicField(this, "follower");
      __publicField(this, "pQ");
      __publicField(this, "vQ");
      __publicField(this, "skipNote");
      __publicField(this, "restBefore");
      __publicField(this, "vWithPiano");
      __publicField(this, "vUnison", /* @__PURE__ */ new Map());
      __publicField(this, "noteState", /* @__PURE__ */ new Map());
      __publicField(this, "committed");
      __publicField(this, "soundEnd");
      __publicField(this, "kf", null);
      __publicField(this, "lastK", -1);
      __publicField(this, "nxt", 0);
      __publicField(this, "events", []);
      __publicField(this, "cand", []);
      __publicField(this, "rejected", []);
      __publicField(this, "history", []);
      __publicField(this, "silentCount", 0);
      __publicField(this, "prevSilent", 0);
      __publicField(this, "silentRun", 0);
      __publicField(this, "lastPlayed", null);
      __publicField(this, "resync", true);
      __publicField(this, "selfCheck", false);
      // 扬声器模式下由会话打开 / enabled by the session in loudspeaker mode
      __publicField(this, "times", []);
      __publicField(this, "midi", []);
      __publicField(this, "voiced", []);
      __publicField(this, "state", [null, -1]);
      __publicField(this, "paused", false);
      __publicField(this, "lastMatchT", 0);
      __publicField(this, "offscore", 0);
      __publicField(this, "commitHorizon", 0.03);
      // 提前锁定的时间（秒）：输出延迟 + 余量 / commit lead time: output latency + margin
      __publicField(this, "noWaitCap", /* @__PURE__ */ new Map());
      // 不等待的小节：你的进入音 -> 伴奏可以演奏到的位置 / no-wait windows
      __publicField(this, "skippedCount", 0);
      // 被跳过的伴奏音（供会话缩短上一个音）/ skipped accompaniment notes (lets the session shorten the previous note)
      __publicField(this, "backConfirmFrames");
      this.mode = mode;
      this.piano = score.piano;
      this.violin = score.violin;
      const piano = this.piano;
      this.states = buildStates(piano);
      this.s0 = secPerQnMidi / ENGINE.TEMPO_PRIOR;
      this.follower = new ScoreFollower(piano, this.states, this.s0);
      this.pQ = Float64Array.from(piano.map((n) => n.qn));
      const ornQ = piano.filter((n) => (n.durOrig ?? n.dur) < 0.1 && !n.final).map((n) => n.qn);
      this.skipNote = piano.map((n) => ornQ.some((q) => q - 0.5 <= n.qn && n.qn <= q + 1.5));
      this.restBefore = piano.map((n, k) => k === 0 ? false : n.qn - (piano[k - 1].qn + piano[k - 1].dur) > 0.2);
      this.vQ = Float64Array.from(this.violin.map((n) => n.qn));
      this.committed = new Float64Array(this.violin.length).fill(NaN);
      this.soundEnd = new Float64Array(this.violin.length).fill(NaN);
      const pOn = new Set(Array.from(this.pQ, key4));
      this.vWithPiano = Array.from(this.vQ, (q) => pOn.has(key4(q)));
      this.violin.forEach((vn, j) => {
        piano.forEach((pn, k) => {
          if (Math.abs(vn.qn - pn.qn) < 1e-6 && vn.pitch === pn.pitch) this.vUnison.set(j, k);
        });
      });
      this.states.forEach((st, s) => {
        if (st.type === "note") this.noteState.set(st.k, s);
      });
      this.backConfirmFrames = options.backConfirmFrames ?? ENGINE.CONFIRM_FRAMES;
      const qO = piano.map((n) => n.qnOrig ?? n.qn);
      const dO = piano.map((n) => n.durOrig ?? n.dur);
      if (options.waitRestMinQn !== void 0) {
        const minQn = options.waitRestMinQn;
        this.restBefore = piano.map((_, k) => k === 0 ? false : qO[k] - (qO[k - 1] + dO[k - 1]) >= minQn);
      }
      if (options.noWaitMeasures?.length) {
        const after = options.noWaitAfterEntryQn ?? 1.5;
        const beatsPerBar = options.quarterNotesPerMeasure ?? 6;
        const vqO = this.violin.map((n) => n.qnOrig ?? n.qn);
        for (let k = 1; k < piano.length; k++) {
          const m = piano[k].measure;
          if (options.noWaitMeasures.includes(m) && qO[k] - (qO[k - 1] + dO[k - 1]) > 0.2) {
            const limit = Math.max(beatsPerBar * m, qO[k] + after);
            const cap = vqO.findIndex((x) => x >= limit - 1e-6);
            this.noWaitCap.set(k, cap < 0 ? this.violin.length : cap);
          }
        }
      }
    }
    // ---------------- helpers ----------------
    snapshot() {
      return this.kf.clone();
    }
    restore(snap) {
      const kf = this.kf;
      kf.x = [snap.x[0], snap.x[1]];
      kf.P = [
        [snap.P[0][0], snap.P[0][1]],
        [snap.P[1][0], snap.P[1][1]]
      ];
      kf.qRef = snap.qRef;
    }
    // q 之后的下一个钢琴起音（跳过装饰音区域）/ next piano onset after position q
    nextPiano(q) {
      for (let k = searchsorted(this.pQ, q + 1e-6); k < this.piano.length; k++) {
        if (!this.skipNote[k]) return k;
      }
      return null;
    }
    patience(kNext) {
      const kf = this.kf;
      return ENGINE.PATIENCE_SEC + ENGINE.PATIENCE_RATIO * kf.x[1] * Math.max(this.pQ[kNext] - kf.qRef, 0);
    }
    // 演奏者此刻在弹的音和接下来要弹的音 / the note the player is on and the next one
    expectedNotes() {
      const out = /* @__PURE__ */ new Set();
      const [typ, k] = this.state;
      if (typ === "note") out.add(k);
      const k2 = this.kf ? this.nextPiano(this.kf.qRef) : null;
      if (k2 !== null) out.add(k2);
      return out;
    }
    // 伴奏音 j 是否参与屏蔽：与演奏者此刻要弹的音同音时不屏蔽
    // Whether accompaniment note j is masked: not when it has the pitch of a note the player is expected to play
    ownNote(j, expected) {
      const pitches = new Set(Array.from(expected, (k) => this.piano[k].pitch));
      return !pitches.has(this.violin[j].pitch);
    }
    // 自身伴奏声屏蔽 / self-masking of our own accompaniment sound
    isSelfSound(t, midi, voiced, tol = 0.6, tail = ENGINE.SELF_TAIL) {
      if (!voiced || this.lastPlayed === null) return false;
      const expected = this.expectedNotes();
      for (let j = Math.max(0, this.lastPlayed - 6); j <= this.lastPlayed; j++) {
        if (Number.isFinite(this.committed[j]) && this.committed[j] - 0.05 <= t && t <= this.soundEnd[j] + tail && Math.abs(midi - this.violin[j].pitch) < tol && this.ownNote(j, expected))
          return true;
      }
      return false;
    }
    // 重新进入时识别伴奏的回声 / recognise our own echo at a re-entry
    echoSounding(k, onset, tol = 0.6) {
      if (!this.selfCheck || this.lastPlayed === null) return false;
      const p = this.piano[k].pitch;
      for (let j = Math.max(0, this.lastPlayed - 8); j <= this.lastPlayed; j++) {
        const tOn = this.committed[j];
        if (Number.isFinite(tOn) && Math.abs(this.violin[j].pitch - p) < tol && tOn - 0.06 <= onset && onset <= this.soundEnd[j] + ENGINE.ECHO_MAX_DELAY + ENGINE.SELF_TAIL && !(this.vUnison.has(j) && this.vUnison.get(j) === k))
          return true;
      }
      return false;
    }
    // ---------------- main step ----------------
    step(tCenter, midiI, voicedI, now) {
      const piano = this.piano;
      const { times, midi, voiced } = this;
      times.push(tCenter);
      midi.push(midiI);
      voiced.push(voicedI);
      const i = times.length - 1;
      let newNotes = [];
      const kf = this.kf;
      let qWindow = null;
      if (kf) {
        const qPred = kf.qRef + (now - kf.x[0]) / kf.x[1];
        const width = 1 + 0.2 * Math.max(qPred - kf.qRef, 0);
        qWindow = [kf.qRef - 0.5, Math.max(qPred, kf.qRef) + width];
      }
      if (ENGINE.PAUSE_FREEZE && kf && this.pauseCheck(i, now)) {
        this.silentCount = voiced[i] ? 0 : this.silentCount + 1;
        this.prevSilent = !voiced[i] ? this.silentCount : this.prevSilent;
        return this.schedule(now);
      }
      const [s, post] = this.follower.step(midi[i], voiced[i], qWindow);
      const st = this.states[s];
      const typ = st.type;
      const k = st.k;
      this.state = [typ, k];
      this.silentCount = voiced[i] ? 0 : this.silentCount + 1;
      if (voiced[i] && i > 0 && !voiced[i - 1]) this.silentRun = this.prevSilent;
      this.prevSilent = !voiced[i] ? this.silentCount : this.prevSilent;
      if (kf && this.history.length && typ === "note" && k === this.lastK && k === this.history[this.history.length - 1][0] && voiced[i] && this.silentRun >= ENGINE.PAUSE_SILENCE_FRAMES && Math.abs(midi[i] - piano[k].pitch) < 0.6) {
        let j0 = i;
        while (j0 - 1 >= 0 && voiced[j0 - 1] && Math.abs(midi[j0 - 1] - piano[k].pitch) < 0.6) j0 -= 1;
        if (i - j0 + 1 === ENGINE.REENTRY_CONFIRM_FRAMES && times[j0] > this.events[this.events.length - 1][1] + 0.3) {
          this.restore(this.history[this.history.length - 1][1]);
          kf.reenter(piano[k].qn, times[j0]);
          this.events[this.events.length - 1] = [k, times[j0], now];
          this.silentRun = 0;
        }
      }
      const need = typ === "note" && k < this.lastK ? this.backConfirmFrames : ENGINE.CONFIRM_FRAMES;
      let confirmed = typ === "note" && k !== this.lastK && post > 0.5 && i >= need - 1;
      if (confirmed) {
        for (let j = 0; j < need; j++) {
          if (!(voiced[i - j] && Math.abs(midi[i - j] - piano[k].pitch) < 0.6)) {
            confirmed = false;
            break;
          }
        }
      }
      if (confirmed) {
        if (this.handleOnset(i, k, now) === "pending") return newNotes;
      }
      if (this.kf) newNotes = this.schedule(now);
      return newNotes;
    }
    // 像乐器的稳定音高（落在半音上、几帧内不变）/ a stable, semitone-locked pitch
    instrumentLike(i) {
      if (i < 4) return false;
      for (let j = i - 4; j <= i; j++) if (!this.voiced[j]) return false;
      const m = this.midi.slice(i - 4, i + 1);
      const mean = m.reduce((a, b) => a + b, 0) / m.length;
      const std = Math.sqrt(m.reduce((a, b) => a + (b - mean) ** 2, 0) / m.length);
      const last = m[m.length - 1];
      return Math.abs(last - Math.round(last)) < 0.3 && std < 0.15;
    }
    // 返回 true 表示处于停顿状态、这一帧不更新跟随器 / true = paused, skip the follower for this frame
    pauseCheck(i, now) {
      const kf = this.kf;
      const { piano, midi, voiced } = this;
      const kNext = this.nextPiano(kf.qRef);
      const cands = [this.lastK, kNext, kNext === null ? null : kNext + 1].filter(
        (kk) => kk !== null && kk >= 0 && kk < piano.length
      );
      const resume = cands.filter((kk) => kk !== this.lastK);
      const match = voiced[i] && cands.some((kk) => Math.abs(midi[i] - piano[kk].pitch) < 0.6);
      if (match) this.lastMatchT = now;
      if (!this.paused) {
        const overdue = kNext !== null && !this.restBefore[kNext] && now > kf.predictTime(this.pQ[kNext]) + this.patience(kNext);
        if (overdue && now - this.lastMatchT >= ENGINE.PAUSE_SEC && this.lastK >= 0) {
          this.paused = true;
          this.offscore = 0;
          const a = new Float64Array(this.follower.S);
          a[this.noteState.get(this.lastK)] = 1;
          this.follower.alpha = a;
        } else {
          return false;
        }
      }
      if (voiced[i] && resume.some((kk) => Math.abs(midi[i] - piano[kk].pitch) < 0.6)) return false;
      if (this.instrumentLike(i)) {
        this.offscore += 1;
        if (this.offscore >= ENGINE.UNFREEZE_FRAMES) {
          this.paused = false;
          const qPred = kf.qRef + (now - kf.x[0]) / kf.x[1];
          const hi = Math.max(qPred, kf.qRef) + 1 + 0.2 * Math.max(qPred - kf.qRef, 0);
          const f = this.follower;
          const inside = new Float64Array(f.S);
          let n = 0;
          for (let s = 0; s < f.S; s++) {
            if (f.isNote[s] && f.qEnd[s] >= kf.qRef - 0.5 && f.qStart[s] <= hi) {
              inside[s] = 1;
              n += 1;
            }
          }
          if (n > 0) f.alpha = inside.map((v) => v / n);
          return false;
        }
      }
      return true;
    }
    handleOnset(i, k, now) {
      const { piano, pQ, s0, times, midi, voiced } = this;
      let j0 = i;
      while (j0 - 1 >= Math.max(0, i - 40) && voiced[j0 - 1] && Math.abs(midi[j0 - 1] - piano[k].pitch) < 0.6) j0 -= 1;
      const onset = times[j0];
      const q = piano[k].qn;
      if (!this.kf) {
        if (k < this.lastK) this.cand = this.cand.filter((c) => c[0] < k);
        this.cand.push([k, onset, now]);
        this.lastK = k;
        if (this.cand.length >= 3) {
          const [[k1, t1], [k2, t2], [k3, t3]] = this.cand.slice(-3);
          const q1 = pQ[k1];
          const q2 = pQ[k2];
          const q3 = pQ[k3];
          const pairs = [
            [q1, t1, q2, t2],
            [q2, t2, q3, t3]
          ];
          const ok = q2 - q1 > 0 && q2 - q1 <= 3 && q3 - q2 > 0 && q3 - q2 <= 3 && pairs.every(([qa, ta, qb, tb]) => {
            const r = (tb - ta) / (qb - qa);
            return 0.5 * s0 <= r && r <= 2 * s0;
          });
          if (ok) {
            const [slope, icpt] = polyfit1([q1, q2, q3], [t1, t2, t3]);
            this.kf = new TempoKalman(q3, slope * q3 + icpt, Math.min(Math.max(slope, 0.5 * s0), 2 * s0));
            this.events.push(...this.cand.slice(-3));
            this.follower.setTempo(this.kf.x[1]);
          }
        }
        return;
      }
      const kf = this.kf;
      if (k < this.lastK) {
        const undo = this.history.filter((h) => h[0] >= k && now - h[2] < 2);
        if (undo.length && undo.length === this.history.filter((h) => h[0] >= k).length) {
          this.restore(undo[0][1]);
          this.history = this.history.filter((h) => h[0] < k);
          this.events = this.events.filter((e) => e[0] < k);
          this.lastK = this.history.length ? this.history[this.history.length - 1][0] : k - 1;
          this.rejected = [];
        }
      }
      if (k <= this.lastK) return;
      if (this.skipNote[k]) {
        this.lastK = k;
        return;
      }
      const pred = kf.predictTime(q);
      const kNext = this.nextPiano(kf.qRef);
      const overdue = kNext !== null && now > kf.predictTime(pQ[kNext]) + this.patience(kNext);
      const rests = [];
      for (let j = 1; j <= k; j++) if (this.restBefore[j] && pQ[j] > kf.qRef) rests.push(j);
      if (rests.length && this.echoSounding(k, onset)) return;
      let isReentry = false;
      if (rests.length) {
        const jFirst = rests[rests.length - 1];
        const restSec = (pQ[jFirst] - (pQ[jFirst - 1] + piano[jFirst - 1].dur)) * kf.x[1];
        isReentry = k <= jFirst + 1 && -(0.3 + 0.5 * restSec) <= onset - pred;
      } else if ((this.paused || overdue && this.silentRun >= ENGINE.PAUSE_SILENCE_FRAMES) && kNext !== null && k <= kNext + 1 && onset >= pred - 0.15) {
        isReentry = true;
      }
      if (isReentry && i - j0 + 1 < ENGINE.REENTRY_CONFIRM_FRAMES) return "pending";
      if (isReentry) {
        this.history.push([k, this.snapshot(), now]);
        kf.reenter(q, onset);
        this.events.push([k, onset, now]);
        this.lastK = k;
        this.rejected = [];
        this.paused = false;
      } else {
        const base = 0.15 + 0.15 * kf.x[1] * Math.max(q - kf.qRef, 0);
        let early;
        if (k === kNext) early = 0.3 + 0.6 * kf.x[1] * Math.max(q - kf.qRef, 0);
        else if (kNext !== null && k === kNext + 1) early = 2 * base;
        else early = base;
        const dt = onset - pred;
        if (-early <= dt && dt <= (3 * base + 0.5) * (1 + this.rejected.length)) {
          this.history.push([k, this.snapshot(), now]);
          kf.update(q, onset);
          this.events.push([k, onset, now]);
          this.lastK = k;
          this.rejected = [];
        } else if (!this.rejected.length || this.rejected[this.rejected.length - 1][0] !== k) {
          this.rejected.push([k, onset, now]);
          if (this.rejected.length >= 4) {
            const last4 = this.rejected.slice(-4);
            const ks = last4.map((r) => r[0]);
            const qs = ks.map((kk) => pQ[kk]);
            const ts = last4.map((r) => r[1]);
            const [slope, icpt] = polyfit1(qs, ts);
            const resid = Math.max(...ts.map((t, n) => Math.abs(t - (slope * qs[n] + icpt))));
            const steps = ks.slice(1).every((b, n) => b - ks[n] > 0 && b - ks[n] <= 2);
            if (steps && resid < 0.08 && 0.5 * s0 <= slope && slope <= 2 * s0) {
              this.kf = new TempoKalman(qs[3], slope * qs[3] + icpt, slope);
              this.events.push(...last4);
              this.history = [];
              this.lastK = ks[3];
              this.rejected = [];
            } else {
              this.rejected = this.rejected.slice(-3);
            }
          }
        }
      }
      this.follower.setTempo(this.kf.x[1]);
    }
    schedule(now) {
      const kNext = this.nextPiano(this.kf.qRef);
      const cap = kNext === null ? void 0 : this.noWaitCap.get(kNext);
      if (cap !== void 0 && this.mode === "strict") return this.scheduleCore(now, kNext, cap, false);
      return this.scheduleCore(now, kNext, this.violin.length, this.mode === "strict");
    }
    scheduleCore(now, kNext, limit, strict) {
      const kf = this.kf;
      const { pQ, vQ, violin, committed } = this;
      const newNotes = [];
      let holdFrom = Infinity;
      if (strict && kNext !== null) {
        if (this.restBefore[kNext]) holdFrom = pQ[kNext];
        else if (now > kf.predictTime(pQ[kNext]) + this.patience(kNext)) holdFrom = pQ[kNext];
      }
      if (holdFrom < Infinity && this.nxt < limit && vQ[this.nxt] >= holdFrom - 1e-6) this.resync = true;
      while (this.nxt < limit && vQ[this.nxt] < holdFrom - 1e-6) {
        const nxt = this.nxt;
        const tau = kf.predictTime(vQ[nxt]);
        const prev = this.lastPlayed;
        let tPlan;
        if (ENGINE.SMOOTHING && prev !== null && !this.resync) {
          const dq = vQ[nxt] - vQ[prev];
          const nominal = kf.x[1] * dq;
          const tFree = committed[prev] + nominal;
          let frac = 1 - (1 - ENGINE.ALPHA) ** dq;
          if (Math.abs(tFree - tau) > ENGINE.RESYNC_QN * kf.x[1]) frac = 1;
          tPlan = tFree - frac * (tFree - tau);
          if (frac < 1) {
            tPlan = Math.min(
              Math.max(tPlan, committed[prev] + ENGINE.IOI_MIN * nominal),
              committed[prev] + ENGINE.IOI_MAX * nominal
            );
          }
          const behind = tPlan - tau;
          if (behind > ENGINE.SKIP_BEHIND_QN * kf.x[1] && !this.vWithPiano[nxt]) {
            this.nxt += 1;
            this.skippedCount += 1;
            continue;
          }
        } else {
          tPlan = tau;
        }
        if (ENGINE.SMOOTHING && ENGINE.SNAP_GUARD && this.resync && prev !== null) {
          tPlan = Math.max(tPlan, committed[prev] + ENGINE.IOI_MIN * kf.x[1] * (vQ[nxt] - vQ[prev]));
        }
        if (tPlan < now - ENGINE.LATE_DROP) {
          this.nxt += 1;
          this.skippedCount += 1;
          continue;
        }
        if (tPlan - now > this.commitHorizon) break;
        let tPlay = Math.max(tPlan, now);
        if (!ENGINE.SMOOTHING && prev !== null) {
          tPlay = Math.max(tPlay, committed[prev] + ENGINE.MIN_IOI_RATIO * kf.x[1] * (vQ[nxt] - vQ[prev]));
        }
        committed[nxt] = tPlay;
        this.soundEnd[nxt] = tPlay + violin[nxt].dur * kf.x[1];
        newNotes.push([nxt, tPlay]);
        this.lastPlayed = nxt;
        this.resync = false;
        this.nxt += 1;
      }
      return newNotes;
    }
    finished() {
      return this.nxt >= this.violin.length;
    }
  };

  // src/lib/accompaniment/pitch.ts
  var SR = 16e3;
  var HOP = 160;
  var W = 512;
  var TMAX = Math.floor(SR / 150) + 2;
  var TMIN = Math.floor(SR / 1100);
  var L = W + TMAX;
  var YIN_THRESHOLD = 0.2;
  var D_SCRATCH = new Float64Array(TMAX + 1);
  var C_SCRATCH = new Float64Array(TMAX + 1);
  function yinFrame(f, offset = 0) {
    const d = D_SCRATCH;
    for (let tau = 1; tau <= TMAX; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const diff = f[offset + j] - f[offset + j + tau];
        s += diff * diff;
      }
      d[tau] = s;
    }
    const c = C_SCRATCH;
    c[0] = 1;
    let cum = 0;
    for (let tau = 1; tau <= TMAX; tau++) {
      cum += d[tau];
      c[tau] = d[tau] * tau / Math.max(cum, 1e-12);
    }
    let t = -1;
    for (let tau = TMIN; tau <= TMAX; tau++) {
      if (c[tau] < YIN_THRESHOLD) {
        t = tau;
        break;
      }
    }
    if (t < 0) {
      t = TMIN;
      for (let tau = TMIN + 1; tau <= TMAX; tau++) if (c[tau] < c[t]) t = tau;
    }
    while (t + 1 <= TMAX && c[t + 1] < c[t]) t += 1;
    let off = 0;
    if (t >= 1 && t < TMAX) {
      const den = c[t - 1] - 2 * c[t] + c[t + 1];
      if (den !== 0) off = 0.5 * (c[t - 1] - c[t + 1]) / den;
    }
    const f0 = SR / (t + off);
    let e = 0;
    for (let j = 0; j < W; j++) e += f[offset + j] * f[offset + j];
    const edb = 20 * Math.log10(Math.sqrt(e / W) + 1e-9);
    return [69 + 12 * Math.log2(f0 / 440), c[t], edb];
  }
  function firwin(numtaps, cutoff) {
    const h = new Float64Array(numtaps);
    const mid = (numtaps - 1) / 2;
    let sum = 0;
    for (let n = 0; n < numtaps; n++) {
      const m = n - mid;
      const x = cutoff * m;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const win = 0.54 - 0.46 * Math.cos(2 * Math.PI * n / (numtaps - 1));
      h[n] = cutoff * sinc * win;
      sum += h[n];
    }
    for (let n = 0; n < numtaps; n++) h[n] /= sum;
    return h;
  }
  function iirnotch(f, q, fs) {
    const w0 = 2 * f / fs * Math.PI;
    const bw = w0 / q;
    const gb = 1 / Math.SQRT2;
    const beta = Math.sqrt(1 - gb * gb) / gb * Math.tan(bw / 2);
    const gain = 1 / (1 + beta);
    return [
      [gain, -2 * gain * Math.cos(w0), gain],
      [1, -2 * gain * Math.cos(w0), 2 * gain - 1]
    ];
  }
  var NOTCH_Q = 20;
  var StreamingPitch = class {
    constructor(srIn = SR) {
      __publicField(this, "factor");
      __publicField(this, "fir", null);
      __publicField(this, "hist", null);
      // 滤波器状态：最近的输入样本 / filter state: recent inputs
      __publicField(this, "delay");
      // 滤波器群延迟（秒）/ filter group delay (s)
      __publicField(this, "phase", 0);
      __publicField(this, "buf", new Float32Array(0));
      __publicField(this, "base", 0);
      // buf[0] 对应的 16 kHz 样本序号 / 16 kHz sample index of buf[0]
      __publicField(this, "frame", 0);
      __publicField(this, "n16", 0);
      // 已处理的 16 kHz 样本数 / 16 kHz samples so far
      __publicField(this, "notchKey", "");
      __publicField(this, "notchSos", []);
      __publicField(this, "notchZi", []);
      if (srIn % SR !== 0) throw new Error(`input sample rate ${srIn} must be a multiple of ${SR}`);
      this.factor = srIn / SR;
      if (this.factor > 1) {
        this.fir = firwin(8 * this.factor * 2 + 1, 0.9 / this.factor);
        this.hist = new Float64Array(this.fir.length - 1);
        this.delay = (this.fir.length - 1) / 2 / srIn;
      } else {
        this.delay = 0;
      }
    }
    // 因果 FIR 滤波（与 scipy.signal.lfilter 带状态时相同），再每 factor 个取一个
    // Causal FIR filtering (same as scipy.signal.lfilter with state), then keep every factor-th sample
    decimate(x) {
      if (this.factor === 1 || !this.fir || !this.hist) return x;
      const fir = this.fir;
      const hist = this.hist;
      const nt = fir.length;
      const out = [];
      for (let i = 0; i < x.length; i++) {
        if ((i - this.phase) % this.factor === 0 && i >= this.phase) {
          let y = 0;
          for (let j = 0; j < nt; j++) {
            const idx = i - j;
            y += fir[j] * (idx >= 0 ? x[idx] : hist[hist.length + idx]);
          }
          out.push(y);
        }
      }
      const keep = nt - 1;
      if (x.length >= keep) {
        for (let j = 0; j < keep; j++) hist[j] = x[x.length - keep + j];
      } else {
        hist.copyWithin(0, x.length);
        for (let j = 0; j < x.length; j++) hist[keep - x.length + j] = x[j];
      }
      this.phase = ((this.phase - x.length) % this.factor + this.factor) % this.factor;
      return Float32Array.from(out);
    }
    // 在给定频率上陷波；频率组合变化时重新设计滤波器并清零状态（与 Python 相同）
    // Notch at the given frequencies; redesign and reset the state when the set changes (as in Python)
    notch(y, freqs) {
      const key = freqs.map((f) => f.toFixed(1)).join(",");
      if (key !== this.notchKey) {
        this.notchKey = key;
        this.notchSos = freqs.map((f) => iirnotch(f, NOTCH_Q, SR));
        this.notchZi = freqs.map(() => new Float64Array(2));
      }
      if (!this.notchSos.length) return y;
      const out = new Float32Array(y.length);
      for (let i = 0; i < y.length; i++) {
        let v = y[i];
        for (let s = 0; s < this.notchSos.length; s++) {
          const [b, a] = this.notchSos[s];
          const z = this.notchZi[s];
          const w = b[0] * v + z[0];
          z[0] = b[1] * v - a[1] * w + z[1];
          z[1] = b[2] * v - a[2] * w;
          v = w;
        }
        out[i] = v;
      }
      return out;
    }
    push(x, notchFreqs) {
      let y = this.decimate(x);
      if (notchFreqs) y = this.notch(y, notchFreqs(this.n16 / SR));
      this.n16 += y.length;
      const merged = new Float32Array(this.buf.length + y.length);
      merged.set(this.buf, 0);
      merged.set(y, this.buf.length);
      this.buf = merged;
      const out = [];
      for (; ; ) {
        const start = this.frame * HOP - this.base;
        if (start + L > this.buf.length) break;
        const [m, ap, edb] = yinFrame(this.buf, start);
        out.push({ t: (this.frame * HOP + L / 2) / SR - this.delay, midi: m, aperiodicity: ap, energyDb: edb });
        this.frame += 1;
      }
      const drop = this.frame * HOP - this.base;
      if (drop > 0) {
        this.buf = this.buf.slice(drop);
        this.base += drop;
      }
      return out;
    }
  };

  // src/lib/accompaniment/session.ts
  var COMMIT_EXTRA = 0.02;
  var END_SILENCE = 3;
  var AccompanimentSession = class {
    // 伴奏音的结束时间有变化 / a note's end time changed
    constructor(engine, options) {
      __publicField(this, "engine");
      __publicField(this, "opts");
      __publicField(this, "pitch", null);
      __publicField(this, "samplesIn", 0);
      __publicField(this, "frames", []);
      __publicField(this, "notes", /* @__PURE__ */ new Map());
      // 每个已发声的伴奏音 / every accompaniment note played
      __publicField(this, "open", /* @__PURE__ */ new Set());
      // 结束时间还可能改的音 / notes whose end may still change
      __publicField(this, "lastVoicedT", 0);
      __publicField(this, "masked", 0);
      __publicField(this, "onNote", null);
      // 新的伴奏音 / a new accompaniment note
      __publicField(this, "onNoteOff", null);
      this.opts = {
        latency: 0,
        selfMask: false,
        selfNotch: false,
        voicingDb: 15,
        aperiodicityMax: 0.25,
        cutSustainOnSkip: false,
        engine: {},
        ...options
      };
      this.engine = engine;
      this.engine.commitHorizon = this.opts.latency + COMMIT_EXTRA;
    }
    // 扬声器模式下需要陷波的频率（默认不陷波）/ frequencies to notch in loudspeaker mode (none by default)
    notchFreqs(_t) {
      return [];
    }
    feed(block, sr) {
      if (!this.pitch) this.pitch = new StreamingPitch(sr);
      this.samplesIn += block.length;
      const nowIn = this.samplesIn / sr;
      const eng = this.engine;
      const { noiseDb, tuning, voicingDb, aperiodicityMax, selfMask } = this.opts;
      const notch = this.opts.selfNotch ? (t) => this.notchFreqs(t) : void 0;
      for (const f of this.pitch.push(block, notch)) {
        let voiced = f.aperiodicity < aperiodicityMax && f.energyDb > noiseDb + voicingDb;
        const m = f.midi - tuning;
        if (voiced && selfMask && eng.isSelfSound(f.t, m, voiced)) {
          voiced = false;
          this.masked += 1;
        }
        if (voiced) this.lastVoicedT = f.t;
        this.frames.push({ t: f.t, midi: m, voiced });
        const avail = f.t + L / 2 / SR;
        const skippedBefore = eng.skippedCount;
        for (const [j, tPlay] of eng.step(f.t, m, voiced, Math.max(avail, nowIn))) this.play(j, tPlay);
        if (this.opts.cutSustainOnSkip && eng.skippedCount > skippedBefore) this.cutOpenNotes();
      }
      return nowIn;
    }
    // 下一个音被跳过：仍在暂定延长中的音，改回按乐谱时值结束 / the next note was skipped: end held notes at their written length
    cutOpenNotes() {
      for (const p of Array.from(this.open)) {
        const ev = this.notes.get(p);
        if (!ev || ev.nominalEnd === void 0) continue;
        const next = this.engine.committed[p + 1];
        if (Number.isFinite(next)) continue;
        if (ev.off > ev.nominalEnd + 1e-6) {
          ev.off = ev.nominalEnd;
          this.open.delete(p);
          this.onNoteOff?.(ev);
        }
      }
    }
    done(nowIn) {
      const eng = this.engine;
      if (!eng.finished()) return false;
      let last = 0;
      let any = false;
      for (const v of eng.committed) {
        if (Number.isFinite(v)) {
          last = any ? Math.max(last, v) : v;
          any = true;
        }
      }
      return nowIn > Math.max(last, this.lastVoicedT) + END_SILENCE;
    }
  };
  var NOTCH_HARMONICS = 8;
  var DuetSession = class extends AccompanimentSession {
    constructor(score, secPerQnMidi, options) {
      super(new FollowerEngine(score, secPerQnMidi, "strict", options.engine ?? {}), options);
      this.engine.selfCheck = this.opts.selfMask && this.opts.selfNotch;
    }
    // 此刻正在发声的伴奏音的泛音（与你此刻应弹的音同音时不处理）（与 Python 的 notch_freqs 相同）
    // Harmonics of accompaniment notes sounding at time t, skipped when it is your expected pitch (as Python notch_freqs)
    notchFreqs(t) {
      const eng = this.engine;
      if (eng.lastPlayed === null) return [];
      const expected = eng.expectedNotes();
      const freqs = /* @__PURE__ */ new Set();
      for (let j = Math.max(0, eng.lastPlayed - 6); j <= eng.lastPlayed; j++) {
        const tOn = eng.committed[j];
        const ev = this.notes.get(j);
        const tOff = ev ? ev.off : NaN;
        const end = (Number.isFinite(tOff) ? tOff : tOn + 1) + 0.35;
        if (!Number.isFinite(tOn) || !(tOn - 0.03 <= t && t <= end) || !eng.ownNote(j, expected)) continue;
        const f0 = 440 * 2 ** ((eng.violin[j].pitch + this.opts.tuning - 69) / 12);
        for (let h = 1; h <= NOTCH_HARMONICS; h++) if (h * f0 < 0.47 * SR) freqs.add(Math.round(h * f0 * 10) / 10);
      }
      return [...freqs].sort((a, b) => a - b);
    }
    play(j, tPlay) {
      const violin = this.engine.violin;
      const n = violin[j];
      const s = this.engine.kf.x[1];
      const nominalEnd = tPlay + (n.final ? Math.max(1.5, n.dur * s) : n.dur * s);
      let tentative = nominalEnd;
      const qO = (x) => x.qnOrig ?? x.qn;
      const next = j + 1 < violin.length ? violin[j + 1] : null;
      if (next && qO(next) - (qO(n) + (n.durOrig ?? n.dur)) < 0.05) {
        tentative = nominalEnd + ENGINE.SUSTAIN_MAX;
      }
      for (const prev of Array.from(this.open)) {
        if (prev >= j) continue;
        const ev2 = this.notes.get(prev);
        this.open.delete(prev);
        const newOff = Math.min(ev2.off, tPlay - 0.02);
        if (Math.abs(newOff - ev2.off) > 1e-6) {
          ev2.off = newOff;
          this.onNoteOff?.(ev2);
        }
      }
      const ev = { j, pitch: n.pitch, velocity: n.vel, on: tPlay, off: tentative, nominalEnd };
      this.notes.set(j, ev);
      this.open.add(j);
      this.onNote?.(ev);
    }
  };

  // src/lib/accompaniment/orchestra.ts
  var DETECTION_DELAY = 0.05;
  var AUTO_THRESHOLD = 0.15;
  function parseOrchestra(raw, warp) {
    const notes = raw.notes.map((n) => ({
      voice: n.voice,
      qn: n.qn,
      dur: n.dur_qn,
      pitch: n.pitch,
      vel: n.velocity,
      measure: n.measure,
      beat: n.beat_eighth,
      final: n.final,
      pos: n.pos
    }));
    const groups = raw.positions.map(() => []);
    for (const n of notes) groups[n.pos].push(n);
    let f = null;
    if (warp) {
      const [knotQ, knotW] = warp;
      const kq = [-1e3, ...knotQ, knotQ[knotQ.length - 1] + 1e3];
      const kw = [knotW[0] - (knotQ[0] + 1e3), ...knotW, knotW[knotW.length - 1] + 1e3];
      f = (q) => interp(q, kq, kw);
    }
    const positions = groups.map((g, i) => {
      const q = g[0].qn;
      const dur = Math.max(...g.map((n) => n.dur));
      const solo = g.filter((n) => n.voice === 0);
      const rep = solo.length ? solo[0] : g.reduce((a2, b2) => b2.pitch > a2.pitch ? b2 : a2);
      const [a, b] = f ? [f(q), f(q + dur)] : [q, q + dur];
      return {
        index: i + 1,
        qn: a,
        dur: Math.max(b - a, 1e-3),
        qnOrig: q,
        durOrig: dur,
        pitch: rep.pitch,
        vel: Math.max(...g.map((n) => n.vel)),
        final: g[0].final,
        measure: g[0].measure,
        beat: g[0].beat
      };
    });
    const voices = raw.voices.map((v) => ({ name: v.name, channel: v.channel, program: v.gm_program_0based, gain: v.gain }));
    return { voices, notes, groups, positions, beatQn: raw.beat_qn };
  }
  var OrchestraEngine = class extends FollowerEngine {
    constructor(score, secPerQnMidi, orch, latency, options = {}) {
      super(score, secPerQnMidi, "strict", options);
      __publicField(this, "posPitches");
      __publicField(this, "latency");
      __publicField(this, "entryMode", "auto");
      __publicField(this, "beatQn");
      __publicField(this, "pre", null);
      __publicField(this, "entryUsed", null);
      this.posPitches = orch.groups.map((g) => g.map((n) => n.pitch));
      this.beatQn = orch.beatQn;
      this.vUnison = /* @__PURE__ */ new Map();
      this.violin.forEach((vn, j) => {
        this.piano.forEach((pn, k) => {
          if (Math.abs(vn.qn - pn.qn) < 1e-6 && this.posPitches[j].includes(pn.pitch)) this.vUnison.set(j, k);
        });
      });
      this.latency = latency;
    }
    expPitches() {
      return new Set(Array.from(this.expectedNotes(), (k) => this.piano[k].pitch));
    }
    ownNote(j, expected) {
      const expP = new Set(Array.from(expected, (k) => this.piano[k].pitch));
      return this.posPitches[j].some((p) => !expP.has(p));
    }
    isSelfSound(t, midi, voiced, tol = 0.6, tail = ENGINE.SELF_TAIL) {
      if (!voiced || this.lastPlayed === null) return false;
      const expP = this.expPitches();
      for (let j = Math.max(0, this.lastPlayed - 8); j <= this.lastPlayed; j++) {
        if (Number.isFinite(this.committed[j]) && this.committed[j] - 0.05 <= t && t <= this.soundEnd[j] + tail) {
          if (this.posPitches[j].some((p) => Math.abs(midi - p) < tol && !expP.has(p))) return true;
        }
      }
      return false;
    }
    echoSounding(k, onset, tol = 0.6) {
      if (!this.selfCheck || this.lastPlayed === null) return false;
      const p = this.piano[k].pitch;
      for (let j = Math.max(0, this.lastPlayed - 8); j <= this.lastPlayed; j++) {
        const tOn = this.committed[j];
        if (Number.isFinite(tOn) && this.posPitches[j].some((q) => Math.abs(q - p) < tol) && tOn - 0.06 <= onset && onset <= this.soundEnd[j] + ENGINE.ECHO_MAX_DELAY + ENGINE.SELF_TAIL && !(this.vUnison.has(j) && this.vUnison.get(j) === k))
          return true;
      }
      return false;
    }
    step(tCenter, midiI, voicedI, now) {
      const out = super.step(tCenter, midiI, voicedI, now);
      if (!this.kf && this.cand.length) out.push(...this.preroll(now));
      return out;
    }
    // 还没锁定速度时，乐队按惯常速度从第一个音开始演奏 / before the tempo is locked, play at the usual tempo
    preroll(now) {
      if (!this.pre) {
        const [k0, t02] = this.cand[0];
        const q02 = this.pQ[k0];
        const q0Orig = this.piano[k0].qnOrig ?? q02;
        let mode = this.entryMode;
        if (mode === "auto") mode = this.latency + DETECTION_DELAY < AUTO_THRESHOLD ? "first_note" : "next_beat";
        const startOrig = mode === "first_note" ? q0Orig : q0Orig + this.beatQn;
        while (this.nxt < this.violin.length && this.violin[this.nxt].qnOrig < startOrig - 1e-6) this.nxt += 1;
        this.pre = [q02, t02];
        this.entryUsed = mode;
      }
      const [q0, t0] = this.pre;
      const out = [];
      while (this.nxt < this.violin.length) {
        const j = this.nxt;
        const tau = t0 + (this.vQ[j] - q0) * this.s0;
        if (tau - now > this.commitHorizon) break;
        const tPlay = Math.max(tau, now);
        this.committed[j] = tPlay;
        this.soundEnd[j] = tPlay + this.violin[j].dur * this.s0;
        this.lastPlayed = j;
        this.resync = false;
        this.nxt += 1;
        out.push([j, tPlay]);
      }
      return out;
    }
  };
  var OrchestraSession = class extends AccompanimentSession {
    constructor(score, secPerQnMidi, orch, options) {
      const engine = new OrchestraEngine({ ...score, violin: orch.positions }, secPerQnMidi, orch, options.latency ?? 0, options.engine ?? {});
      super(engine, options);
      __publicField(this, "orch");
      __publicField(this, "noteTimes", /* @__PURE__ */ new Map());
      // "位置,声部,音高" -> [开始, 结束]
      __publicField(this, "onOrchNote", null);
      this.orch = orch;
      this.engine.selfCheck = this.opts.selfMask && !!options.speaker;
    }
    play(j, tPlay) {
      const eng = this.engine;
      const s = eng.kf ? eng.kf.x[1] : eng.s0;
      for (const n of this.orch.groups[j]) {
        const dur = n.final ? Math.max(1.5, n.dur * s) : n.dur * s;
        const tOff = tPlay + Math.max(dur - 0.02, 0.05);
        this.noteTimes.set(`${j},${n.voice},${n.pitch}`, [tPlay, tOff]);
        this.onOrchNote?.({
          j,
          pitch: n.pitch,
          velocity: n.vel,
          on: tPlay,
          off: tOff,
          voice: n.voice,
          channel: this.orch.voices[n.voice].channel
        });
      }
    }
  };

  // src/lib/accompaniment/sf2.ts
  var GEN = {
    startAddrsOffset: 0,
    endAddrsOffset: 1,
    startloopAddrsOffset: 2,
    endloopAddrsOffset: 3,
    startAddrsCoarseOffset: 4,
    endAddrsCoarseOffset: 12,
    pan: 17,
    delayVolEnv: 33,
    attackVolEnv: 34,
    holdVolEnv: 35,
    decayVolEnv: 36,
    sustainVolEnv: 37,
    releaseVolEnv: 38,
    instrument: 41,
    keyRange: 43,
    velRange: 44,
    startloopAddrsCoarseOffset: 45,
    initialAttenuation: 48,
    endloopAddrsCoarseOffset: 50,
    coarseTune: 51,
    fineTune: 52,
    sampleID: 53,
    sampleModes: 54,
    scaleTuning: 56,
    overridingRootKey: 58
  };
  var DEFAULTS = {
    [GEN.delayVolEnv]: -12e3,
    [GEN.attackVolEnv]: -12e3,
    [GEN.holdVolEnv]: -12e3,
    [GEN.decayVolEnv]: -12e3,
    [GEN.sustainVolEnv]: 0,
    [GEN.releaseVolEnv]: -12e3,
    [GEN.scaleTuning]: 100,
    [GEN.overridingRootKey]: -1
  };
  var timecents = (tc) => 2 ** (tc / 1200);
  var SoundFont = class {
    constructor(buffer) {
      __publicField(this, "data");
      // 全部采样，已换算到 -1…1 / all sample data scaled to -1…1
      __publicField(this, "samples", []);
      __publicField(this, "instruments", []);
      __publicField(this, "presets", []);
      const view = new DataView(buffer);
      const tag = (o) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
      if (tag(0) !== "RIFF" || tag(8) !== "sfbk") throw new Error("not a SoundFont 2 file");
      const lists = /* @__PURE__ */ new Map();
      for (let o = 12; o < view.byteLength; ) {
        const id = tag(o);
        const size = view.getUint32(o + 4, true);
        if (id === "LIST") {
          const sub = /* @__PURE__ */ new Map();
          for (let p = o + 12; p < o + 8 + size; ) {
            const sid = tag(p);
            const ss2 = view.getUint32(p + 4, true);
            sub.set(sid, [p + 8, ss2]);
            p += 8 + ss2 + (ss2 & 1);
          }
          lists.set(tag(o + 8), sub);
        }
        o += 8 + size + (size & 1);
      }
      const sdta = lists.get("sdta");
      const pdta = lists.get("pdta");
      if (!sdta || !pdta) throw new Error("incomplete SoundFont");
      const [so, ss] = sdta.get("smpl");
      this.data = new Float32Array(ss / 2);
      for (let i = 0; i < this.data.length; i++) this.data[i] = view.getInt16(so + 2 * i, true) / 32768;
      const str = (o, n) => {
        let s = "";
        for (let i = 0; i < n; i++) {
          const c = view.getUint8(o + i);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s;
      };
      const recs = (name, size) => {
        const [o, s] = pdta.get(name);
        return Array.from({ length: s / size }, (_, i) => o + i * size);
      };
      for (const o of recs("shdr", 46).slice(0, -1)) {
        this.samples.push({
          name: str(o, 20),
          start: view.getUint32(o + 20, true),
          end: view.getUint32(o + 24, true),
          loopStart: view.getUint32(o + 28, true),
          loopEnd: view.getUint32(o + 32, true),
          rate: view.getUint32(o + 36, true),
          originalPitch: view.getUint8(o + 40),
          pitchCorrection: view.getInt8(o + 41)
        });
      }
      const readGens = (gens, from, to) => {
        const m = /* @__PURE__ */ new Map();
        for (let g = from; g < to; g++) {
          const o = gens[g];
          const oper = view.getUint16(o, true);
          const raw = oper === GEN.keyRange || oper === GEN.velRange ? view.getUint16(o + 2, true) : view.getInt16(o + 2, true);
          m.set(oper, raw);
        }
        return m;
      };
      const toZone = (m) => {
        const kr = m.get(GEN.keyRange) ?? 32512;
        const vr = m.get(GEN.velRange) ?? 32512;
        return { keyLo: kr & 255, keyHi: kr >> 8, velLo: vr & 255, velHi: vr >> 8, gens: m };
      };
      const readLevel = (hdr, bags, gens, bagIdx, terminal) => {
        const out = [];
        for (let h = 0; h < hdr.length - 1; h++) {
          const b0 = bagIdx(hdr[h]);
          const b1 = bagIdx(hdr[h + 1]);
          let global = /* @__PURE__ */ new Map();
          const zones = [];
          for (let b = b0; b < b1; b++) {
            const g0 = view.getUint16(bags[b], true);
            const g1 = view.getUint16(bags[b + 1], true);
            const m = readGens(gens, g0, g1);
            const isTerminal = m.has(terminal === "sample" ? GEN.sampleID : GEN.instrument);
            if (!isTerminal && b === b0) global = m;
            else if (isTerminal) zones.push(toZone(m));
          }
          out.push({ hdr: hdr[h], global, zones });
        }
        return out;
      };
      const inst = recs("inst", 22);
      for (const r of readLevel(inst, recs("ibag", 4), recs("igen", 4), (o) => view.getUint16(o + 20, true), "sample")) {
        this.instruments.push({ name: str(r.hdr, 20), global: r.global, zones: r.zones });
      }
      const phdr = recs("phdr", 38);
      for (const r of readLevel(phdr, recs("pbag", 4), recs("pgen", 4), (o) => view.getUint16(o + 24, true), "instrument")) {
        this.presets.push({
          name: str(r.hdr, 20),
          program: view.getUint16(r.hdr + 20, true),
          bank: view.getUint16(r.hdr + 22, true),
          global: r.global,
          zones: r.zones
        });
      }
    }
    presetNames() {
      return this.presets.map((p) => `${p.bank}:${p.program} ${p.name}`);
    }
    // 找出某个音要用的采样区，并合并参数 / find the sample zones for a note and merge their generators
    voicesFor(bank, program, key, vel) {
      const preset = this.presets.find((p) => p.bank === bank && p.program === program);
      if (!preset) return [];
      const out = [];
      const inRange = (z) => key >= z.keyLo && key <= z.keyHi && vel >= z.velLo && vel <= z.velHi;
      for (const pz of preset.zones) {
        if (!inRange(pz)) continue;
        const instrument = this.instruments[pz.gens.get(GEN.instrument)];
        for (const iz of instrument.zones) {
          if (!inRange(iz)) continue;
          const ig = (g) => iz.gens.get(g) ?? instrument.global.get(g) ?? DEFAULTS[g] ?? 0;
          const pg = (g) => pz.gens.get(g) ?? preset.global.get(g) ?? 0;
          const v = (g) => ig(g) + pg(g);
          const sample = this.samples[iz.gens.get(GEN.sampleID)];
          const start = sample.start + ig(GEN.startAddrsOffset) + 32768 * ig(GEN.startAddrsCoarseOffset);
          const end = sample.end + ig(GEN.endAddrsOffset) + 32768 * ig(GEN.endAddrsCoarseOffset);
          const loopStart = sample.loopStart + ig(GEN.startloopAddrsOffset) + 32768 * ig(GEN.startloopAddrsCoarseOffset);
          const loopEnd = sample.loopEnd + ig(GEN.endloopAddrsOffset) + 32768 * ig(GEN.endloopAddrsCoarseOffset);
          const root = ig(GEN.overridingRootKey);
          out.push({
            sample,
            start,
            end,
            loopStart,
            loopEnd,
            loop: (ig(GEN.sampleModes) & 1) === 1,
            rootKey: root >= 0 ? root : sample.originalPitch,
            tuneCents: 100 * v(GEN.coarseTune) + v(GEN.fineTune) + sample.pitchCorrection,
            scaleTuning: v(GEN.scaleTuning),
            attenuationCb: v(GEN.initialAttenuation),
            pan: Math.max(-500, Math.min(500, v(GEN.pan))),
            delay: timecents(v(GEN.delayVolEnv)),
            attack: timecents(v(GEN.attackVolEnv)),
            hold: timecents(v(GEN.holdVolEnv)),
            decay: timecents(v(GEN.decayVolEnv)),
            sustainCb: Math.max(0, v(GEN.sustainVolEnv)),
            release: timecents(v(GEN.releaseVolEnv))
          });
        }
      }
      return out;
    }
  };

  // src/lib/accompaniment/synth.ts
  var Voice = class {
    constructor(spec, ch, key, gain, cents, sr) {
      __publicField(this, "spec");
      __publicField(this, "ch");
      __publicField(this, "key");
      __publicField(this, "step");
      // 每个输出样本前进多少个采样点 / sample points per output sample
      __publicField(this, "gainL");
      __publicField(this, "gainR");
      __publicField(this, "pos", 0);
      // 相对 spec.start 的位置 / position relative to spec.start
      __publicField(this, "t", 0);
      // 发声以来的输出样本数 / output samples since note-on
      __publicField(this, "released", false);
      __publicField(this, "releaseT", 0);
      __publicField(this, "releaseLevel", 1);
      __publicField(this, "level", 0);
      __publicField(this, "done", false);
      __publicField(this, "d");
      __publicField(this, "a");
      __publicField(this, "h");
      __publicField(this, "dec");
      __publicField(this, "rel");
      __publicField(this, "sustainDb");
      this.spec = spec;
      this.ch = ch;
      this.key = key;
      this.step = 2 ** (((key - spec.rootKey) * spec.scaleTuning + spec.tuneCents + cents) / 1200) * (spec.sample.rate / sr);
      const angle = (spec.pan + 500) / 1e3 * (Math.PI / 2);
      this.gainL = gain * Math.cos(angle);
      this.gainR = gain * Math.sin(angle);
      this.d = spec.delay * sr;
      this.a = Math.max(1, spec.attack * sr);
      this.h = spec.hold * sr;
      this.dec = Math.max(1, spec.decay * sr);
      this.rel = Math.max(1, spec.release * sr);
      this.sustainDb = -spec.sustainCb / 10;
    }
    // 音量包络：起音线性上升，衰减和释放按分贝直线下降（96 dB / 设定时间）
    // Volume envelope: linear attack; decay and release fall linearly in dB (96 dB over the set time)
    envelope() {
      const t = this.t;
      let lv;
      if (t < this.d) lv = 0;
      else if (t < this.d + this.a) lv = (t - this.d) / this.a;
      else if (t < this.d + this.a + this.h) lv = 1;
      else {
        const db = Math.max(-96 * (t - this.d - this.a - this.h) / this.dec, this.sustainDb);
        lv = 10 ** (db / 20);
      }
      if (this.released) {
        const db = -96 * (t - this.releaseT) / this.rel;
        lv = Math.min(lv, this.releaseLevel * 10 ** (db / 20));
        if (db < -96) this.done = true;
      }
      return lv;
    }
    release() {
      if (this.released) return;
      this.released = true;
      this.releaseT = this.t;
      this.releaseLevel = this.level;
    }
    render(data, outL, outR, from, to) {
      const { spec } = this;
      const loopLen = spec.loopEnd - spec.loopStart;
      const loopEndRel = spec.loopEnd - spec.start;
      const endRel = spec.end - spec.start;
      for (let i = from; i < to && !this.done; i++) {
        const lv = this.envelope();
        this.level = lv;
        const ip = Math.floor(this.pos);
        const frac = this.pos - ip;
        const s0 = data[spec.start + ip];
        const s1 = data[spec.start + ip + 1] ?? s0;
        const s = (s0 + (s1 - s0) * frac) * lv;
        outL[i] += s * this.gainL;
        outR[i] += s * this.gainR;
        this.t += 1;
        this.pos += this.step;
        if (spec.loop && loopLen > 0) {
          while (this.pos >= loopEndRel) this.pos -= loopLen;
        } else if (this.pos >= endRel - 1) {
          this.done = true;
        }
      }
    }
  };
  var LowPass = class {
    constructor(fc, sr) {
      __publicField(this, "b0");
      __publicField(this, "b1");
      __publicField(this, "b2");
      __publicField(this, "a1");
      __publicField(this, "a2");
      __publicField(this, "z1", 0);
      __publicField(this, "z2", 0);
      const k = Math.tan(Math.PI * fc / sr);
      const norm = 1 / (1 + Math.SQRT2 * k + k * k);
      this.b0 = k * k * norm;
      this.b1 = 2 * this.b0;
      this.b2 = this.b0;
      this.a1 = 2 * (k * k - 1) * norm;
      this.a2 = (1 - Math.SQRT2 * k + k * k) * norm;
    }
    process(x, from, to) {
      for (let i = from; i < to; i++) {
        const y = this.b0 * x[i] + this.z1;
        this.z1 = this.b1 * x[i] - this.a1 * y + this.z2;
        this.z2 = this.b2 * x[i] - this.a2 * y;
        x[i] = y;
      }
    }
  };
  var Synth = class {
    constructor(sf, sr, channels, tuningCents = 0, masterGain = 1, toneCutoff = 5e3) {
      __publicField(this, "sr");
      __publicField(this, "sf");
      __publicField(this, "channels");
      __publicField(this, "events", []);
      __publicField(this, "voices", []);
      __publicField(this, "order", 0);
      __publicField(this, "sorted", true);
      __publicField(this, "cancelled", /* @__PURE__ */ new Set());
      __publicField(this, "pos", 0);
      // 已经渲染的样本数 / samples rendered so far
      __publicField(this, "tuningCents");
      // 与演奏者的音准一致 / match the player's tuning
      __publicField(this, "masterGain");
      __publicField(this, "lpL");
      __publicField(this, "lpR");
      this.sf = sf;
      this.sr = sr;
      this.channels = channels;
      this.tuningCents = tuningCents;
      this.masterGain = masterGain;
      this.lpL = toneCutoff ? new LowPass(toneCutoff, sr) : null;
      this.lpR = toneCutoff ? new LowPass(toneCutoff, sr) : null;
    }
    // 时间以秒为单位（合成器自己的时钟，从 0 开始）/ times in seconds on the synth's own clock, starting at 0
    noteOn(time, ch, key, vel) {
      const id = this.order++;
      this.push({ time: Math.round(time * this.sr), order: id, kind: "on", ch, key, vel });
      return id;
    }
    noteOff(time, ch, key) {
      const id = this.order++;
      this.push({ time: Math.round(time * this.sr), order: id, kind: "off", ch, key, vel: 0 });
      return id;
    }
    // 取消一个还没执行的事件（例如音的结束时间改了）/ cancel an event that has not happened yet (e.g. a changed note end)
    cancel(id) {
      this.cancelled.add(id);
    }
    push(ev) {
      this.events.push(ev);
      this.sorted = false;
    }
    allNotesOff() {
      for (const v of this.voices) v.release();
    }
    apply(ev) {
      const setup = this.channels[ev.ch];
      if (ev.kind === "on") {
        const velGain = (ev.vel / 127) ** 2 * (setup.gain ?? 1);
        for (const spec of this.sf.voicesFor(setup.bank ?? 0, setup.program, ev.key, ev.vel)) {
          const gain = velGain * 10 ** (-spec.attenuationCb / 200);
          this.voices.push(new Voice(spec, ev.ch, ev.key, gain, this.tuningCents, this.sr));
        }
      } else {
        for (const v of this.voices) if (v.ch === ev.ch && v.key === ev.key) v.release();
      }
    }
    render(outL, outR) {
      const frames = outL.length;
      outL.fill(0);
      outR.fill(0);
      if (!this.sorted) {
        this.events.sort((a, b) => a.time - b.time || a.order - b.order);
        this.sorted = true;
      }
      const start = this.pos;
      let cur = 0;
      while (this.events.length && this.events[0].time < start + frames) {
        const ev = this.events.shift();
        if (this.cancelled.delete(ev.order)) continue;
        const off = Math.min(Math.max(0, ev.time - start), frames);
        if (off > cur) {
          for (const v of this.voices) v.render(this.sf.data, outL, outR, cur, off);
          cur = off;
        }
        this.apply(ev);
      }
      for (const v of this.voices) v.render(this.sf.data, outL, outR, cur, frames);
      let n = 0;
      for (const v of this.voices) if (!v.done) this.voices[n++] = v;
      this.voices.length = n;
      const g = this.masterGain;
      for (let i = 0; i < frames; i++) {
        outL[i] *= g;
        outR[i] *= g;
      }
      this.lpL?.process(outL, 0, frames);
      this.lpR?.process(outR, 0, frames);
      this.pos += frames;
    }
    activeVoices() {
      return this.voices.length;
    }
  };

  // src/lib/accompaniment/web-options.ts
  var WEB_ENGINE_OPTIONS = {
    waitRestMinQn: 0.75,
    noWaitMeasures: [9],
    noWaitAfterEntryQn: 1.5,
    backConfirmFrames: 6
  };
  var VELOCITY_SCALE = 0.8;

  // src/lib/accompaniment/realtime-processor.ts
  var STATUS_EVERY = 0.1;
  var RECORD_CHUNK = 4800;
  var AccompanimentProcessor = class extends AudioWorkletProcessor {
    constructor(options) {
      super(options);
      __publicField(this, "session", null);
      __publicField(this, "synth", null);
      __publicField(this, "setup", null);
      __publicField(this, "running", false);
      __publicField(this, "finished", false);
      __publicField(this, "samples", 0);
      __publicField(this, "nextStatus", 0);
      __publicField(this, "rec", new Float32Array(RECORD_CHUNK));
      __publicField(this, "recN", 0);
      __publicField(this, "played", /* @__PURE__ */ new Map());
      // 实际演奏的伴奏音 / accompaniment notes played
      __publicField(this, "offIds", /* @__PURE__ */ new Map());
      __publicField(this, "silence", new Float32Array(128));
      __publicField(this, "midiSpq", 1);
      this.port.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "start") this.start(msg.setup);
        else if (msg.type === "stop") this.stop("stopped");
        else if (msg.type === "volume" && this.synth) this.synth.masterGain = msg.value;
      };
    }
    start(setup) {
      this.setup = setup;
      const score = parseScore(setup.score);
      this.midiSpq = score.midiSecPerQuarter;
      const sf = new SoundFont(setup.soundfont);
      const opts = {
        noiseDb: setup.noiseDb,
        tuning: setup.tuning,
        latency: setup.latency,
        engine: WEB_ENGINE_OPTIONS,
        cutSustainOnSkip: true,
        // 耳机：二重奏屏蔽自身伴奏声，乐团版不屏蔽（与 Python 默认相同）；扬声器：都屏蔽，二重奏还陷波
        // Headphones: the duet masks its own sound, the ensemble does not (Python defaults);
        // loudspeaker: both mask, and the duet also notches
        selfMask: setup.version === "duet" ? true : setup.speaker,
        selfNotch: setup.version === "duet" && setup.speaker
      };
      const lat = setup.latency;
      const vel = (v, scale = 1) => Math.min(127, Math.max(1, Math.round(v * VELOCITY_SCALE * scale)));
      if (setup.version === "duet") {
        this.synth = new Synth(sf, sampleRate, [{ program: 40 }], setup.tuning * 100, setup.volume);
        const s = new DuetSession(score, score.midiSecPerQuarter, opts);
        s.onNote = (ev) => this.noteOn(`${ev.j}`, 0, ev, vel(ev.velocity), lat);
        s.onNoteOff = (ev) => this.noteOff(`${ev.j}`, 0, ev, lat);
        this.session = s;
      } else {
        const orch = parseOrchestra(setup.orchestra);
        const channels = orch.voices.slice().sort((a, b) => a.channel - b.channel).map((v) => ({ program: v.program }));
        this.synth = new Synth(sf, sampleRate, channels, setup.tuning * 100, setup.volume);
        const s = new OrchestraSession(score, score.midiSecPerQuarter, orch, { ...opts, speaker: setup.speaker });
        s.onOrchNote = (ev) => {
          const id = `${ev.j}:${ev.voice}:${ev.pitch}`;
          this.noteOn(id, ev.channel, ev, vel(ev.velocity, orch.voices[ev.voice].gain), lat);
        };
        this.session = s;
      }
      this.samples = 0;
      this.nextStatus = 0;
      this.running = true;
      this.finished = false;
      this.port.postMessage({ type: "started" });
    }
    // 伴奏音：在输入时间轴上希望被听到的时刻，减去输出延迟后交给合成器
    // Accompaniment note: the time it should be heard on the input clock, minus the output latency
    noteOn(id, ch, ev, velocity, lat) {
      const synth = this.synth;
      synth.noteOn(ev.on - lat, ch, ev.pitch, velocity);
      this.offIds.set(id, synth.noteOff(ev.off - lat, ch, ev.pitch));
      const heard = Math.max(ev.on, synth.pos / sampleRate + lat);
      this.played.set(id, { pos: ev.j, channel: ch, key: ev.pitch, velocity, on: heard, off: Math.max(ev.off, heard + 0.05) });
    }
    // 结束时间提前了：取消原来的结束事件，重新安排 / the end moved earlier: cancel the old note-off and reschedule
    noteOff(id, ch, ev, lat) {
      const synth = this.synth;
      const old = this.offIds.get(id);
      if (old !== void 0) synth.cancel(old);
      this.offIds.set(id, synth.noteOff(ev.off - lat, ch, ev.pitch));
      const p = this.played.get(id);
      if (p) p.off = Math.max(ev.off, p.on + 0.05);
    }
    stop(reason) {
      if (!this.running) return;
      this.running = false;
      this.flushRecording();
      this.synth?.allNotesOff();
      const eng = this.session?.engine;
      this.port.postMessage({
        type: "done",
        reason,
        notes: [...this.played.values()],
        played: eng ? Array.from(eng.committed).filter(Number.isFinite).length : 0,
        total: eng ? eng.committed.length : 0,
        onsets: eng ? eng.events.length : 0,
        tempo: this.tempo()
      });
    }
    // 平均速度相对 MIDI 原速 / average tempo relative to the MIDI tempo
    tempo() {
      const eng = this.session?.engine;
      if (!eng || eng.events.length < 2) return null;
      const [k0, t0] = eng.events[0];
      const [k1, t1] = eng.events[eng.events.length - 1];
      const dq = eng.pQ[k1] - eng.pQ[k0];
      if (dq <= 0 || t1 <= t0) return null;
      return this.midiSpq / ((t1 - t0) / dq);
    }
    flushRecording() {
      if (this.recN > 0 && this.setup?.recordInput) {
        this.port.postMessage({ type: "input", samples: this.rec.slice(0, this.recN) });
      }
      this.recN = 0;
    }
    process(inputs, outputs) {
      const out = outputs[0];
      const L2 = out[0];
      const R = out[1] ?? out[0];
      if (!this.synth) {
        L2.fill(0);
        if (R !== L2) R.fill(0);
        return true;
      }
      const input = inputs[0]?.[0] ?? this.silence;
      if (this.running && this.session) {
        const nowIn = this.session.feed(input, sampleRate);
        this.samples += input.length;
        if (this.setup?.recordInput) {
          for (let i = 0; i < input.length; i++) {
            this.rec[this.recN++] = input[i];
            if (this.recN === RECORD_CHUNK) this.flushRecording();
          }
        }
        if (nowIn >= this.nextStatus) {
          this.nextStatus = nowIn + STATUS_EVERY;
          const eng = this.session.engine;
          const k = eng.lastK;
          const n = k >= 0 ? eng.piano[k] : null;
          this.port.postMessage({
            type: "status",
            time: nowIn,
            measure: n ? n.measure : null,
            beat: n ? n.beat : null,
            locked: !!eng.kf,
            paused: eng.paused
          });
        }
        if (!this.finished && this.session.done(nowIn)) {
          this.finished = true;
          this.stop("finished");
        }
      }
      if (R === L2) {
        const tmp = new Float32Array(L2.length);
        this.synth.render(L2, tmp);
        for (let i = 0; i < L2.length; i++) L2[i] = 0.5 * (L2[i] + tmp[i]);
      } else {
        this.synth.render(L2, R);
      }
      return true;
    }
  };
  registerProcessor("accompaniment-processor", AccompanimentProcessor);
})();
