import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// 文章：英文放在 src/content/blog/en/，中文放在 src/content/blog/zh/
// 同一篇文章的中英两个版本用相同的文件名，例如 en/hello-world.md 和 zh/hello-world.md
// Posts: English in src/content/blog/en/, Chinese in src/content/blog/zh/
// Two language versions of the same post share a file name, e.g. en/hello-world.md and zh/hello-world.md
const blog = defineCollection({
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// 日期建议写成 YYYY-MM-DD，例如 2026-11-10
			// Write dates as YYYY-MM-DD, e.g. 2026-11-10
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: z.optional(image()),
		}),
});

// 固定页面的正文（首页简介、关于、项目、实验室），每种语言一份
// Body text of the fixed pages (home intro, About, Projects, Lab), one file per language
const pages = defineCollection({
	loader: glob({ base: './src/content/pages', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
	}),
});

export const collections = { blog, pages };
