// 双语网站用到的小工具函数
// Small helper functions for the bilingual site

import { defaultLang, languages, ui, type Lang, type UiKey } from './ui';

export { defaultLang, htmlLang, languages, ogLocale, type Lang } from './ui';

export const langList = Object.keys(languages) as Lang[];

export function isLang(value: unknown): value is Lang {
	return typeof value === 'string' && value in languages;
}

// 从网址里读出当前语言，例如 /zh/blog/ → zh
// Read the current language from the URL, e.g. /zh/blog/ → zh
export function getLangFromUrl(url: URL): Lang {
	const [, firstSegment] = url.pathname.split('/');
	return isLang(firstSegment) ? firstSegment : defaultLang;
}

// 取得某个语言的界面文字：t('nav.home')
// Get interface text for a language: t('nav.home')
export function useTranslations(lang: Lang) {
	return (key: UiKey): string => ui[lang][key] ?? ui[defaultLang][key];
}

// 另一种语言（目前只有中英两种）
// The other language (the site currently has two)
export function otherLang(lang: Lang): Lang {
	return langList.find((l) => l !== lang) ?? defaultLang;
}

// 生成带语言前缀的网址：localizePath('zh', 'blog/') → /zh/blog/
// Build a language-prefixed path: localizePath('zh', 'blog/') → /zh/blog/
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

// 文章 id 形如 "en/hello-world"，拆成语言和文章名
// Post ids look like "en/hello-world"; split them into language and slug
export function splitPostId(id: string): { lang: Lang; slug: string } | null {
	const [first, ...rest] = id.split('/');
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
