// 练习页面（离线版）：录音或选择文件 → 分析 → 生成伴奏 → 播放混音
// Practice page (offline version): record or choose a file → analyse → generate the accompaniment → play the mix
import { analyse, ANALYSIS_RATE, autoGain, calibrate, encodeWav, makeAssets, type Assets, type Result, type Version } from './analysis';
import { SoundFont } from './sf2';

type Lang = 'zh' | 'en';

const TEXT = {
	zh: {
		loading: '正在加载乐谱和音色……',
		loaded: '已准备好。',
		loadFailed: '加载失败，请刷新页面重试。',
		micDenied: '无法使用麦克风。请在浏览器的地址栏里允许本网站使用麦克风，然后重试。',
		noMic: '没有找到麦克风。',
		recording: '录音中',
		stopped: '录音结束，正在分析……',
		calibrate: '正在测量底噪和音准',
		follow: '正在跟随你的演奏',
		render: '正在生成伴奏',
		tooShort: '录音太短，请至少演奏几个小节。',
		noPlaying: '没有检测到演奏。请检查麦克风是否选对、音量是否足够。',
		result: (r: Result) =>
			`伴奏演奏了 ${r.played} / ${r.total} 个位置；确认了 ${r.onsets} 个起音；` +
			(r.tempoRatio ? `你的平均速度约为 MIDI 原速的 ${(r.tempoRatio * 100).toFixed(0)}%；` : '') +
			`音准偏差 ${(r.calibration.tuning * 100).toFixed(0)} 音分。`,
		decodeFailed: '无法读取这个音频文件。',
	},
	en: {
		loading: 'Loading the score and the instrument sounds…',
		loaded: 'Ready.',
		loadFailed: 'Loading failed. Please reload the page and try again.',
		micDenied: 'The microphone could not be used. Allow this site to use the microphone in your browser’s address bar, then try again.',
		noMic: 'No microphone was found.',
		recording: 'Recording',
		stopped: 'Recording finished, analysing…',
		calibrate: 'Measuring the noise floor and tuning',
		follow: 'Following your playing',
		render: 'Generating the accompaniment',
		tooShort: 'The recording is too short. Please play at least a few bars.',
		noPlaying: 'No playing was detected. Check that the right microphone is selected and loud enough.',
		result: (r: Result) =>
			`The accompaniment played ${r.played} of ${r.total} positions; ${r.onsets} onsets confirmed; ` +
			(r.tempoRatio ? `your average tempo was about ${(r.tempoRatio * 100).toFixed(0)}% of the MIDI tempo; ` : '') +
			`tuning offset ${(r.calibration.tuning * 100).toFixed(0)} cents.`,
		decodeFailed: 'This audio file could not be read.',
	},
};

// 让类型检查知道这些数组用的是普通 ArrayBuffer / tell the type checker these arrays use a plain ArrayBuffer
const plain = (a: Float32Array) => new Float32Array(a.buffer as ArrayBuffer, a.byteOffset, a.length);

const $ = <T extends HTMLElement>(root: HTMLElement, sel: string) => root.querySelector(sel) as T;

