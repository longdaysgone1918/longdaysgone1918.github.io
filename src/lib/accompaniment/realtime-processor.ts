// 实时伴奏处理器：在浏览器的音频线程里运行。麦克风输入、跟谱引擎和合成器在同一个回调里，共用一个音频时钟
// （与 Python 的 live_accompany 相同的设计）。这个文件会被打包成 public/accompaniment/realtime-worklet.js
// Real-time accompaniment processor, running in the browser's audio thread. Microphone input, the follower and
// the synthesiser share one callback and one audio clock (the same design as Python live_accompany).
// This file is bundled into public/accompaniment/realtime-worklet.js
import { OrchestraSession, parseOrchestra } from './orchestra';
import { parseScore } from './score';
import { DuetSession, type NoteEvent } from './session';
import { SoundFont } from './sf2';
import { Synth } from './synth';
import { VELOCITY_SCALE, WEB_ENGINE_OPTIONS } from './web-options';

// AudioWorklet 全局对象的类型声明 / type declarations for the AudioWorklet global scope
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	constructor(options?: unknown);
}

export interface RealtimeSetup {
	score: unknown;
	orchestra: unknown;
	soundfont: ArrayBuffer;
	version: 'duet' | 'ensemble';
	noiseDb: number;
	tuning: number; // 半音 / semitones
	latency: number; // 总输出延迟（秒）/ total output latency (s)
	speaker: boolean; // 用扬声器（而不是耳机）播放伴奏 / accompaniment through a loudspeaker
	volume: number;
	recordInput: boolean; // 把麦克风输入传回页面，用于回放 / send the input back to the page for replay
}

export interface PlayedNote {
	pos: number; // 伴奏时间线上的位置编号 / position index on the accompaniment timeline
	channel: number;
	key: number;
	velocity: number;
	on: number;
	off: number;
}

const STATUS_EVERY = 0.1; // 每 0.1 秒报告一次状态 / report status every 0.1 s
const RECORD_CHUNK = 4800; // 每 0.1 秒传回一段输入 / send input back every 0.1 s

class AccompanimentProcessor extends AudioWorkletProcessor {
	private session: DuetSession | OrchestraSession | null = null;
	private synth: Synth | null = null;
	private setup: RealtimeSetup | null = null;
	private running = false;
	private finished = false;
	private samples = 0;
	private nextStatus = 0;
	private rec: Float32Array = new Float32Array(RECORD_CHUNK);
	private recN = 0;
	private readonly played = new Map<string, PlayedNote>(); // 实际演奏的伴奏音 / accompaniment notes played
	private readonly offIds = new Map<string, number>();
	private readonly silence = new Float32Array(128);
	private midiSpq = 1;

	constructor(options?: unknown) {
		super(options);
		this.port.onmessage = (e: MessageEvent) => {
			const msg = e.data;
			if (msg.type === 'start') this.start(msg.setup as RealtimeSetup);
			else if (msg.type === 'stop') this.stop('stopped');
			else if (msg.type === 'volume' && this.synth) this.synth.masterGain = msg.value;
		};
	}

	private start(setup: RealtimeSetup): void {
		this.setup = setup;
		const score = parseScore(setup.score as Parameters<typeof parseScore>[0]);
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
			selfMask: setup.version === 'duet' ? true : setup.speaker,
			selfNotch: setup.version === 'duet' && setup.speaker,
		};
		const lat = setup.latency;
		const vel = (v: number, scale = 1) => Math.min(127, Math.max(1, Math.round(v * VELOCITY_SCALE * scale)));
		if (setup.version === 'duet') {
			this.synth = new Synth(sf, sampleRate, [{ program: 40 }], setup.tuning * 100, setup.volume);
			const s = new DuetSession(score, score.midiSecPerQuarter, opts);
			s.onNote = (ev) => this.noteOn(`${ev.j}`, 0, ev, vel(ev.velocity), lat);
			s.onNoteOff = (ev) => this.noteOff(`${ev.j}`, 0, ev, lat);
			this.session = s;
		} else {
			const orch = parseOrchestra(setup.orchestra as Parameters<typeof parseOrchestra>[0]);
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
		this.port.postMessage({ type: 'started' });
	}

