// 逐帧运行的跟随引擎（与 Python 的 FollowerEngine 相同）
// Frame-by-frame follower engine (same as Python FollowerEngine)
//
// 每来一帧调用一次 step(tCenter, midi, voiced, now)，返回这一帧新锁定的伴奏音 [索引, 发声时间]
// Call step() once per 10 ms frame; it returns the accompaniment notes committed in this frame as [index, play time]
import { ScoreFollower } from './follower';
import { TempoKalman } from './kalman';
import { ENGINE, type FollowMode } from './params';
import { buildStates, type HmmState, type Note, type Score } from './score';

type Snapshot = ReturnType<TempoKalman['clone']>;

export interface EngineOptions {
	waitRestMinQn?: number; // 只在至少这么长的休止后等待（四分音符）；不设 = 稳定版规则（> 0.2）
	noWaitMeasures?: number[]; // 不等待的小节 / measures where the accompaniment does not wait
	noWaitAfterEntryQn?: number; // 不等待至少延续到进入后多少四分音符 / no-wait lasts at least this long after the entry
	quarterNotesPerMeasure?: number; // 12/8 拍 = 6 / 6 for 12/8
	// 退回到更早的音需要连续几帧确认；不设 = 与前进相同（2 帧，稳定版）。退回是为了纠正前进时的误判，
	// 要求更多证据可以防止一两帧的杂音（例如前一个音的余音）把已经确认的起音推迟
	// frames needed to confirm a step BACK to an earlier note; unset = same as forward (2, the stable version).
	// Backward steps correct wrong forward jumps; asking for more evidence stops a one- or two-frame blip
	// (e.g. the previous note still ringing) from pushing a confirmed onset later
	backConfirmFrames?: number;
}
type Event = [number, number, number]; // [piano note k, onset time, confirmed at]

const key4 = (x: number) => (Math.round(x * 1e4) / 1e4).toFixed(4);

