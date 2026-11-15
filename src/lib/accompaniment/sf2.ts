// SoundFont 2 读取：只实现这个项目用到的部分（采样、乐器区、预设区和常用参数）
// SoundFont 2 reader: only what this project needs (samples, instrument and preset zones, common generators)

const GEN = {
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
	overridingRootKey: 58,
} as const;

// 参数的默认值（SoundFont 2.04 规范）/ generator defaults (SoundFont 2.04 specification)
const DEFAULTS: Record<number, number> = {
	[GEN.delayVolEnv]: -12000,
	[GEN.attackVolEnv]: -12000,
	[GEN.holdVolEnv]: -12000,
	[GEN.decayVolEnv]: -12000,
	[GEN.sustainVolEnv]: 0,
	[GEN.releaseVolEnv]: -12000,
	[GEN.scaleTuning]: 100,
	[GEN.overridingRootKey]: -1,
};

export interface SampleHeader {
	name: string;
	start: number;
	end: number;
	loopStart: number;
	loopEnd: number;
	rate: number;
	originalPitch: number;
	pitchCorrection: number;
}

interface Zone {
	keyLo: number;
	keyHi: number;
	velLo: number;
	velHi: number;
	gens: Map<number, number>;
}

interface Instrument {
	name: string;
	global: Map<number, number>;
	zones: Zone[];
}

interface Preset {
	name: string;
	bank: number;
	program: number;
	global: Map<number, number>;
	zones: Zone[];
}

// 一个将要发声的采样区：已经把乐器层和预设层的参数合并好 / a sample zone ready to sound, with all levels merged
export interface VoiceSpec {
	sample: SampleHeader;
	start: number;
	end: number;
	loopStart: number;
	loopEnd: number;
	loop: boolean;
	rootKey: number;
	tuneCents: number; // 粗调 + 微调 + 采样校正 / coarse + fine + sample correction
	scaleTuning: number;
	attenuationCb: number;
	pan: number; // -500 … 500
	delay: number;
	attack: number;
	hold: number;
	decay: number;
	sustainCb: number;
	release: number;
}

const timecents = (tc: number) => 2 ** (tc / 1200);

export class SoundFont {
	readonly data: Float32Array; // 全部采样，已换算到 -1…1 / all sample data scaled to -1…1
	readonly samples: SampleHeader[] = [];
	private readonly instruments: Instrument[] = [];
	private readonly presets: Preset[] = [];

