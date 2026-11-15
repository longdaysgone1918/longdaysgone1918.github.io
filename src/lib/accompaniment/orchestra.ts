// 弦乐合奏版：五个伴奏声部合并成一条起音时间线，由同一个引擎安排时间（与 Python 的 live_orchestra 相同）
// String-ensemble version: five accompaniment voices merged into one onset timeline, scheduled by the same
// engine (same as Python live_orchestra)
import { FollowerEngine, type EngineOptions } from './engine';
import { ENGINE } from './params';
import { interp, type Note, type Score } from './score';
import { AccompanimentSession, type NoteEvent, type SessionOptions } from './session';

export type EntryMode = 'first_note' | 'next_beat' | 'auto';
export const DETECTION_DELAY = 0.05; // 检测出第一个音大约需要的时间 / time needed to detect the first note (s)
export const AUTO_THRESHOLD = 0.15; // auto：总延迟小于这个值就立刻进入 / auto: enter at once below this delay (s)

export interface Voice {
	name: string;
	channel: number;
	program: number; // GM 音色号（从 0 数）/ GM program (0-based)
	gain: number;
}

export interface OrchNote {
	voice: number;
	qn: number;
	dur: number;
	pitch: number;
	vel: number;
	measure: number;
	beat: number;
	final: boolean;
	pos: number; // 所在的合并起音位置 / merged onset position
}

export interface Orchestra {
	voices: Voice[];
	notes: OrchNote[];
	groups: OrchNote[][]; // 每个位置上的音 / the notes at each position
	positions: Note[]; // 引擎看到的伴奏时间线 / the engine's accompaniment timeline
	beatQn: number;
}

interface RawOrchestra {
	voices: { name: string; channel: number; gm_program_0based: number; gain: number }[];
	notes: {
		voice: number;
		qn: number;
		dur_qn: number;
		pitch: number;
		velocity: number;
		measure: number;
		beat_eighth: number;
		final: boolean;
		pos: number;
	}[];
	positions: { qn: number; measure: number; beat_eighth: number; final: boolean }[];
	beat_qn: number;
}

export function parseOrchestra(raw: RawOrchestra, warp?: [number[], number[]]): Orchestra {
	const notes: OrchNote[] = raw.notes.map((n) => ({
		voice: n.voice,
		qn: n.qn,
		dur: n.dur_qn,
		pitch: n.pitch,
		vel: n.velocity,
		measure: n.measure,
		beat: n.beat_eighth,
		final: n.final,
		pos: n.pos,
	}));
	const groups: OrchNote[][] = raw.positions.map(() => []);
	for (const n of notes) groups[n.pos].push(n);
	let f: ((q: number) => number) | null = null;
	if (warp) {
		const [knotQ, knotW] = warp;
		const kq = [-1e3, ...knotQ, knotQ[knotQ.length - 1] + 1e3];
		const kw = [knotW[0] - (knotQ[0] + 1e3), ...knotW, knotW[knotW.length - 1] + 1e3];
		f = (q) => interp(q, kq, kw);
	}
	const positions: Note[] = groups.map((g, i) => {
		const q = g[0].qn;
		const dur = Math.max(...g.map((n) => n.dur));
		const solo = g.filter((n) => n.voice === 0);
		const rep = solo.length ? solo[0] : g.reduce((a, b) => (b.pitch > a.pitch ? b : a));
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
			beat: g[0].beat,
		};
	});
	const voices = raw.voices.map((v) => ({ name: v.name, channel: v.channel, program: v.gm_program_0based, gain: v.gain }));
	return { voices, notes, groups, positions, beatQn: raw.beat_qn };
}

// 引擎：沿用原有算法，屏蔽和回声识别考虑一个位置上的所有音，并加上开头的进入方式
// Engine: the original algorithm; masking and echo checks consider every note of a position, plus the entry
export class OrchestraEngine extends FollowerEngine {
	readonly posPitches: number[][];
	readonly latency: number;
	entryMode: EntryMode = 'auto';
	beatQn: number;
	pre: [number, number] | null = null;
	entryUsed: 'first_note' | 'next_beat' | null = null;