// 最小二乘直线拟合（numpy.polyfit(x, y, 1)）/ least-squares line fit
function polyfit1(x: number[], y: number[]): [number, number] {
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

// numpy.searchsorted(a, v)（左侧）/ numpy.searchsorted(a, v), side='left'
function searchsorted(a: Float64Array, v: number): number {
	let lo = 0;
	let hi = a.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (a[mid] < v) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

export class FollowerEngine {
	readonly mode: FollowMode;
	readonly piano: Note[];
	readonly violin: Note[];
	readonly states: HmmState[];
	readonly s0: number;
	readonly follower: ScoreFollower;
	readonly pQ: Float64Array;
	readonly vQ: Float64Array;
	readonly skipNote: boolean[];
	restBefore: boolean[];
	readonly vWithPiano: boolean[];
	vUnison = new Map<number, number>();
	readonly noteState = new Map<number, number>();
	committed: Float64Array;
	soundEnd: Float64Array;
	kf: TempoKalman | null = null;
	lastK = -1;
	nxt = 0;
	events: Event[] = [];
	cand: Event[] = [];
	rejected: Event[] = [];
	history: [number, Snapshot, number][] = [];
	silentCount = 0;
	prevSilent = 0;
	silentRun = 0;
	lastPlayed: number | null = null;
	resync = true;
	selfCheck = false; // 扬声器模式下由会话打开 / enabled by the session in loudspeaker mode
	times: number[] = [];
	midi: number[] = [];
	voiced: boolean[] = [];
	state: [string | null, number] = [null, -1];
	paused = false;
	lastMatchT = 0;
	offscore = 0;
	commitHorizon = 0.03; // 提前锁定的时间（秒）：输出延迟 + 余量 / commit lead time: output latency + margin
	readonly noWaitCap = new Map<number, number>(); // 不等待的小节：你的进入音 -> 伴奏可以演奏到的位置 / no-wait windows
	skippedCount = 0; // 被跳过的伴奏音（供会话缩短上一个音）/ skipped accompaniment notes (lets the session shorten the previous note)
	private readonly backConfirmFrames: number;

	constructor(score: Score, secPerQnMidi: number, mode: FollowMode = 'strict', options: EngineOptions = {}) {
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
		this.restBefore = piano.map((n, k) => (k === 0 ? false : n.qn - (piano[k - 1].qn + piano[k - 1].dur) > 0.2));
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
			if (st.type === 'note') this.noteState.set(st.k, s);
		});
		this.backConfirmFrames = options.backConfirmFrames ?? ENGINE.CONFIRM_FRAMES;
		// 全曲版的两条规则（默认关闭，与 M1-15 稳定版一致）/ two rules from the full version (off by default, as in M1-15)
		const qO = piano.map((n) => n.qnOrig ?? n.qn);
		const dO = piano.map((n) => n.durOrig ?? n.dur);
		if (options.waitRestMinQn !== undefined) {
			// 只在较长的休止后等你重新进入 / wait for the re-entry only after longer rests
			const minQn = options.waitRestMinQn;
			this.restBefore = piano.map((_, k) => (k === 0 ? false : qO[k] - (qO[k - 1] + dO[k - 1]) >= minQn));
		}
		if (options.noWaitMeasures?.length) {
			// 这些小节里，从你休止开始，伴奏一直演奏到小节线（或你进入后一拍），不等你
			// In these measures the accompaniment plays on to the bar line (or one beat after your entry) without waiting
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
	protected snapshot(): Snapshot {
		return (this.kf as TempoKalman).clone();
	}

	protected restore(snap: Snapshot): void {
		const kf = this.kf as TempoKalman;
		kf.x = [snap.x[0], snap.x[1]];
		kf.P = [
			[snap.P[0][0], snap.P[0][1]],
			[snap.P[1][0], snap.P[1][1]],
		];
		kf.qRef = snap.qRef;
	}

	// q 之后的下一个钢琴起音（跳过装饰音区域）/ next piano onset after position q
	nextPiano(q: number): number | null {
		for (let k = searchsorted(this.pQ, q + 1e-6); k < this.piano.length; k++) {
			if (!this.skipNote[k]) return k;
		}
		return null;
	}

	patience(kNext: number): number {
		const kf = this.kf as TempoKalman;
		return ENGINE.PATIENCE_SEC + ENGINE.PATIENCE_RATIO * kf.x[1] * Math.max(this.pQ[kNext] - kf.qRef, 0);
	}

	// 演奏者此刻在弹的音和接下来要弹的音 / the note the player is on and the next one
	expectedNotes(): Set<number> {
		const out = new Set<number>();
		const [typ, k] = this.state;
		if (typ === 'note') out.add(k);
		const k2 = this.kf ? this.nextPiano(this.kf.qRef) : null;
		if (k2 !== null) out.add(k2);
		return out;
	}

	// 伴奏音 j 是否参与屏蔽：与演奏者此刻要弹的音同音时不屏蔽
	// Whether accompaniment note j is masked: not when it has the pitch of a note the player is expected to play
	ownNote(j: number, expected: Set<number>): boolean {
		const pitches = new Set(Array.from(expected, (k) => this.piano[k].pitch));
		return !pitches.has(this.violin[j].pitch);
	}

	// 自身伴奏声屏蔽 / self-masking of our own accompaniment sound
	isSelfSound(t: number, midi: number, voiced: boolean, tol = 0.6, tail = ENGINE.SELF_TAIL): boolean {
		if (!voiced || this.lastPlayed === null) return false;
		const expected = this.expectedNotes();
		for (let j = Math.max(0, this.lastPlayed - 6); j <= this.lastPlayed; j++) {
			if (
				Number.isFinite(this.committed[j]) &&
				this.committed[j] - 0.05 <= t &&
				t <= this.soundEnd[j] + tail &&
				Math.abs(midi - this.violin[j].pitch) < tol &&
				this.ownNote(j, expected)
			)
				return true;
		}
		return false;
	}

	// 重新进入时识别伴奏的回声 / recognise our own echo at a re-entry
	echoSounding(k: number, onset: number, tol = 0.6): boolean {
		if (!this.selfCheck || this.lastPlayed === null) return false;
		const p = this.piano[k].pitch;
		for (let j = Math.max(0, this.lastPlayed - 8); j <= this.lastPlayed; j++) {
			const tOn = this.committed[j];
			if (
				Number.isFinite(tOn) &&
				Math.abs(this.violin[j].pitch - p) < tol &&
				tOn - 0.06 <= onset &&
				onset <= this.soundEnd[j] + ENGINE.ECHO_MAX_DELAY + ENGINE.SELF_TAIL &&
				!(this.vUnison.has(j) && this.vUnison.get(j) === k)
			)
				return true;
		}
		return false;
	}

	// ---------------- main step ----------------
	step(tCenter: number, midiI: number, voicedI: boolean, now: number): [number, number][] {
		const piano = this.piano;
		const { times, midi, voiced } = this;
		times.push(tCenter);
		midi.push(midiI);
		voiced.push(voicedI);
		const i = times.length - 1;
		let newNotes: [number, number][] = [];
		const kf = this.kf;
		let qWindow: [number, number] | null = null;
		if (kf) {
			// 搜索范围：从最后确认的位置到按当前速度推算的位置再往前一点
			// Search from the last confirmed position up to slightly beyond the tempo prediction
			const qPred = kf.qRef + (now - kf.x[0]) / kf.x[1];
			const width = 1.0 + 0.2 * Math.max(qPred - kf.qRef, 0);
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
		// 同一个音在安静之后又被重新弹起（抢拍后重来）：用新的起音重新锚定
		// The same note re-attacked after a silence (a false start, then the real entry): re-anchor on it
		if (
			kf &&
			this.history.length &&
			typ === 'note' &&
			k === this.lastK &&
			k === this.history[this.history.length - 1][0] &&
			voiced[i] &&
			this.silentRun >= ENGINE.PAUSE_SILENCE_FRAMES &&
			Math.abs(midi[i] - piano[k].pitch) < 0.6
		) {
			let j0 = i;
			while (j0 - 1 >= 0 && voiced[j0 - 1] && Math.abs(midi[j0 - 1] - piano[k].pitch) < 0.6) j0 -= 1;
			if (i - j0 + 1 === ENGINE.REENTRY_CONFIRM_FRAMES && times[j0] > this.events[this.events.length - 1][1] + 0.3) {
				this.restore(this.history[this.history.length - 1][1]);
				kf.reenter(piano[k].qn, times[j0]);
				this.events[this.events.length - 1] = [k, times[j0], now];
				this.silentRun = 0;
			}
		}
		const need = typ === 'note' && k < this.lastK ? this.backConfirmFrames : ENGINE.CONFIRM_FRAMES;
		let confirmed = typ === 'note' && k !== this.lastK && post > 0.5 && i >= need - 1;
		if (confirmed) {
			for (let j = 0; j < need; j++) {
				if (!(voiced[i - j] && Math.abs(midi[i - j] - piano[k].pitch) < 0.6)) {
					confirmed = false;
					break;
				}
			}
		}
		if (confirmed) {
			if (this.handleOnset(i, k, now) === 'pending') return newNotes;
		}
		if (this.kf) newNotes = this.schedule(now);
		return newNotes;
	}

	// 像乐器的稳定音高（落在半音上、几帧内不变）/ a stable, semitone-locked pitch
	private instrumentLike(i: number): boolean {
		if (i < 4) return false;
		for (let j = i - 4; j <= i; j++) if (!this.voiced[j]) return false;
		const m = this.midi.slice(i - 4, i + 1);
		const mean = m.reduce((a, b) => a + b, 0) / m.length;
		const std = Math.sqrt(m.reduce((a, b) => a + (b - mean) ** 2, 0) / m.length);
		const last = m[m.length - 1];
		return Math.abs(last - Math.round(last)) < 0.3 && std < 0.15;
	}

	// 返回 true 表示处于停顿状态、这一帧不更新跟随器 / true = paused, skip the follower for this frame
	private pauseCheck(i: number, now: number): boolean {
		const kf = this.kf as TempoKalman;
		const { piano, midi, voiced } = this;
		const kNext = this.nextPiano(kf.qRef);
		const cands = [this.lastK, kNext, kNext === null ? null : kNext + 1].filter(
			(kk): kk is number => kk !== null && kk >= 0 && kk < piano.length,
		);
		const resume = cands.filter((kk) => kk !== this.lastK);
		const match = voiced[i] && cands.some((kk) => Math.abs(midi[i] - piano[kk].pitch) < 0.6);
		if (match) this.lastMatchT = now;
		if (!this.paused) {
			const overdue =
				kNext !== null && !this.restBefore[kNext] && now > kf.predictTime(this.pQ[kNext]) + this.patience(kNext);
			if (overdue && now - this.lastMatchT >= ENGINE.PAUSE_SEC && this.lastK >= 0) {
				this.paused = true;
				this.offscore = 0;
				const a = new Float64Array(this.follower.S);
				a[this.noteState.get(this.lastK) as number] = 1.0; // 回到最后弹的音 / rewind to the last note
				this.follower.alpha = a;
			} else {
				return false;
			}
		}
		if (voiced[i] && resume.some((kk) => Math.abs(midi[i] - piano[kk].pitch) < 0.6)) return false;
		if (this.instrumentLike(i)) {
			this.offscore += 1;
			if (this.offscore >= ENGINE.UNFREEZE_FRAMES) {
				// 在别处继续演奏：在可能的范围内重新搜索 / resumed somewhere else: search again
				this.paused = false;
				const qPred = kf.qRef + (now - kf.x[0]) / kf.x[1];
				const hi = Math.max(qPred, kf.qRef) + 1.0 + 0.2 * Math.max(qPred - kf.qRef, 0);
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

	private handleOnset(i: number, k: number, now: number): 'pending' | void {
		const { piano, pQ, s0, times, midi, voiced } = this;
		let j0 = i;
		while (j0 - 1 >= Math.max(0, i - 40) && voiced[j0 - 1] && Math.abs(midi[j0 - 1] - piano[k].pitch) < 0.6) j0 -= 1;
		const onset = times[j0];
		const q = piano[k].qn;
		if (!this.kf) {
			// 还没初始化：收集连续 3 个速度合理的起音后再启动卡尔曼滤波
			// Not initialised yet: start the Kalman filter after 3 consecutive plausible onsets
			if (k < this.lastK) this.cand = this.cand.filter((c) => c[0] < k);
			this.cand.push([k, onset, now]);
			this.lastK = k;
			if (this.cand.length >= 3) {
				const [[k1, t1], [k2, t2], [k3, t3]] = this.cand.slice(-3);
				const q1 = pQ[k1];
				const q2 = pQ[k2];
				const q3 = pQ[k3];
				const pairs: [number, number, number, number][] = [
					[q1, t1, q2, t2],
					[q2, t2, q3, t3],
				];
				const ok =
					q2 - q1 > 0 &&
					q2 - q1 <= 3 &&
					q3 - q2 > 0 &&
					q3 - q2 <= 3 &&
					pairs.every(([qa, ta, qb, tb]) => {
						const r = (tb - ta) / (qb - qa);
						return 0.5 * s0 <= r && r <= 2.0 * s0;
					});
				if (ok) {
					const [slope, icpt] = polyfit1([q1, q2, q3], [t1, t2, t3]);
					this.kf = new TempoKalman(q3, slope * q3 + icpt, Math.min(Math.max(slope, 0.5 * s0), 2.0 * s0));
					this.events.push(...this.cand.slice(-3));
					this.follower.setTempo(this.kf.x[1]);
				}
			}
			return;
		}
		const kf = this.kf;
		if (k < this.lastK) {
			// 跟随器退回到更早的音：撤销最近 2 秒内、位置在它之后的事件
			// The follower moved back: undo recent events beyond this note and restore the Kalman state
			const undo = this.history.filter((h) => h[0] >= k && now - h[2] < 2.0);
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
		const rests: number[] = [];
		for (let j = 1; j <= k; j++) if (this.restBefore[j] && pQ[j] > kf.qRef) rests.push(j);
		if (rests.length && this.echoSounding(k, onset)) return; // 休止后：伴奏同音的回声 / our own echo
		let isReentry = false;
		if (rests.length) {
			const jFirst = rests[rests.length - 1];
			const restSec = (pQ[jFirst] - (pQ[jFirst - 1] + piano[jFirst - 1].dur)) * kf.x[1];
			isReentry = k <= jFirst + 1 && -(0.3 + 0.5 * restSec) <= onset - pred;
		} else if (
			(this.paused || (overdue && this.silentRun >= ENGINE.PAUSE_SILENCE_FRAMES)) &&
			kNext !== null &&
			k <= kNext + 1 &&
			onset >= pred - 0.15
		) {
			isReentry = true; // 真正停下来之后继续 / resuming after a real pause
		}
		if (isReentry && i - j0 + 1 < ENGINE.REENTRY_CONFIRM_FRAMES) return 'pending';
		if (isReentry) {
			this.history.push([k, this.snapshot(), now]);
			kf.reenter(q, onset); // 只校正时间 / correct time only
			this.events.push([k, onset, now]);
			this.lastK = k;
			this.rejected = [];
			this.paused = false;
		} else {
			// 不对称门限 / asymmetric gate
			const base = 0.15 + 0.15 * kf.x[1] * Math.max(q - kf.qRef, 0);
			let early: number;
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
					// 连续 4 次被拒且彼此一致：模型跑偏了，用它们重新初始化
					// 4 consecutive, mutually consistent rejections: restart the model
					const last4 = this.rejected.slice(-4);
					const ks = last4.map((r) => r[0]);
					const qs = ks.map((kk) => pQ[kk]);
					const ts = last4.map((r) => r[1]);
					const [slope, icpt] = polyfit1(qs, ts);
					const resid = Math.max(...ts.map((t, n) => Math.abs(t - (slope * qs[n] + icpt))));
					const steps = ks.slice(1).every((b, n) => b - ks[n] > 0 && b - ks[n] <= 2);
					if (steps && resid < 0.08 && 0.5 * s0 <= slope && slope <= 2.0 * s0) {
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
		this.follower.setTempo((this.kf as TempoKalman).x[1]);
	}

	private schedule(now: number): [number, number][] {
		const kNext = this.nextPiano((this.kf as TempoKalman).qRef);
		const cap = kNext === null ? undefined : this.noWaitCap.get(kNext);
		// 不等待的区间：暂时不等你重新进入，伴奏只演奏到区间结束 / no-wait window: play on, but only up to its end
		if (cap !== undefined && this.mode === 'strict') return this.scheduleCore(now, kNext, cap, false);
		return this.scheduleCore(now, kNext, this.violin.length, this.mode === 'strict');
	}

	private scheduleCore(now: number, kNext: number | null, limit: number, strict: boolean): [number, number][] {
		const kf = this.kf as TempoKalman;
		const { pQ, vQ, violin, committed } = this;
		const newNotes: [number, number][] = [];
		let holdFrom = Infinity; // 伴奏不能越过的乐谱位置 / the accompaniment may not pass this position
		if (strict && kNext !== null) {
			if (this.restBefore[kNext]) holdFrom = pQ[kNext]; // 休止后：等演奏者进入 / wait for the entry
			else if (now > kf.predictTime(pQ[kNext]) + this.patience(kNext)) holdFrom = pQ[kNext]; // 迟到：停下来等
		}
		if (holdFrom < Infinity && this.nxt < limit && vQ[this.nxt] >= holdFrom - 1e-6) this.resync = true;
		while (this.nxt < limit && vQ[this.nxt] < holdFrom - 1e-6) {
			const nxt = this.nxt;
			const tau = kf.predictTime(vQ[nxt]); // 演奏者时间线上这个音应在的时刻 / target on the player's timeline
			const prev = this.lastPlayed;
			let tPlan: number;
			if (ENGINE.SMOOTHING && prev !== null && !this.resync) {
				// 相位校正 / phase correction
				const dq = vQ[nxt] - vQ[prev];
				const nominal = kf.x[1] * dq;
				const tFree = committed[prev] + nominal;
				let frac = 1 - (1 - ENGINE.ALPHA) ** dq;
				if (Math.abs(tFree - tau) > ENGINE.RESYNC_QN * kf.x[1]) frac = 1.0;
				tPlan = tFree - frac * (tFree - tau);
				if (frac < 1.0) {
					tPlan = Math.min(
						Math.max(tPlan, committed[prev] + ENGINE.IOI_MIN * nominal),
						committed[prev] + ENGINE.IOI_MAX * nominal,
					);
				}
				const behind = tPlan - tau;
				if (behind > ENGINE.SKIP_BEHIND_QN * kf.x[1] && !this.vWithPiano[nxt]) {
					this.nxt += 1; // 落后太多：跳过填充音 / far behind: skip this filler note
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
				this.nxt += 1; // 计划时间已经过去太久：跳过 / long past: skip
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

	finished(): boolean {
		return this.nxt >= this.violin.length;
	}
}
