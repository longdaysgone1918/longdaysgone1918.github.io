// 二重奏会话：把音频块变成帧，判断有声、去掉音准偏差、（可选）屏蔽自身伴奏声，交给引擎，并记录每个伴奏音的起止
// Duet session: audio blocks → frames, voicing, tuning removal, optional self-masking, the engine, and the
// start and end of every accompaniment note (same as Python live_accompany.Session)
import { FollowerEngine, type EngineOptions } from './engine';
import { ENGINE } from './params';
import { L, SR, StreamingPitch } from './pitch';
import type { Score } from './score';

export const COMMIT_EXTRA = 0.02; // 在输出延迟之外再提前多少锁定 / extra commit lead beyond the output latency
export const END_SILENCE = 3.0; // 最后一个伴奏音之后安静多少秒自动结束 / auto-stop after this much silence

export interface SessionOptions {
	noiseDb: number; // 底噪（dB）/ noise floor
	tuning: number; // 音准偏差（半音）/ tuning offset (semitones)
	latency?: number; // 输出延迟（秒）/ output latency (s)
	selfMask?: boolean; // 屏蔽自身伴奏声 / ignore our own accompaniment in the input
	selfNotch?: boolean; // 扬声器模式（回声识别）/ loudspeaker mode (echo checks)
	voicingDb?: number; // 有声门限：底噪以上多少 dB / voicing threshold above the noise floor
	aperiodicityMax?: number;
	// 下一个伴奏音被跳过时，上一个音不再延长（稳定版会一直延长到下一个实际演奏的音）
	// When the next accompaniment note is skipped, stop sustaining the previous one (the stable version keeps it on)
	cutSustainOnSkip?: boolean;
	engine?: EngineOptions;
}

export interface NoteEvent {
	j: number; // 伴奏音编号 / accompaniment note index
	pitch: number;
	velocity: number;
	on: number; // 发声时间（输入时间轴，秒）/ note-on time on the input clock (s)
	off: number; // 结束时间（可能被后来的音提前）/ note-off time (may be shortened later)
	nominalEnd?: number; // 按乐谱时值的结束时间 / end time by the written length
}

export interface FrameRecord {
	t: number;
	midi: number;
	voiced: boolean;
}

export abstract class AccompanimentSession<E extends FollowerEngine = FollowerEngine> {
	readonly engine: E;
	readonly opts: Required<SessionOptions>;
	private pitch: StreamingPitch | null = null;
	private samplesIn = 0;
	readonly frames: FrameRecord[] = [];
	readonly notes = new Map<number, NoteEvent>(); // 每个已发声的伴奏音 / every accompaniment note played
	protected readonly open = new Set<number>(); // 结束时间还可能改的音 / notes whose end may still change
	lastVoicedT = 0;
	masked = 0;
	onNote: ((ev: NoteEvent) => void) | null = null; // 新的伴奏音 / a new accompaniment note
	onNoteOff: ((ev: NoteEvent) => void) | null = null; // 伴奏音的结束时间有变化 / a note's end time changed

	constructor(engine: E, options: SessionOptions) {
		this.opts = {
			latency: 0,
			selfMask: false,
			selfNotch: false,
			voicingDb: 15,
			aperiodicityMax: 0.25,
			cutSustainOnSkip: false,
			engine: {},
			...options,
		};
		this.engine = engine;
		this.engine.commitHorizon = this.opts.latency + COMMIT_EXTRA;
	}

	protected abstract play(j: number, tPlay: number): void;

	// 扬声器模式下需要陷波的频率（默认不陷波）/ frequencies to notch in loudspeaker mode (none by default)
	protected notchFreqs(_t: number): number[] {
		return [];
	}

	feed(block: Float32Array, sr: number): number {
		if (!this.pitch) this.pitch = new StreamingPitch(sr);
		this.samplesIn += block.length;
		const nowIn = this.samplesIn / sr;
		const eng = this.engine;
		const { noiseDb, tuning, voicingDb, aperiodicityMax, selfMask } = this.opts;
		const notch = this.opts.selfNotch ? (t: number) => this.notchFreqs(t) : undefined;
		for (const f of this.pitch.push(block, notch)) {
			let voiced = f.aperiodicity < aperiodicityMax && f.energyDb > noiseDb + voicingDb;
			const m = f.midi - tuning;
			if (voiced && selfMask && eng.isSelfSound(f.t, m, voiced)) {
				voiced = false; // 这是伴奏自己的声音 / it is our own accompaniment
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
	protected cutOpenNotes(): void {
		for (const p of Array.from(this.open)) {
			const ev = this.notes.get(p);
			if (!ev || ev.nominalEnd === undefined) continue;
			const next = this.engine.committed[p + 1];
			if (Number.isFinite(next)) continue; // 下一个音已经演奏 / the next note was played
			if (ev.off > ev.nominalEnd + 1e-6) {
				ev.off = ev.nominalEnd;
				this.open.delete(p);
				this.onNoteOff?.(ev);
			}
		}
	}

	done(nowIn: number): boolean {
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
}

export const NOTCH_HARMONICS = 8; // 处理到第几个泛音 / number of harmonics to notch

// 二重奏：伴奏是第一独奏小提琴 / duet: the accompaniment is solo violin I
export class DuetSession extends AccompanimentSession {
	constructor(score: Score, secPerQnMidi: number, options: SessionOptions) {
		super(new FollowerEngine(score, secPerQnMidi, 'strict', options.engine ?? {}), options);
		this.engine.selfCheck = this.opts.selfMask && this.opts.selfNotch;
	}

	// 此刻正在发声的伴奏音的泛音（与你此刻应弹的音同音时不处理）（与 Python 的 notch_freqs 相同）
	// Harmonics of accompaniment notes sounding at time t, skipped when it is your expected pitch (as Python notch_freqs)
	protected notchFreqs(t: number): number[] {
		const eng = this.engine;
		if (eng.lastPlayed === null) return [];
		const expected = eng.expectedNotes();
		const freqs = new Set<number>();
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

	protected play(j: number, tPlay: number): void {
		const violin = this.engine.violin;
		const n = violin[j];
		const s = (this.engine.kf as NonNullable<FollowerEngine['kf']>).x[1];
		const nominalEnd = tPlay + (n.final ? Math.max(1.5, n.dur * s) : n.dur * s);
		let tentative = nominalEnd;
		const qO = (x: (typeof violin)[number]) => x.qnOrig ?? x.qn;
		const next = j + 1 < violin.length ? violin[j + 1] : null;
		if (next && qO(next) - (qO(n) + (n.durOrig ?? n.dur)) < 0.05) {
			tentative = nominalEnd + ENGINE.SUSTAIN_MAX; // 与下一个音相连：先暂定可以延长 / legato: may sustain while waiting
		}
		// 上一个音现在可以确定结束时间：在这个音开始前结束 / the previous note now ends just before this one
		for (const prev of Array.from(this.open)) {
			if (prev >= j) continue;
			const ev = this.notes.get(prev) as NoteEvent;
			this.open.delete(prev);
			const newOff = Math.min(ev.off, tPlay - 0.02);
			if (Math.abs(newOff - ev.off) > 1e-6) {
				ev.off = newOff;
				this.onNoteOff?.(ev);
			}
		}
		const ev: NoteEvent = { j, pitch: n.pitch, velocity: n.vel, on: tPlay, off: tentative, nominalEnd };
		this.notes.set(j, ev);
		this.open.add(j);
		this.onNote?.(ev);
	}
}
