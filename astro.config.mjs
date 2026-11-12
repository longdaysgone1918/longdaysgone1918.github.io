// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import { defineConfig, fontProviders } from 'astro/config';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

// https://astro.build/config
export default defineConfig({
	site: 'https://tianranl.com',
	// Markdown 处理器：用 unified（remark/rehype），以便运行公式插件
	// 数学公式：在 Markdown 里用 $...$（行内）和 $$...$$（单独一行）书写，构建时用 KaTeX 排版
	// Markdown processor: unified (remark/rehype), so the math plugins can run
	// Math: write $...$ (inline) and $$...$$ (display) in Markdown; KaTeX typesets them at build time
	markdown: {
		processor: unified({
			remarkPlugins: [remarkMath],
			rehypePlugins: [rehypeKatex],
		}),
	},
	integrations: [
		mdx(),
		sitemap({
			// 站点地图不收录：首页跳转页、实验区测试页面
			// Leave out of the sitemap: the root redirect page and the lab test pages
			filter: (page) => page !== 'https://tianranl.com/' && !page.includes('/lab/'),
		}),
	],
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Atkinson',
			cssVariable: '--font-atkinson',
			fallbacks: ['sans-serif'],
			options: {
				variants: [
					{
						src: ['./src/assets/fonts/atkinson-regular.woff'],
						weight: 400,
						style: 'normal',
						display: 'swap',
					},
					{
						src: ['./src/assets/fonts/atkinson-bold.woff'],
						weight: 700,
						style: 'normal',
						display: 'swap',
					},
				],
			},
		},
	],
});