	constructor(score: Score, secPerQnMidi: number, orch: Orchestra, latency: number, options: EngineOptions = {}) {
		super(score, secPerQnMidi, 'strict', options);
		this.posPitches = orch.groups.map((g) => g.map((n) => n.pitch));
		this.beatQn = orch.beatQn;
		this.vUnison = new Map();
		this.violin.forEach((vn, j) => {
			this.piano.forEach((pn, k) => {
				if (Math.abs(vn.qn - pn.qn) < 1e-6 && this.posPitches[j].includes(pn.pitch)) this.vUnison.set(j, k);
			});
		});
		this.latency = latency;
	}

	private expPitches(): Set<number> {
		return new Set(Array.from(this.expectedNotes(), (k) => this.piano[k].pitch));
	}

	ownNote(j: number, expected: Set<number>): boolean {
		const expP = new Set(Array.from(expected, (k) => this.piano[k].pitch));
		return this.posPitches[j].some((p) => !expP.has(p));
	}

	isSelfSound(t: number, midi: number, voiced: boolean, tol = 0.6, tail = ENGINE.SELF_TAIL): boolean {
		if (!voiced || this.lastPlayed === null) return false;
		const expP = this.expPitches();
		for (let j = Math.max(0, this.lastPlayed - 8); j <= this.lastPlayed; j++) {
			if (Number.isFinite(this.committed[j]) && this.committed[j] - 0.05 <= t && t <= this.soundEnd[j] + tail) {
				if (this.posPitches[j].some((p) => Math.abs(midi - p) < tol && !expP.has(p))) return true;
			}
		}
		return false;
	}

	echoSounding(k: number, onset: number, tol = 0.6): boolean {
		if (!this.selfCheck || this.lastPlayed === null) return false;
		const p = this.piano[k].pitch;
		for (let j = Math.max(0, this.lastPlayed - 8); j <= this.lastPlayed; j++) {
			const tOn = this.committed[j];
			if (
				Number.isFinite(tOn) &&
				this.posPitches[j].some((q) => Math.abs(q - p) < tol) &&
				tOn - 0.06 <= onset &&
				onset <= this.soundEnd[j] + ENGINE.ECHO_MAX_DELAY + ENGINE.SELF_TAIL &&
				!(this.vUnison.has(j) && this.vUnison.get(j) === k)
			)
				return true;
		}
		return false;
	}

	step(tCenter: number, midiI: number, voicedI: boolean, now: number): [number, number][] {
		const out = super.step(tCenter, midiI, voicedI, now);
		if (!this.kf && this.cand.length) out.push(...this.preroll(now));
		return out;
	}

	// 还没锁定速度时，乐队按惯常速度从第一个音开始演奏 / before the tempo is locked, play at the usual tempo
	private preroll(now: number): [number, number][] {
		if (!this.pre) {
			const [k0, t0] = this.cand[0];
			const q0 = this.pQ[k0];
			const q0Orig = this.piano[k0].qnOrig ?? q0;
			let mode = this.entryMode;
			if (mode === 'auto') mode = this.latency + DETECTION_DELAY < AUTO_THRESHOLD ? 'first_note' : 'next_beat';
			const startOrig = mode === 'first_note' ? q0Orig : q0Orig + this.beatQn;
			while (this.nxt < this.violin.length && (this.violin[this.nxt].qnOrig as number) < startOrig - 1e-6) this.nxt += 1;
			this.pre = [q0, t0];
			this.entryUsed = mode;
		}
		const [q0, t0] = this.pre;
		const out: [number, number][] = [];
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
}

export interface OrchNoteEvent extends NoteEvent {
	voice: number;
	channel: number;
}

// 弦乐合奏会话：每个位置上的所有音一起发声 / ensemble session: all notes of a position sound together
export class OrchestraSession extends AccompanimentSession<OrchestraEngine> {
	readonly orch: Orchestra;
	readonly noteTimes = new Map<string, [number, number]>(); // "位置,声部,音高" -> [开始, 结束]
	onOrchNote: ((ev: OrchNoteEvent) => void) | null = null;

	constructor(score: Score, secPerQnMidi: number, orch: Orchestra, options: SessionOptions & { speaker?: boolean }) {
		const engine = new OrchestraEngine({ ...score, violin: orch.positions }, secPerQnMidi, orch, options.latency ?? 0, options.engine ?? {});
		super(engine, options);
		this.orch = orch;
		this.engine.selfCheck = this.opts.selfMask && !!options.speaker;
	}

	protected play(j: number, tPlay: number): void {
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
				channel: this.orch.voices[n.voice].channel,
			});
		}
	}
}
