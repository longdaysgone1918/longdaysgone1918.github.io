import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// 每个板块的内容都分成 en/ 和 zh/ 两个文件夹
// 同一篇内容的中英两个版本用相同的文件名，例如 essays/en/hello-world.md 和 essays/zh/hello-world.md
// Every section keeps its content in an en/ and a zh/ folder
// Two language versions of the same entry share a file name, e.g. essays/en/hello-world.md and essays/zh/hello-world.md

// 所有板块共用的字段。日期写成 YYYY-MM-DD，例如 2026-11-10
// Fields shared by every section. Write dates as YYYY-MM-DD, e.g. 2026-11-10
const baseFields = (image: () => any) => ({
	title: z.string(),
	description: z.string(),
	pubDate: z.coerce.date(),
	updatedDate: z.coerce.date().optional(),
	heroImage: z.optional(image()),
	// 标签：可以跨板块，例如 ['BWV 1043', 'Bach']
	// Tags, shared across sections, e.g. ['BWV 1043', 'Bach']
	tags: z.array(z.string()).optional(),
});

// 动态的发布时间，写成 '2026-11-11 14:30'。按字面理解，不随电脑所在时区变化
// Publication time of a moment, written as '2026-11-11 14:30'. Taken literally, never shifted by time zone
const momentTime = z.union([z.string(), z.date()]).transform((value) => {
	if (value instanceof Date) return value;
	const text = value.trim().replace(' ', 'T');
	const withTime = text.includes('T') ? text : `${text}T00:00`;
	const withSeconds = /T\d{2}:\d{2}$/.test(withTime) ? `${withTime}:00` : withTime;
	const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(withSeconds);
	return new Date(hasZone ? withSeconds : `${withSeconds}Z`);
});

// 随笔：杂文、随想、个人经历
// Essays: reflections, personal stories
const essays = defineCollection({
	loader: glob({ base: './src/content/essays', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) => z.object(baseFields(image)),
});

// 评论：音乐、游戏、电影、书籍
// Reviews: music, games, films, books
const reviews = defineCollection({
	loader: glob({ base: './src/content/reviews', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			...baseFields(image),
			// 作品类型：music 音乐 / game 游戏 / film 电影 / book 书籍
			// Type of work: music / game / film / book
			mediaType: z.enum(['music', 'game', 'film', 'book']),
			// 作品名、作者（艺术家/导演/开发商/作者）、年份
			// Title of the work, its creator (artist/director/developer/author), and year
			workTitle: z.string(),
			creator: z.string().optional(),
			year: z.number().optional(),
		}),
});

// 笔记：学习和研究笔记，按主题分组
// Notes: study and research notes, grouped by topic
const notes = defineCollection({
	loader: glob({ base: './src/content/notes', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			...baseFields(image),
			topic: z.string().optional(),
		}),
});

// 项目
// Projects
const projects = defineCollection({
	loader: glob({ base: './src/content/projects', pattern: '**/*.{md,mdx}' }),
	schema: ({ image }) =>
		z.object({
			...baseFields(image),
			// active 进行中 / completed 已完成
			status: z.enum(['active', 'completed']),
			links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
		}),
});

// 动态：不用标题的短内容
// Moments: short posts without a title
const moments = defineCollection({
	loader: glob({ base: './src/content/moments', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		pubDate: momentTime,
		tags: z.array(z.string()).optional(),
	}),
});

// 固定页面的正文：首页简介、关于
// Body text of the fixed pages: home intro and About
const pages = defineCollection({
	loader: glob({ base: './src/content/pages', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
	}),
});

export const collections = { essays, reviews, notes, projects, moments, pages };
