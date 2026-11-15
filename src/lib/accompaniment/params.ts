// 引擎内部参数：与 Python 稳定版（simulate_realtime.py）完全一致，请勿随意修改
// Internal engine constants: identical to the stable Python version (simulate_realtime.py); do not change casually

export const ENGINE = {
	TEMPO_PRIOR: 0.865, // 开始时假设的速度（相对 MIDI 原速）/ initial tempo guess relative to MIDI
	CONFIRM_FRAMES: 2, // 新音符需要连续几帧确认 / frames to confirm a new note
	REENTRY_CONFIRM_FRAMES: 6, // 休止或停顿后重新进入需要的帧数 / frames to confirm a re-entry
	PAUSE_SILENCE_FRAMES: 40, // 至少安静 0.4 秒才算停下 / at least 0.4 s of silence counts as a pause
	PAUSE_FREEZE: true, // 停顿时跟随器停在原处 / hold position while the player pauses
	PAUSE_SEC: 0.4, // 停顿判定时间 / pause detection time (s)
	UNFREEZE_FRAMES: 100, // 停顿中听到 1 秒像乐器但不是预期的音：认为在别处继续 / resume elsewhere
	LATE_DROP: 0.15, // 错过超过这么久的伴奏音直接跳过 / skip accompaniment notes missed by more than this (s)
	SELF_TAIL: 0.3, // 伴奏音结束后屏蔽还延续多久 / masking tail after an accompaniment note (s)
	ECHO_MAX_DELAY: 0.35, // 扬声器回声最多晚多少秒 / maximum loudspeaker echo delay (s)
	OBS_NOISE: 0.03, // 卡尔曼：起音观测噪声（秒）/ Kalman: onset observation noise (s)
	DRIFT_TIME: 0.02, // 卡尔曼：每拍的时间漂移 / Kalman: timing drift per quarter note (s)
	DRIFT_TEMPO: 0.03, // 卡尔曼：每拍的相对速度变化 / Kalman: relative tempo drift per quarter note
	SMOOTHING: true, // 平滑的相位校正 / smooth phase correction
	ALPHA: 0.8, // 每个四分音符修正多少比例的偏差 / fraction corrected per quarter note
	IOI_MIN: 0.8, // 间隔最多压缩到 0.8 倍 / shortest interval x nominal
	IOI_MAX: 1.25, // 间隔最多拉长到 1.25 倍 / longest interval x nominal
	SKIP_BEHIND_QN: 0.5, // 落后超过半拍时跳过填充音 / skip filler notes when behind by more than this (qn)
	RESYNC_QN: 1.0, // 偏差超过一拍时直接对齐 / snap when off by more than this (qn)
	SNAP_GUARD: true, // 直接对齐时也保持最小间隔 / keep a minimum interval when snapping
	SUSTAIN_MAX: 1.5, // 等待时伴奏音最多延长多少秒 / maximum sustain while waiting (s)
	MIN_IOI_RATIO: 0.5, // 仅在 SMOOTHING = false 时使用 / only used when SMOOTHING = false
	PATIENCE_SEC: 0.25, // 下一个音最多可以晚多久（固定部分）/ patience before stopping (s)
	PATIENCE_RATIO: 0.25, // 以及按乐谱间隔计算的部分 / plus this fraction of the expected interval
	HOP_SEC: 0.01, // 帧移 / frame hop (s)
};

export type FollowMode = 'strict' | 'predictive';
