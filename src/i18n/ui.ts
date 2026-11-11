// 网站支持的语言，以及界面上出现的所有固定文字（导航、按钮、提示等）
// Supported languages and every fixed piece of interface text (navigation, buttons, notices)

export const languages = {
	en: 'English',
	zh: '中文',
} as const;

export type Lang = keyof typeof languages;

// 默认语言：访问 tianranl.com 时跳转到这个语言
// Default language: visitors to the site root are sent here
export const defaultLang: Lang = 'en';

// <html lang="..."> 使用的语言代码
// Language codes used in <html lang="...">
export const htmlLang: Record<Lang, string> = {
	en: 'en',
	zh: 'zh-CN',
};

// Open Graph（社交平台分享卡片）使用的语言代码
// Language codes used by Open Graph (social sharing cards)
export const ogLocale: Record<Lang, string> = {
	en: 'en_US',
	zh: 'zh_CN',
};

const en = {
	'site.title': 'Tianran Liu',
	'site.description': 'Projects, notes, and experiments by Tianran Liu.',
	'nav.label': 'Main',
	'nav.home': 'Home',
	'nav.blog': 'Blog',
	'nav.projects': 'Projects',
	'nav.lab': 'Lab',
	'nav.about': 'About',
	'lang.switch': 'Read this site in Chinese',
	'home.latest': 'Latest posts',
	'home.allPosts': 'See all posts',
	'blog.title': 'Blog',
	'blog.description': 'Notes and articles.',
	'blog.empty': 'No posts in English yet.',
	'post.updated': 'Last updated',
	'post.noTranslation': 'This post isn’t available in Chinese yet.',
	'footer.name': 'Tianran Liu',
	'footer.rights': 'All rights reserved.',
	'footer.rss': 'RSS',
};

export type UiKey = keyof typeof en;

// 中文版必须包含和英文版完全相同的键，漏掉任何一个，编辑器都会提示
// The Chinese table must have exactly the same keys as the English one; the editor flags any that are missing
const zh: Record<UiKey, string> = {
	'site.title': 'Tianran Liu',
	'site.description': 'Tianran Liu 的项目、笔记与实验。',
	'nav.label': '主导航',
	'nav.home': '首页',
	'nav.blog': '文章',
	'nav.projects': '项目',
	'nav.lab': '实验室',
	'nav.about': '关于',
	'lang.switch': '切换到英文版',
	'home.latest': '最新文章',
	'home.allPosts': '查看全部文章',
	'blog.title': '文章',
	'blog.description': '笔记与文章。',
	'blog.empty': '还没有中文文章。',
	'post.updated': '最后更新于',
	'post.noTranslation': '本文暂无英文版。',
	'footer.name': 'Tianran Liu',
	'footer.rights': '保留所有权利。',
	'footer.rss': 'RSS 订阅',
};

export const ui: Record<Lang, Record<UiKey, string>> = { en, zh };