	// 伴奏音：在输入时间轴上希望被听到的时刻，减去输出延迟后交给合成器
	// Accompaniment note: the time it should be heard on the input clock, minus the output latency
	private noteOn(id: string, ch: number, ev: NoteEvent, velocity: number, lat: number): void {
		const synth = this.synth as Synth;
		synth.noteOn(ev.on - lat, ch, ev.pitch, velocity);
		this.offIds.set(id, synth.noteOff(ev.off - lat, ch, ev.pitch));
		// 实际听到的时刻：声音不可能早于"现在 + 输出延迟"（例如乐队在第一个音上进入时）
		// When it was actually heard: never earlier than now + output latency (e.g. the ensemble entering on your first note)
		const heard = Math.max(ev.on, synth.pos / sampleRate + lat);
		this.played.set(id, { pos: ev.j, channel: ch, key: ev.pitch, velocity, on: heard, off: Math.max(ev.off, heard + 0.05) });
	}

	// 结束时间提前了：取消原来的结束事件，重新安排 / the end moved earlier: cancel the old note-off and reschedule
	private noteOff(id: string, ch: number, ev: NoteEvent, lat: number): void {
		const synth = this.synth as Synth;
		const old = this.offIds.get(id);
		if (old !== undefined) synth.cancel(old);
		this.offIds.set(id, synth.noteOff(ev.off - lat, ch, ev.pitch));
		const p = this.played.get(id);
		if (p) p.off = Math.max(ev.off, p.on + 0.05);
	}

	private stop(reason: 'stopped' | 'finished'): void {
		if (!this.running) return;
		this.running = false;
		this.flushRecording();
		this.synth?.allNotesOff();
		const eng = this.session?.engine;
		this.port.postMessage({
			type: 'done',
			reason,
			notes: [...this.played.values()],
			played: eng ? Array.from(eng.committed).filter(Number.isFinite).length : 0,
			total: eng ? eng.committed.length : 0,
			onsets: eng ? eng.events.length : 0,
			tempo: this.tempo(),
		});
	}

	// 平均速度相对 MIDI 原速 / average tempo relative to the MIDI tempo
	private tempo(): number | null {
		const eng = this.session?.engine;
		if (!eng || eng.events.length < 2) return null;
		const [k0, t0] = eng.events[0];
		const [k1, t1] = eng.events[eng.events.length - 1];
		const dq = eng.pQ[k1] - eng.pQ[k0];
		if (dq <= 0 || t1 <= t0) return null;
		return this.midiSpq / ((t1 - t0) / dq);
	}

	private flushRecording(): void {
		if (this.recN > 0 && this.setup?.recordInput) {
			this.port.postMessage({ type: 'input', samples: this.rec.slice(0, this.recN) });
		}
		this.recN = 0;
	}

	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
		const out = outputs[0];
		const L = out[0];
		const R = out[1] ?? out[0];
		if (!this.synth) {
			L.fill(0);
			if (R !== L) R.fill(0);
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
					type: 'status',
					time: nowIn,
					measure: n ? n.measure : null,
					beat: n ? n.beat : null,
					locked: !!eng.kf,
					paused: eng.paused,
				});
			}
			if (!this.finished && this.session.done(nowIn)) {
				this.finished = true;
				this.stop('finished');
			}
		}
		if (R === L) {
			const tmp = new Float32Array(L.length);
			this.synth.render(L, tmp);
			for (let i = 0; i < L.length; i++) L[i] = 0.5 * (L[i] + tmp[i]);
		} else {
			this.synth.render(L, R);
		}
		return true;
	}
}

registerProcessor('accompaniment-processor', AccompanimentProcessor);
