// 重新生成实时伴奏的音频线程文件：只有修改了 src/lib/accompaniment/ 里的代码时才需要运行
// Rebuild the real-time audio-thread file; only needed after changing code in src/lib/accompaniment/
//     node scripts/build-worklet.mjs
// esbuild 是 Astro（Vite）自带的依赖，不需要另外安装 / esbuild comes with Astro (Vite); nothing extra to install
import { build } from 'esbuild';

await build({
	entryPoints: ['src/lib/accompaniment/realtime-processor.ts'],
	bundle: true,
	format: 'iife',
	target: 'es2020',
	outfile: 'public/accompaniment/realtime-worklet.js',
	banner: {
		js: '// 自动生成，请勿手动修改：源代码在 src/lib/accompaniment/realtime-processor.ts，用 node scripts/build-worklet.mjs 重新生成\n// Generated file, do not edit by hand: source in src/lib/accompaniment/realtime-processor.ts; rebuild with node scripts/build-worklet.mjs',
	},
});
console.log('Built public/accompaniment/realtime-worklet.js');
