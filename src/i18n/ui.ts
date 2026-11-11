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
	'site.description': 'Essays, reviews, notes, and projects by Tianran Liu.',
	'nav.label': 'Main',
	'nav.essays': 'Essays',
	'nav.reviews': 'Reviews',
	'nav.notes': 'Notes',
	'nav.projects': 'Projects',
	'nav.moments': 'Moments',
	'nav.search': 'Search',
	'nav.about': 'About',
	'lang.switch': 'Read this site in Chinese',

	'home.latest': 'Latest',

	'essays.title': 'Essays',
	'essays.description': 'Reflections, personal stories, and other writing.',
	'reviews.title': 'Reviews',
	'reviews.description': 'Thoughts on music, games, films, and books.',
	'notes.title': 'Notes',
	'notes.description': 'Study and research notes, updated over time.',
	'projects.title': 'Projects',
	'projects.description': 'Things I’ve built and things I’m building.',
	'moments.title': 'Moments',
	'moments.description': 'Short thoughts, without titles.',
	'moments.permalink': 'Link',
	'moments.all': 'All moments',
	'tags.title': 'Tags',
	'tags.description': 'Every tag used on this site.',
	'tags.tagged': 'Tagged',
	'search.title': 'Search',
	'search.description': 'Search everything on this site.',
	'search.unavailable': 'Search is not available in the local preview. Run npm run build, then npm run preview.',

	'list.empty': 'Nothing in English here yet.',
	'list.all': 'All',

	'review.type.music': 'Music',
	'review.type.game': 'Games',
	'review.type.film': 'Film',
	'review.type.book': 'Books',

	'note.topic': 'Topic',
	'note.updated': 'Updated',
	'note.otherTopic': 'Other',

	'project.status.active': 'In progress',
	'project.status.completed': 'Completed',
	'project.links': 'Links',

	'entry.updated': 'Last updated',
	'entry.noTranslation': 'This page isn’t available in Chinese yet.',

	'comments.title': 'Comments',
	'comments.note': 'Comments appear after review. Your name is shown publicly.',

	'footer.name': 'Tianran Liu',
	'footer.rights': 'All rights reserved.',
	'footer.rss': 'RSS',
	'footer.tags': 'Tags',
};

export type UiKey = keyof typeof en;

// 中文版必须包含和英文版完全相同的键，漏掉任何一个，编辑器都会提示
// The Chinese table must have exactly the same keys as the English one; the editor flags any that are missing
const zh: Record<UiKey, string> = {
	'site.title': 'Tianran Liu',
	'site.description': 'Tianran Liu 的随笔、评论、笔记与项目。',
	'nav.label': '主导航',
	'nav.essays': '随笔',
	'nav.reviews': '评论',
	'nav.notes': '笔记',
	'nav.projects': '项目',
	'nav.moments': '动态',
	'nav.search': '搜索',
	'nav.about': '关于',
	'lang.switch': '切换到英文版',

	'home.latest': '最近更新',

	'essays.title': '随笔',
	'essays.description': '随想、杂文与个人经历。',
	'reviews.title': '评论',
	'reviews.description': '关于音乐、游戏、电影和书籍的评论。',
	'notes.title': '笔记',
	'notes.description': '学习与研究笔记，会持续更新。',
	'projects.title': '项目',
	'projects.description': '做过的和正在做的项目。',
	'moments.title': '动态',
	'moments.description': '不用标题的短想法。',
	'moments.permalink': '链接',
	'moments.all': '全部动态',
	'tags.title': '标签',
	'tags.description': '网站上用到的所有标签。',
	'tags.tagged': '标签',
	'search.title': '搜索',
	'search.description': '搜索网站上的所有内容。',
	'search.unavailable': '本地预览时搜索不可用。请先运行 npm run build，再运行 npm run preview。',

	'list.empty': '这里还没有中文内容。',
	'list.all': '全部',

	'review.type.music': '音乐',
	'review.type.game': '游戏',
	'review.type.film': '电影',
	'review.type.book': '书籍',

	'note.topic': '主题',
	'note.updated': '更新于',
	'note.otherTopic': '其他',

	'project.status.active': '进行中',
	'project.status.completed': '已完成',
	'project.links': '相关链接',

	'entry.updated': '最后更新于',
	'entry.noTranslation': '本页暂无英文版。',

	'comments.title': '留言',
	'comments.note': '留言审核后才会显示。昵称会公开显示。',

	'footer.name': 'Tianran Liu',
	'footer.rights': '保留所有权利。',
	'footer.rss': 'RSS 订阅',
	'footer.tags': '标签',
};

export const ui: Record<Lang, Record<UiKey, string>> = { en, zh };
