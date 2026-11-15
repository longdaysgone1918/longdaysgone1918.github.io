// 练习页面：实时伴奏。所有处理都在访客的浏览器里完成，录音不会上传到任何地方
// Practice page: real-time accompaniment. Everything runs in the visitor's browser; nothing is uploaded
import { ANALYSIS_RATE, autoGain, encodeWav, makeAssets, renderNotes, type Assets, type PlannedNote, type Version } from './analysis';
import { StreamingPitch } from './pitch';
import type { PlayedNote } from './realtime-processor';
import { SoundFont } from './sf2';

type Lang = 'zh' | 'en';

const TEXT = {
	zh: {
		loading: '正在加载乐谱和音色……',
		loaded: '已准备好。先允许使用麦克风。',
		loadFailed: '加载失败，请刷新页面重试。',
		micDenied: '无法使用麦克风。请在浏览器地址栏里允许本网站使用麦克风，然后重试。',
		noMic: '没有找到麦克风。',
		micReady: '麦克风已就绪。',
		quiet: '请保持安静 2 秒，正在测量底噪……',
		tooNoisy: '环境太吵或麦克风音量太大，底噪测量不准，请换个安静的地方或调低麦克风音量再试。',
		playNow: '现在开始演奏吧。伴奏会在你的前几个音之后加入。',
		waiting: '等你开始演奏……',
		following: (m: number, b: number) => `正在跟随：第 ${m} 小节第 ${b} 拍`,
		paused: '你停下来了，伴奏在等你。从停下的地方继续即可。',
		finished: '演奏结束。',
		stoppedByUser: '已停止。',
		noSinkSelect: '这个浏览器不能在网页上选择，请在电脑的声音设置里切换默认输出设备',
		tuningPrompt: '请弹一个长音，保持约 3 秒……',
		tuningResult: (c: number) => `音准偏差：${c >= 0 ? '+' : ''}${c.toFixed(0)} 音分（伴奏会调到和你一致）。`,
		tuningFailed: '没有听到清楚的长音，请再试一次。',
		reported: (ms: number) => `系统报告的设备延迟约 ${ms.toFixed(0)} 毫秒，已自动补偿；上面的数值是在此之外的额外延迟。`,
		summary: (played: number, total: number, onsets: number, tempo: number | null) =>
			`伴奏演奏了 ${played} / ${total} 个位置，确认了 ${onsets} 个起音` +
			(tempo ? `，你的平均速度约为 MIDI 原速的 ${(tempo * 100).toFixed(0)}%。` : '。'),
	},
	en: {
		loading: 'Loading the score and the instrument sounds…',
		loaded: 'Ready. First allow the microphone.',
		loadFailed: 'Loading failed. Please reload the page and try again.',
		micDenied: 'The microphone could not be used. Allow this site to use the microphone in your browser’s address bar, then try again.',
		noMic: 'No microphone was found.',
		micReady: 'Microphone ready.',
		quiet: 'Please stay quiet for 2 seconds while the noise floor is measured…',
		tooNoisy: 'The room is too noisy or the microphone too loud to measure the noise floor. Find a quieter place or lower the microphone level, then try again.',
		playNow: 'Start playing. The accompaniment joins after your first few notes.',
		waiting: 'Waiting for you to start…',
		following: (m: number, b: number) => `Following: measure ${m}, beat ${b}`,
		paused: 'You have stopped; the accompaniment is waiting. Carry on from where you stopped.',
		finished: 'Finished.',
		stoppedByUser: 'Stopped.',
		noSinkSelect: 'This browser cannot choose it here; switch the default output in your computer’s sound settings',
		tuningPrompt: 'Play one long note and hold it for about 3 seconds…',
		tuningResult: (c: number) => `Tuning offset: ${c >= 0 ? '+' : ''}${c.toFixed(0)} cents (the accompaniment will match you).`,
		tuningFailed: 'No clear long note was heard. Please try again.',
		reported: (ms: number) => `The devices report about ${ms.toFixed(0)} ms of latency, compensated automatically; the value above is extra latency on top of that.`,
		summary: (played: number, total: number, onsets: number, tempo: number | null) =>
			`The accompaniment played ${played} of ${total} positions; ${onsets} onsets confirmed` +
			(tempo ? `; your average tempo was about ${(tempo * 100).toFixed(0)}% of the MIDI tempo.` : '.'),
	},
};