	constructor(buffer: ArrayBuffer) {
		const view = new DataView(buffer);
		const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
		if (tag(0) !== 'RIFF' || tag(8) !== 'sfbk') throw new Error('not a SoundFont 2 file');
		const lists = new Map<string, Map<string, [number, number]>>();
		for (let o = 12; o < view.byteLength; ) {
			const id = tag(o);
			const size = view.getUint32(o + 4, true);
			if (id === 'LIST') {
				const sub = new Map<string, [number, number]>();
				for (let p = o + 12; p < o + 8 + size; ) {
					const sid = tag(p);
					const ss = view.getUint32(p + 4, true);
					sub.set(sid, [p + 8, ss]);
					p += 8 + ss + (ss & 1);
				}
				lists.set(tag(o + 8), sub);
			}
			o += 8 + size + (size & 1);
		}
		const sdta = lists.get('sdta');
		const pdta = lists.get('pdta');
		if (!sdta || !pdta) throw new Error('incomplete SoundFont');
		const [so, ss] = sdta.get('smpl') as [number, number];
		this.data = new Float32Array(ss / 2);
		for (let i = 0; i < this.data.length; i++) this.data[i] = view.getInt16(so + 2 * i, true) / 32768;

		const str = (o: number, n: number) => {
			let s = '';
			for (let i = 0; i < n; i++) {
				const c = view.getUint8(o + i);
				if (c === 0) break;
				s += String.fromCharCode(c);
			}
			return s;
		};
		const recs = (name: string, size: number) => {
			const [o, s] = pdta.get(name) as [number, number];
			return Array.from({ length: s / size }, (_, i) => o + i * size);
		};
		// 采样头 / sample headers
		for (const o of recs('shdr', 46).slice(0, -1)) {
			this.samples.push({
				name: str(o, 20),
				start: view.getUint32(o + 20, true),
				end: view.getUint32(o + 24, true),
				loopStart: view.getUint32(o + 28, true),
				loopEnd: view.getUint32(o + 32, true),
				rate: view.getUint32(o + 36, true),
				originalPitch: view.getUint8(o + 40),
				pitchCorrection: view.getInt8(o + 41),
			});
		}
		const readGens = (gens: number[], from: number, to: number) => {
			const m = new Map<number, number>();
			for (let g = from; g < to; g++) {
				const o = gens[g];
				const oper = view.getUint16(o, true);
				const raw = oper === GEN.keyRange || oper === GEN.velRange ? view.getUint16(o + 2, true) : view.getInt16(o + 2, true);
				m.set(oper, raw);
			}
			return m;
		};
		const toZone = (m: Map<number, number>): Zone => {
			const kr = m.get(GEN.keyRange) ?? 0x7f00;
			const vr = m.get(GEN.velRange) ?? 0x7f00;
			return { keyLo: kr & 0xff, keyHi: kr >> 8, velLo: vr & 0xff, velHi: vr >> 8, gens: m };
		};
		const readLevel = (hdr: number[], bags: number[], gens: number[], bagIdx: (o: number) => number, terminal: string) => {
			const out: { hdr: number; global: Map<number, number>; zones: Zone[] }[] = [];
			for (let h = 0; h < hdr.length - 1; h++) {
				const b0 = bagIdx(hdr[h]);
				const b1 = bagIdx(hdr[h + 1]);
				let global = new Map<number, number>();
				const zones: Zone[] = [];
				for (let b = b0; b < b1; b++) {
					const g0 = view.getUint16(bags[b], true);
					const g1 = view.getUint16(bags[b + 1], true);
					const m = readGens(gens, g0, g1);
					const isTerminal = m.has(terminal === 'sample' ? GEN.sampleID : GEN.instrument);
					if (!isTerminal && b === b0) global = m; // 第一个没有终止参数的区是全局区 / first zone without terminal = global
					else if (isTerminal) zones.push(toZone(m));
				}
				out.push({ hdr: hdr[h], global, zones });
			}
			return out;
		};
		const inst = recs('inst', 22);
		for (const r of readLevel(inst, recs('ibag', 4), recs('igen', 4), (o) => view.getUint16(o + 20, true), 'sample')) {
			this.instruments.push({ name: str(r.hdr, 20), global: r.global, zones: r.zones });
		}
		const phdr = recs('phdr', 38);
		for (const r of readLevel(phdr, recs('pbag', 4), recs('pgen', 4), (o) => view.getUint16(o + 24, true), 'instrument')) {
			this.presets.push({
				name: str(r.hdr, 20),
				program: view.getUint16(r.hdr + 20, true),
				bank: view.getUint16(r.hdr + 22, true),
				global: r.global,
				zones: r.zones,
			});
		}
	}

	presetNames(): string[] {
		return this.presets.map((p) => `${p.bank}:${p.program} ${p.name}`);
	}

	// 找出某个音要用的采样区，并合并参数 / find the sample zones for a note and merge their generators
	voicesFor(bank: number, program: number, key: number, vel: number): VoiceSpec[] {
		const preset = this.presets.find((p) => p.bank === bank && p.program === program);
		if (!preset) return [];
		const out: VoiceSpec[] = [];
		const inRange = (z: Zone) => key >= z.keyLo && key <= z.keyHi && vel >= z.velLo && vel <= z.velHi;
		for (const pz of preset.zones) {
			if (!inRange(pz)) continue;
			const instrument = this.instruments[pz.gens.get(GEN.instrument) as number];
			for (const iz of instrument.zones) {
				if (!inRange(iz)) continue;
				// 乐器层：区内的值覆盖全局区；预设层：在乐器层的值上相加
				// Instrument level: zone values override the global zone; preset level: added on top
				const ig = (g: number) => iz.gens.get(g) ?? instrument.global.get(g) ?? DEFAULTS[g] ?? 0;
				const pg = (g: number) => pz.gens.get(g) ?? preset.global.get(g) ?? 0;
				const v = (g: number) => ig(g) + pg(g);
				const sample = this.samples[iz.gens.get(GEN.sampleID) as number];
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
					release: timecents(v(GEN.releaseVolEnv)),
				});
			}
		}
		return out;
	}
}
