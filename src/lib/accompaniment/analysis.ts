// 离线处理：校准 → 跟谱引擎 → 伴奏音符 → 合成（不依赖浏览器，可在 Node 中测试）
// Offline processing: calibration → score follower → accompaniment notes → synthesis (browser-independent, testable in Node)
import { parseOrchestra, OrchestraSession, type Orchestra } from './orchestra';
import { StreamingPitch } from './pitch';
import { parseScore, type Score } from './score';
import { DuetSession } from './session';
import type { EngineOptions } from './engine';
import type { SoundFont } from './sf2';
import { Synth, renderOffline } from './synth';

export const ANALYSIS_RATE = 48000; // 引擎和合成器使用的采样率 / sample rate for the engine and the synthesiser
const BLOCK = ANALYSIS_RATE / 100; // 10 ms
const VELOCITY_SCALE = 0.8; // 与 Python 版相同 / same as the Python version

export type Version = 'duet' | 'ensemble';

// 网页版采用的改进规则（相对 Python M1-15 稳定版）：
//   · 只在至少半拍（0.75 个四分音符）的休止后等你重新进入（来自全曲版）
//   · 第 9 小节你休止时，伴奏演奏到小节线（或你进入后一拍）不等你（来自全曲版）
//   · 退回到更早的音需要连续 6 帧确认，防止前一个音的余音把已确认的起音推迟
//   · 下一个伴奏音被跳过时，上一个音不再延长
// Improved rules used on the website (relative to the stable Python M1-15 version):
//   · wait for your re-entry only after rests of at least half a beat (0.75 quarter notes) (from the full version)
//   · in m.9, while you rest, the accompaniment plays to the bar line (or one beat after your entry) (full version)
//   · a step back to an earlier note needs 6 frames, so the previous note's ringing cannot delay a confirmed onset
//   · when the next accompaniment note is skipped, the previous one is no longer sustained
export const WEB_ENGINE_OPTIONS: EngineOptions = {
	waitRestMinQn: 0.75,
	noWaitMeasures: [9],
	noWaitAfterEntryQn: 1.5,
	backConfirmFrames: 6,
};

export interface Assets {
	score: Score;
	orchestra: Orchestra;
	soundfont: SoundFont;
	midiSecPerQuarter: number;
}

export function makeAssets(scoreJson: unknown, orchestraJson: unknown, soundfont: SoundFont): Assets {
	const score = parseScore(scoreJson as Parameters<typeof parseScore>[0]);
	return {
		score,
		orchestra: parseOrchestra(orchestraJson as Parameters<typeof parseOrchestra>[0]),
		soundfont,
		midiSecPerQuarter: score.midiSecPerQuarter,
	};
}

export interface Calibration {
	noiseDb: number;
	tuning: number; // 半音 / semitones
	voicedFrames: number;
}

export interface PlannedNote {
	channel: number;
	key: number;
	velocity: number;
	on: number;
	off: number;
}

export interface Result {
	calibration: Calibration;
	notes: PlannedNote[];
	played: number; // 演奏了的伴奏位置数 / accompaniment positions played
	total: number;
	tempoRatio: number | null; // 平均演奏速度相对 MIDI 原速 / your average tempo relative to the MIDI tempo
	onsets: number; // 确认的起音数 / onsets confirmed
	left: Float32Array; // 伴奏（立体声）/ accompaniment (stereo)
	right: Float32Array;
}