// 让类型检查知道这些数组用的是普通 ArrayBuffer / tell the type checker these arrays use a plain ArrayBuffer
const plain = (a: Float32Array) => new Float32Array(a.buffer as ArrayBuffer, a.byteOffset, a.length);
const $ = <T extends HTMLElement>(root: HTMLElement, sel: string) => root.querySelector(sel) as T;
const median = (a: number[]) => {
	const s = [...a].sort((x, y) => x - y);
	return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

export async function initPractice(root: HTMLElement): Promise<void> {
	const lang = (root.dataset.lang === 'en' ? 'en' : 'zh') as Lang;
	const t = TEXT[lang];
	const base = root.dataset.assets ?? '/accompaniment/';
	const el = {
		status: $<HTMLParagraphElement>(root, '[data-status]'),
		mic: $<HTMLButtonElement>(root, '[data-mic]'),
		device: $<HTMLSelectElement>(root, '[data-device]'),
		output: $<HTMLSelectElement>(root, '[data-output]'),
		outputRow: $<HTMLElement>(root, '[data-output-row]'),
		meter: $<HTMLMeterElement>(root, '[data-meter]'),
		latency: $<HTMLInputElement>(root, '[data-latency]'),
		latencyValue: $<HTMLOutputElement>(root, '[data-latency-value]'),
		reported: $<HTMLParagraphElement>(root, '[data-reported]'),
		volume: $<HTMLInputElement>(root, '[data-volume]'),
		tuningBtn: $<HTMLButtonElement>(root, '[data-tuning]'),
		tuningResult: $<HTMLSpanElement>(root, '[data-tuning-result]'),
		start: $<HTMLButtonElement>(root, '[data-start]'),
		stop: $<HTMLButtonElement>(root, '[data-stop]'),
		results: $<HTMLElement>(root, '[data-results]'),
		summary: $<HTMLParagraphElement>(root, '[data-summary]'),
		play: $<HTMLButtonElement>(root, '[data-play]'),
		pause: $<HTMLButtonElement>(root, '[data-pause]'),
		accVol: $<HTMLInputElement>(root, '[data-acc-volume]'),
		recVol: $<HTMLInputElement>(root, '[data-rec-volume]'),
		download: $<HTMLButtonElement>(root, '[data-download]'),
	};
	const radios = (name: string) => Array.from(root.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
	const choice = (name: string) => radios(name).find((i) => i.checked)?.value;
	const say = (msg: string) => {
		el.status.textContent = msg;
	};

	// ---------- 加载乐谱和音色 / load the score and sounds ----------
	let assets: Assets;
	let scoreJson: unknown;
	let orchJson: unknown;
	let sfBuf: ArrayBuffer;
	say(t.loading);
	try {
		[scoreJson, orchJson, sfBuf] = await Promise.all([
			fetch(`${base}score_m1_15.json`).then((r) => r.json()),
			fetch(`${base}orchestra_m1_15.json`).then((r) => r.json()),
			fetch(`${base}strings_fluidr3.sf2`).then((r) => r.arrayBuffer()),
		]);
		assets = makeAssets(scoreJson, orchJson, new SoundFont(sfBuf.slice(0)));
		say(t.loaded);
	} catch (err) {
		console.error(err);
		say(t.loadFailed);
		return;
	}

	// ---------- 音频设备 / audio devices ----------
	let ctx: AudioContext | null = null;
	let stream: MediaStream | null = null;
	let source: MediaStreamAudioSourceNode | null = null;
	let recorder: AudioWorkletNode | null = null;
	let level = 0;
	let listeners: ((x: Float32Array) => void)[] = []; // 需要麦克风原始数据的地方 / consumers of raw microphone audio

	const ensureContext = async () => {
		if (!ctx) {
			// 尽量用 48 kHz（与引擎一致）/ prefer 48 kHz, as the engine
			try {
				ctx = new AudioContext({ sampleRate: ANALYSIS_RATE, latencyHint: 'interactive' });
			} catch {
				ctx = new AudioContext({ latencyHint: 'interactive' });
			}
			await ctx.audioWorklet.addModule(`${base}recorder-worklet.js`);
			await ctx.audioWorklet.addModule(`${base}realtime-worklet.js`);
		}
		if (ctx.state === 'suspended') await ctx.resume();
		return ctx;
	};

	const reportedLatency = () => {
		const ac = ctx as AudioContext;
		const track = stream?.getAudioTracks()[0];
		const inLat = (track?.getSettings() as MediaTrackSettings & { latency?: number })?.latency ?? 0;
		return (ac.baseLatency || 0) + ((ac as AudioContext & { outputLatency?: number }).outputLatency || 0) + (inLat || 0);
	};
	const showLatency = () => {
		el.latencyValue.textContent = `${Number(el.latency.value).toFixed(2)} s`;
		if (ctx) el.reported.textContent = t.reported(reportedLatency() * 1000);
	};
	el.latency.addEventListener('input', showLatency);
	showLatency();

	const openMic = async (deviceId?: string) => {
		const ac = await ensureContext();
		stream?.getTracks().forEach((tr) => tr.stop());
		source?.disconnect();
		recorder?.disconnect();
		stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				deviceId: deviceId ? { exact: deviceId } : undefined,
				channelCount: 1,
				// 关闭回声消除、降噪和自动增益：它们会改变音量和音色 / they change level and timbre
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
			},
		});
		source = ac.createMediaStreamSource(stream);
		recorder = new AudioWorkletNode(ac, 'recorder-processor');
		recorder.port.onmessage = (e: MessageEvent<{ samples: Float32Array; rms: number }>) => {
			level = e.data.rms;
			for (const f of listeners) f(e.data.samples);
		};
		const mute = ac.createGain();
		mute.gain.value = 0; // 不把麦克风声音送到扬声器 / do not send the microphone to the speakers
		source.connect(recorder).connect(mute).connect(ac.destination);
		const devices = await navigator.mediaDevices.enumerateDevices();
		const fill = (sel: HTMLSelectElement, kind: MediaDeviceKind, current?: string) =>
			sel.replaceChildren(
				...devices
					.filter((d) => d.kind === kind)
					.map((d, i) => {
						const o = document.createElement('option');
						o.value = d.deviceId;
						o.textContent = d.label || `${kind} ${i + 1}`;
						o.selected = d.deviceId === current;
						return o;
					}),
			);
		fill(el.device, 'audioinput', stream.getAudioTracks()[0]?.getSettings().deviceId);
		el.device.disabled = false;
		// 选择输出设备（Chrome、Edge 支持）；其他浏览器提示在系统里切换
		// Output device selection (Chrome and Edge); other browsers: switch it in the system settings
		if ('setSinkId' in AudioContext.prototype) {
			fill(el.output, 'audiooutput');
			el.output.disabled = false;
		} else {
			const o = document.createElement('option');
			o.textContent = t.noSinkSelect;
			el.output.replaceChildren(o);
		}
		for (const b of [el.start, el.tuningBtn]) b.disabled = false;
		showLatency();
		say(t.micReady);
	};

	el.mic.addEventListener('click', async () => {
		try {
			await openMic();
			el.mic.disabled = true;
		} catch (err) {
			console.error(err);
			say((err as DOMException)?.name === 'NotFoundError' ? t.noMic : t.micDenied);
		}
	});
	el.device.addEventListener('change', () => openMic(el.device.value).catch(() => say(t.micDenied)));
	el.output.addEventListener('change', async () => {
		const ac = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
		await ac.setSinkId?.(el.output.value);
		showLatency();
	});

	const drawMeter = () => {
		const db = 20 * Math.log10(level + 1e-9);
		el.meter.value = Math.max(0, Math.min(1, (db + 80) / 80));
		requestAnimationFrame(drawMeter);
	};
	requestAnimationFrame(drawMeter);

	// 录一段麦克风声音 / capture a stretch of microphone audio
	const capture = (seconds: number) =>
		new Promise<Float32Array>((resolve) => {
			const chunks: Float32Array[] = [];
			let n = 0;
			const need = Math.round(seconds * (ctx as AudioContext).sampleRate);
			const f = (x: Float32Array) => {
				chunks.push(x);
				n += x.length;
				if (n >= need) {
					listeners = listeners.filter((g) => g !== f);
					const out = new Float32Array(n);
					let p = 0;
					for (const c of chunks) {
						out.set(c, p);
						p += c.length;
					}
					resolve(out);
				}
			};
			listeners.push(f);
		});

	// 逐帧分析一段 48 kHz 音频 / frame analysis of 48 kHz audio
	const frames = (x: Float32Array) => {
		const sp = new StreamingPitch(ANALYSIS_RATE);
		return sp.push(x);
	};

	// ---------- 音准（可选）/ tuning (optional) ----------
	let tuning = 0;
	el.tuningBtn.addEventListener('click', async () => {
		el.tuningBtn.disabled = true;
		say(t.tuningPrompt);
		const x = await toAnalysisRate(await capture(3.2), (ctx as AudioContext).sampleRate);
		const fr = frames(x);
		const energies = fr.map((f) => f.energyDb).sort((a, b) => a - b);
		const floor = energies[Math.floor(energies.length * 0.05)] ?? -90;
		const dev = fr.filter((f) => f.aperiodicity < 0.25 && f.energyDb > floor + 15).map((f) => f.midi - Math.round(f.midi));
		if (dev.length < 60) {
			say(t.tuningFailed);
		} else {
			tuning = median(dev);
			el.tuningResult.textContent = t.tuningResult(tuning * 100);
			say('');
		}
		el.tuningBtn.disabled = false;
	});

	// ---------- 实时伴奏 / real-time accompaniment ----------
	let rtNode: AudioWorkletNode | null = null;
	let rtInput: Float32Array[] = [];
	let lastResult: { notes: PlannedNote[]; version: Version; input: Float32Array; tuning: number } | null = null;

	el.volume.addEventListener('input', () => rtNode?.port.postMessage({ type: 'volume', value: Number(el.volume.value) / 100 }));

	el.start.addEventListener('click', async () => {
		const ac = await ensureContext();
		if (!source) return;
		stopPlayback();
		el.results.hidden = true;
		for (const b of [el.start, el.tuningBtn]) b.disabled = true;
		// 1. 测量底噪（与 Python 用安静模板的做法相同：取能量的中位数）
		//    noise floor from 2 s of quiet (median frame energy, as Python does with its silence template)
		say(t.quiet);
		const quiet = await toAnalysisRate(await capture(2.2), ac.sampleRate);
		const noiseDb = median(frames(quiet).map((f) => f.energyDb));
		if (!(noiseDb < -35)) {
			say(t.tooNoisy);
			for (const b of [el.start, el.tuningBtn]) b.disabled = false;
			return;
		}
		// 2. 启动音频线程里的伴奏 / start the accompaniment in the audio thread
		const version = (choice('version') ?? 'duet') as Version;
		const speaker = true; // 伴奏总是从音箱播放 / the accompaniment always plays through a speaker
		const latency = reportedLatency() + Number(el.latency.value);
		rtInput = [];
		rtNode?.disconnect();
		rtNode = new AudioWorkletNode(ac, 'accompaniment-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
		source.connect(rtNode);
		rtNode.connect(ac.destination);
		rtNode.port.onmessage = (e: MessageEvent) => {
			const m = e.data;
			if (m.type === 'started') say(t.playNow);
			else if (m.type === 'input') rtInput.push(m.samples);
			else if (m.type === 'status') {
				if (m.paused) say(t.paused);
				else if (m.measure && m.locked) say(t.following(m.measure, m.beat));
				else if (m.measure === null && m.time > 3) say(t.waiting);
			} else if (m.type === 'done') finishRealtime(m, version);
		};
		rtNode.port.postMessage({
			type: 'start',
			setup: {
				score: scoreJson,
				orchestra: orchJson,
				soundfont: sfBuf.slice(0),
				version,
				noiseDb,
				tuning,
				latency,
				speaker,
				volume: Number(el.volume.value) / 100,
				recordInput: true,
			},
		});
		el.stop.disabled = false;
	});

	el.stop.addEventListener('click', () => rtNode?.port.postMessage({ type: 'stop' }));

	const finishRealtime = (m: { reason: string; notes: PlayedNote[]; played: number; total: number; onsets: number; tempo: number | null }, version: Version) => {
		say(m.reason === 'finished' ? t.finished : t.stoppedByUser);
		el.stop.disabled = true;
		for (const b of [el.start, el.tuningBtn]) b.disabled = false;
		const n = rtInput.reduce((a, c) => a + c.length, 0);
		const input = new Float32Array(n);
		let p = 0;
		for (const c of rtInput) {
			input.set(c, p);
			p += c.length;
		}
		lastResult = { notes: m.notes, version, input, tuning };
		el.summary.textContent = t.summary(m.played, m.total, m.onsets, m.tempo);
		el.results.hidden = false;
		const node = rtNode;
		setTimeout(() => node?.disconnect(), 3000); // 让最后的音自然结束 / let the last notes ring out
	};

	// 重采样到 48 kHz（用浏览器自带的重采样）/ resample to 48 kHz with the browser's own resampler
	async function toAnalysisRate(x: Float32Array, rate: number): Promise<Float32Array> {
		if (rate === ANALYSIS_RATE || x.length === 0) return x;
		const len = Math.ceil((x.length * ANALYSIS_RATE) / rate);
		const off = new OfflineAudioContext(1, len, ANALYSIS_RATE);
		const buf = off.createBuffer(1, x.length, rate);
		buf.copyToChannel(plain(x), 0);
		const src = off.createBufferSource();
		src.buffer = buf;
		src.connect(off.destination);
		src.start();
		return (await off.startRendering()).getChannelData(0).slice();
	}

	// ---------- 回放与下载 / replay and download ----------
	let mixCache: { left: Float32Array; right: Float32Array; gain: number } | null = null;
	let playing: AudioBufferSourceNode[] = [];
	let accGainNode: GainNode | null = null;
	let recGainNode: GainNode | null = null;

	const mix = () => {
		if (!lastResult) return null;
		if (!mixCache) {
			const r = lastResult;
			const [left, right] = renderNotes(r.notes, assets, r.version, r.tuning, r.input.length / ANALYSIS_RATE + 2);
			mixCache = { left, right, gain: autoGain(r.input, left, right) };
		}
		return mixCache;
	};
	// 新的实时演奏结束后，回放要重新合成 / after a new real-time session, the replay must be re-rendered
	const resetMix = () => {
		mixCache = null;
	};
	el.start.addEventListener('click', resetMix);

	function stopPlayback() {
		for (const s of playing) {
			try {
				s.stop();
			} catch {
				/* already stopped */
			}
		}
		playing = [];
		el.play.disabled = false;
		el.pause.disabled = true;
	}

	const volumes = () => ({ acc: (Number(el.accVol.value) / 100) * (mixCache?.gain ?? 1), rec: Number(el.recVol.value) / 100 });

	el.play.addEventListener('click', async () => {
		const m = mix();
		if (!m || !lastResult) return;
		const ac = await ensureContext();
		stopPlayback();
		const rec = ac.createBuffer(1, lastResult.input.length, ANALYSIS_RATE);
		rec.copyToChannel(plain(lastResult.input), 0);
		const acc = ac.createBuffer(2, m.left.length, ANALYSIS_RATE);
		acc.copyToChannel(plain(m.left), 0);
		acc.copyToChannel(plain(m.right), 1);
		const v = volumes();
		accGainNode = ac.createGain();
		accGainNode.gain.value = v.acc;
		recGainNode = ac.createGain();
		recGainNode.gain.value = v.rec;
		const s1 = ac.createBufferSource();
		s1.buffer = rec;
		s1.connect(recGainNode).connect(ac.destination);
		const s2 = ac.createBufferSource();
		s2.buffer = acc;
		s2.connect(accGainNode).connect(ac.destination);
		const when = ac.currentTime + 0.1;
		s1.start(when);
		s2.start(when);
		s2.onended = () => stopPlayback();
		playing = [s1, s2];
		el.play.disabled = true;
		el.pause.disabled = false;
	});
	el.pause.addEventListener('click', stopPlayback);

	const updateVolumes = () => {
		const v = volumes();
		if (accGainNode) accGainNode.gain.value = v.acc;
		if (recGainNode) recGainNode.gain.value = v.rec;
	};
	el.accVol.addEventListener('input', updateVolumes);
	el.recVol.addEventListener('input', updateVolumes);

	el.download.addEventListener('click', () => {
		const m = mix();
		if (!m || !lastResult) return;
		const v = volumes();
		const n = m.left.length;
		const L = new Float32Array(n);
		const R = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const r = i < lastResult.input.length ? lastResult.input[i] * v.rec : 0;
			L[i] = r + m.left[i] * v.acc;
			R[i] = r + m.right[i] * v.acc;
		}
		const url = URL.createObjectURL(encodeWav(L, R, ANALYSIS_RATE));
		const a = document.createElement('a');
		a.href = url;
		a.download = 'accompaniment_mix.wav';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 10000);
	});

	// 供自动测试读取的状态 / state for automated tests
	(window as unknown as { __practice?: unknown }).__practice = { get lastResult() { return lastResult; } };
}
