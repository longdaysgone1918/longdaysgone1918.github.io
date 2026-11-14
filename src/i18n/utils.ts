// 双语网站用到的小工具函数
// Small helper functions for the bilingual site

import { defaultLang, languages, ui, type Lang, type UiKey } from './ui';

export { defaultLang, htmlLang, languages, ogLocale, type Lang } from './ui';

export const langList = Object.keys(languages) as Lang[];

export function isLang(value: unknown): value is Lang {
	return typeof value === 'string' && value in languages;
}

// 从网址里读出当前语言，例如 /zh/essays/ → zh
// Read the current language from the URL, e.g. /zh/essays/ → zh
export function getLangFromUrl(url: URL): Lang {
	const [, firstSegment] = url.pathname.split('/');
	return isLang(firstSegment) ? firstSegment : defaultLang;
}

// 取得某个语言的界面文字：t('nav.essays')
// Get interface text for a language: t('nav.essays')
export function useTranslations(lang: Lang) {
	return (key: UiKey): string => ui[lang][key] ?? ui[defaultLang][key];
}

// 另一种语言（目前只有中英两种）
// The other language (the site currently has two)
export function otherLang(lang: Lang): Lang {
	return langList.find((l) => l !== lang) ?? defaultLang;
}

// 生成带语言前缀的网址：localizePath('zh', 'essays/') → /zh/essays/
// Build a language-prefixed path: localizePath('zh', 'essays/') → /zh/essays/
export function localizePath(lang: Lang, path = ''): string {
	const clean = path.replace(/^\/+/, '');
	return `/${lang}/${clean}`;
}

// 把网址里的语言换成另一种：/en/about/ → /zh/about/
// Swap the language in a path: /en/about/ → /zh/about/
export function swapLangInPath(pathname: string, target: Lang): string {
	const parts = pathname.split('/');
	if (isLang(parts[1])) {
		parts[1] = target;
		return parts.join('/');
	}
	return localizePath(target);
}

// 内容 id 形如 "en/hello-world"，拆成语言和文件名
// 也支持"一篇一个文件夹"的写法：zh/2015-10-15-520806298/index.md 和 zh/2015-10-15-520806298.md 效果相同
// Entry ids look like "en/hello-world"; split them into language and slug
// Folder-style entries also work: zh/2015-10-15-520806298/index.md behaves like zh/2015-10-15-520806298.md
export function splitPostId(id: string): { lang: Lang; slug: string } | null {
	const [first, ...rest] = id.replace(/\/index$/, '').split('/');
	if (!isLang(first) || rest.length === 0) return null;
	return { lang: first, slug: rest.join('/') };
}

// 给每个语言生成一份页面：/en/... 和 /zh/...
// Generate one copy of a page per language: /en/... and /zh/...
export function getLangStaticPaths() {
	return langList.map((lang) => ({ params: { lang } }));
}

// 按语言格式化日期。统一用 UTC，避免在不同时区预览时日期差一天
// Format a date for a language. UTC everywhere, so previews in other time zones never shift the day
export function formatDate(date: Date, lang: Lang): string {
	return date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	});
}

// 评论里作品信息的显示格式：中文《作品名》（作者，年份），英文 Title (Creator, Year)
// How a reviewed work is shown: Chinese 《Title》（Creator，Year）, English Title (Creator, Year)
export function formatWork(
	lang: Lang,
	work: { workTitle: string; creator?: string; year?: number },
): string {
	const extras = [work.creator, work.year].filter(Boolean).join(lang === 'zh' ? '，' : ', ');
	if (lang === 'zh') return `《${work.workTitle}》${extras ? `（${extras}）` : ''}`;
	return `${work.workTitle}${extras ? ` (${extras})` : ''}`;
}

// 冒号：中文用全角“：”，英文用半角“: ”
// Colon: full-width in Chinese, half-width plus space in English
export function colon(lang: Lang): string {
	return lang === 'zh' ? '：' : ': ';
}

// 日期加时间，用于动态：中文 2026年11月11日 14:30，英文 Nov 11, 2026, 14:30
// Date with time, for moments: Chinese 2026年11月11日 14:30, English Nov 11, 2026, 14:30
export function formatDateTime(date: Date, lang: Lang): string {
	return date.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
		timeZone: 'UTC',
	});
}

// 标签在网址里的写法：去掉首尾空格，转小写，空格换成连字符。中文保持不变
// How a tag appears in a URL: trimmed, lowercase, spaces become hyphens. Chinese stays as is
export function tagSlug(tag: string): string {
	return tag
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, '-')
		.replace(/[\/?#%\\"'<>]+/g, '');
}