type Progress = (stage: 'calibrate' | 'follow' | 'render', fraction: number) => void;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// numpy 的线性插值百分位数 / numpy-style percentile with linear interpolation
function percentile(values: number[], p: number): number {
	const a = [...values].sort((x, y) => x - y);
	if (!a.length) return NaN;
	const pos = ((a.length - 1) * p) / 100;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

// 从录音本身估计底噪和音准（与 Python 事后评估中的做法相同）
// Estimate the noise floor and tuning from the recording itself (as in the Python hindsight evaluation)
export async function calibrate(x: Float32Array, progress?: Progress): Promise<Calibration> {
	const sp = new StreamingPitch(ANALYSIS_RATE);
	const edb: number[] = [];
	const midi: number[] = [];
	const ap: number[] = [];
	for (let k = 0; k < x.length; k += BLOCK) {
		const blk = new Float32Array(BLOCK);
		blk.set(x.subarray(k, Math.min(k + BLOCK, x.length)));
		for (const f of sp.push(blk)) {
			edb.push(f.energyDb);
			midi.push(f.midi);
			ap.push(f.aperiodicity);
		}
		if ((k / BLOCK) % 500 === 0) {
			progress?.('calibrate', k / x.length);
			await tick();
		}
	}
	const noiseDb = percentile(edb, 5);
	const dev: number[] = [];
	for (let i = 0; i < edb.length; i++) {
		if (ap[i] < 0.25 && edb[i] > noiseDb + 15) dev.push(midi[i] - Math.round(midi[i]));
	}
	return { noiseDb, tuning: dev.length ? percentile(dev, 50) : 0, voicedFrames: dev.length };
}

export async function analyse(
	x: Float32Array,
	assets: Assets,
	version: Version,
	cal: Calibration,
	progress?: Progress,
): Promise<Result> {
	const notes: PlannedNote[] = [];
	const opts = { noiseDb: cal.noiseDb, tuning: cal.tuning, latency: 0, engine: WEB_ENGINE_OPTIONS, cutSustainOnSkip: true };
	const vel = (v: number, scale = 1) => Math.min(127, Math.max(1, Math.round(v * VELOCITY_SCALE * scale)));
	let session: DuetSession | OrchestraSession;
	if (version === 'duet') {
		session = new DuetSession(assets.score, assets.midiSecPerQuarter, opts);
	} else {
		const os = new OrchestraSession(assets.score, assets.midiSecPerQuarter, assets.orchestra, { ...opts, speaker: false });
		os.onOrchNote = (ev) =>
			notes.push({
				channel: ev.channel,
				key: ev.pitch,
				velocity: vel(ev.velocity, assets.orchestra.voices[ev.voice].gain),
				on: ev.on,
				off: ev.off,
			});
		session = os;
	}
	for (let k = 0; k < x.length; k += BLOCK) {
		const blk = new Float32Array(BLOCK);
		blk.set(x.subarray(k, Math.min(k + BLOCK, x.length)));
		session.feed(blk, ANALYSIS_RATE);
		if ((k / BLOCK) % 500 === 0) {
			progress?.('follow', k / x.length);
			await tick();
		}
	}
	if (session instanceof DuetSession) {
		for (const ev of session.notes.values()) notes.push({ channel: 0, key: ev.pitch, velocity: vel(ev.velocity), on: ev.on, off: ev.off });
	}
	const eng = session.engine;
	const played = Array.from(eng.committed).filter(Number.isFinite).length;
	progress?.('render', 0);
	await tick();
	const [left, right] = renderNotes(notes, assets, version, cal.tuning, x.length / ANALYSIS_RATE + 2);
	progress?.('render', 1);
	return {
		calibration: cal,
		notes,
		played,
		total: eng.committed.length,
		tempoRatio: averageTempo(eng.events, eng.pQ, assets.midiSecPerQuarter),
		onsets: eng.events.length,
		left,
		right,
	};
}

// 平均速度：第一个和最后一个确认的起音之间 / average tempo between the first and last confirmed onsets
function averageTempo(events: [number, number, number][], pQ: Float64Array, midiSpq: number): number | null {
	if (events.length < 2) return null;
	const [k0, t0] = events[0];
	const [k1, t1] = events[events.length - 1];
	const dq = pQ[k1] - pQ[k0];
	if (dq <= 0 || t1 <= t0) return null;
	return midiSpq / ((t1 - t0) / dq);
}

export function renderNotes(notes: PlannedNote[], assets: Assets, version: Version, tuning: number, seconds: number) {
	const channels =
		version === 'duet'
			? [{ program: 40 }]
			: assets.orchestra.voices
					.slice()
					.sort((a, b) => a.channel - b.channel)
					.map((v) => ({ program: v.program }));
	const synth = new Synth(assets.soundfont, ANALYSIS_RATE, channels, tuning * 100, 1);
	for (const n of notes) {
		synth.noteOn(n.on, n.channel, n.key, n.velocity);
		synth.noteOff(n.off, n.channel, n.key);
	}
	return renderOffline(synth, seconds);
}

// 伴奏音量自动对齐到演奏的响度 / match the accompaniment's loudness to the playing
export function autoGain(x: Float32Array, left: Float32Array, right: Float32Array): number {
	let a = 0;
	let na = 0;
	for (let i = 0; i < x.length; i++) {
		if (Math.abs(x[i]) > 1e-3) {
			a += x[i] * x[i];
			na++;
		}
	}
	let b = 0;
	let nb = 0;
	for (let i = 0; i < left.length; i++) {
		const m = 0.5 * (left[i] + right[i]);
		if (Math.abs(m) > 1e-3) {
			b += m * m;
			nb++;
		}
	}
	if (!na || !nb) return 1;
	return (0.9 * Math.sqrt(a / na)) / Math.sqrt(b / nb);
}

// 编码成 16 位 WAV / encode a 16-bit WAV
export function encodeWav(left: Float32Array, right: Float32Array, rate: number): Blob {
	const n = left.length;
	const buf = new ArrayBuffer(44 + n * 4);
	const v = new DataView(buf);
	const w = (o: number, s: string) => {
		for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
	};
	w(0, 'RIFF');
	v.setUint32(4, 36 + n * 4, true);
	w(8, 'WAVE');
	w(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, 2, true);
	v.setUint32(24, rate, true);
	v.setUint32(28, rate * 4, true);
	v.setUint16(32, 4, true);
	v.setUint16(34, 16, true);
	w(36, 'data');
	v.setUint32(40, n * 4, true);
	for (let i = 0; i < n; i++) {
		v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 32767, true);
		v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 32767, true);
	}
	return new Blob([buf], { type: 'audio/wav' });
}