export async function initPractice(root: HTMLElement): Promise<void> {
	const lang = (root.dataset.lang === 'en' ? 'en' : 'zh') as Lang;
	const t = TEXT[lang];
	const base = root.dataset.assets ?? '/accompaniment/';
	const status = $<HTMLParagraphElement>(root, '[data-status]');
	const progressBar = $<HTMLProgressElement>(root, '[data-progress]');
	const btnMic = $<HTMLButtonElement>(root, '[data-mic]');
	const selDevice = $<HTMLSelectElement>(root, '[data-device]');
	const meter = $<HTMLMeterElement>(root, '[data-meter]');
	const btnRecord = $<HTMLButtonElement>(root, '[data-record]');
	const btnStop = $<HTMLButtonElement>(root, '[data-stop]');
	const timer = $<HTMLSpanElement>(root, '[data-timer]');
	const fileInput = $<HTMLInputElement>(root, '[data-file]');
	const results = $<HTMLElement>(root, '[data-results]');
	const summary = $<HTMLParagraphElement>(root, '[data-summary]');
	const btnPlay = $<HTMLButtonElement>(root, '[data-play]');
	const btnPause = $<HTMLButtonElement>(root, '[data-pause]');
	const accVol = $<HTMLInputElement>(root, '[data-acc-volume]');
	const recVol = $<HTMLInputElement>(root, '[data-rec-volume]');
	const btnDownload = $<HTMLButtonElement>(root, '[data-download]');
	const versionInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[name="version"]'));

	const say = (msg: string) => {
		status.textContent = msg;
	};

	// ---------- 加载乐谱和音色 / load the score and sounds ----------
	let assets: Assets;
	say(t.loading);
	try {
		const [scoreJson, orchJson, sfBuf] = await Promise.all([
			fetch(`${base}score_m1_15.json`).then((r) => r.json()),
			fetch(`${base}orchestra_m1_15.json`).then((r) => r.json()),
			fetch(`${base}strings_fluidr3.sf2`).then((r) => r.arrayBuffer()),
		]);
		assets = makeAssets(scoreJson, orchJson, new SoundFont(sfBuf));
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
	let worklet: AudioWorkletNode | null = null;
	let chunks: Float32Array[] = [];
	let recording = false;
	let recStart = 0;
	let level = 0;

	const ensureContext = async () => {
		if (!ctx) {
			// 尽量用 48 kHz（与引擎一致）；浏览器不支持时稍后重采样 / prefer 48 kHz; otherwise resample later
			try {
				ctx = new AudioContext({ sampleRate: ANALYSIS_RATE, latencyHint: 'interactive' });
			} catch {
				ctx = new AudioContext({ latencyHint: 'interactive' });
			}
			await ctx.audioWorklet.addModule(`${base}recorder-worklet.js`);
		}
		if (ctx.state === 'suspended') await ctx.resume();
		return ctx;
	};

	const openMic = async (deviceId?: string) => {
		const ac = await ensureContext();
		stream?.getTracks().forEach((tr) => tr.stop());
		source?.disconnect();
		worklet?.disconnect();
		stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				deviceId: deviceId ? { exact: deviceId } : undefined,
				channelCount: 1,
				// 关闭浏览器的回声消除、降噪和自动增益：它们会改变音量和音色，干扰判断
				// Turn off echo cancellation, noise suppression and auto gain: they change level and timbre
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
			},
		});
		source = ac.createMediaStreamSource(stream);
		worklet = new AudioWorkletNode(ac, 'recorder-processor');
		worklet.port.onmessage = (e: MessageEvent<{ samples: Float32Array; rms: number }>) => {
			level = e.data.rms;
			if (recording) chunks.push(e.data.samples);
		};
		const mute = ac.createGain();
		mute.gain.value = 0; // 不把麦克风声音送到扬声器 / do not send the microphone to the speakers
		source.connect(worklet).connect(mute).connect(ac.destination);
		// 设备列表（获得权限后才有名称）/ device list (names are only available after permission)
		const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
		const current = stream.getAudioTracks()[0]?.getSettings().deviceId;
		selDevice.replaceChildren(
			...devices.map((d, i) => {
				const o = document.createElement('option');
				o.value = d.deviceId;
				o.textContent = d.label || `Microphone ${i + 1}`;
				o.selected = d.deviceId === current;
				return o;
			}),
		);
		selDevice.disabled = false;
		btnRecord.disabled = false;
	};

	btnMic.addEventListener('click', async () => {
		try {
			await openMic();
			btnMic.disabled = true;
		} catch (err) {
			console.error(err);
			say((err as DOMException)?.name === 'NotFoundError' ? t.noMic : t.micDenied);
		}
	});
	selDevice.addEventListener('change', () => openMic(selDevice.value).catch(() => say(t.micDenied)));

	// 音量条：显示相对满刻度的分贝 / level meter in dB relative to full scale
	const drawMeter = () => {
		const db = 20 * Math.log10(level + 1e-9);
		meter.value = Math.max(0, Math.min(1, (db + 80) / 80));
		if (recording) {
			const s = Math.floor((performance.now() - recStart) / 1000);
			timer.textContent = `${t.recording} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
		}
		requestAnimationFrame(drawMeter);
	};
	requestAnimationFrame(drawMeter);

	// ---------- 录音 / recording ----------
	btnRecord.addEventListener('click', () => {
		chunks = [];
		recording = true;
		recStart = performance.now();
		btnRecord.disabled = true;
		btnStop.disabled = false;
		results.hidden = true;
		stopPlayback();
	});

	btnStop.addEventListener('click', async () => {
		recording = false;
		btnStop.disabled = true;
		btnRecord.disabled = false;
		timer.textContent = '';
		const ac = ctx as AudioContext;
		const total = chunks.reduce((n, c) => n + c.length, 0);
		const x = new Float32Array(total);
		let p = 0;
		for (const c of chunks) {
			x.set(c, p);
			p += c.length;
		}
		say(t.stopped);
		await process(await toAnalysisRate(x, ac.sampleRate));
	});

	fileInput.addEventListener('change', async () => {
		const file = fileInput.files?.[0];
		if (!file) return;
		stopPlayback();
		results.hidden = true;
		try {
			const ac = await ensureContext();
			const decoded = await ac.decodeAudioData(await file.arrayBuffer());
			const mono = new Float32Array(decoded.length);
			for (let c = 0; c < decoded.numberOfChannels; c++) {
				const d = decoded.getChannelData(c);
				for (let i = 0; i < d.length; i++) mono[i] += d[i] / decoded.numberOfChannels;
			}
			await process(await toAnalysisRate(mono, decoded.sampleRate));
		} catch (err) {
			console.error(err);
			say(t.decodeFailed);
		} finally {
			fileInput.value = '';
		}
	});

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

	// ---------- 分析与生成 / analysis and generation ----------
	let recordingData: Float32Array | null = null;
	let result: Result | null = null;
	let gain = 1;

	async function process(x: Float32Array) {
		if (x.length < ANALYSIS_RATE * 3) {
			say(t.tooShort);
			return;
		}
		const version = (versionInputs.find((i) => i.checked)?.value ?? 'duet') as Version;
		progressBar.hidden = false;
		const stageName = { calibrate: t.calibrate, follow: t.follow, render: t.render };
		const weights = { calibrate: [0, 0.3], follow: [0.3, 0.4], render: [0.7, 0.3] } as const;
		const progress = (stage: keyof typeof weights, f: number) => {
			progressBar.value = weights[stage][0] + weights[stage][1] * f;
			say(`${stageName[stage]}……`);
		};
		try {
			const cal = await calibrate(x, progress);
			if (cal.voicedFrames < 100) {
				say(t.noPlaying);
				return;
			}
			result = await analyse(x, assets, version, cal, progress);
			recordingData = x;
			gain = autoGain(x, result.left, result.right);
			summary.textContent = t.result(result);
			results.hidden = false;
			say('');
		} finally {
			progressBar.hidden = true;
		}
	}

	// ---------- 播放 / playback ----------
	let playing: AudioBufferSourceNode[] = [];
	let accGainNode: GainNode | null = null;
	let recGainNode: GainNode | null = null;

	function stopPlayback() {
		for (const s of playing) {
			try {
				s.stop();
			} catch {
				/* already stopped */
			}
		}
		playing = [];
		btnPlay.disabled = false;
		btnPause.disabled = true;
	}

	const volumes = () => ({ acc: (Number(accVol.value) / 100) * gain, rec: Number(recVol.value) / 100 });

	btnPlay.addEventListener('click', async () => {
		if (!result || !recordingData) return;
		const ac = await ensureContext();
		stopPlayback();
		const rec = ac.createBuffer(1, recordingData.length, ANALYSIS_RATE);
		rec.copyToChannel(plain(recordingData), 0);
		const acc = ac.createBuffer(2, result.left.length, ANALYSIS_RATE);
		acc.copyToChannel(plain(result.left), 0);
		acc.copyToChannel(plain(result.right), 1);
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
		btnPlay.disabled = true;
		btnPause.disabled = false;
	});
	btnPause.addEventListener('click', stopPlayback);

	const updateVolumes = () => {
		const v = volumes();
		if (accGainNode) accGainNode.gain.value = v.acc;
		if (recGainNode) recGainNode.gain.value = v.rec;
	};
	accVol.addEventListener('input', updateVolumes);
	recVol.addEventListener('input', updateVolumes);

	btnDownload.addEventListener('click', () => {
		if (!result || !recordingData) return;
		const v = volumes();
		const n = result.left.length;
		const L = new Float32Array(n);
		const R = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const r = i < recordingData.length ? recordingData[i] * v.rec : 0;
			L[i] = r + result.left[i] * v.acc;
			R[i] = r + result.right[i] * v.acc;
		}
		const url = URL.createObjectURL(encodeWav(L, R, ANALYSIS_RATE));
		const a = document.createElement('a');
		a.href = url;
		a.download = 'accompaniment_mix.wav';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 10000);
	});
}
