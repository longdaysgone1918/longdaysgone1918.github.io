// 相册设置 / Gallery settings
//
// 每个相册就是 src/assets/gallery/ 下面的一个文件夹，例如 src/assets/gallery/boston-2026/。
// 照片丢进对应的文件夹就会自动出现，不用在这里登记。直接放在 src/assets/gallery/ 里的照片归入“未分类”。
// 文件夹名会出现在网址里，建议用英文、数字和连字符，例如 boston-2026。
// Each album is a folder inside src/assets/gallery/, e.g. src/assets/gallery/boston-2026/.
// Photos dropped into a folder appear automatically. Photos directly in src/assets/gallery/ go to "Unsorted".
// Folder names appear in the web address: use English letters, numbers and hyphens, e.g. boston-2026.

// 相册首页顶部的简介，留空就不显示 / introduction on the gallery's main page; empty = not shown
export const GALLERY_DESCRIPTION = '';

// 排列顺序按名字：true = 倒序。手机照片和以年份开头的文件夹名（如 2026-boston），倒序就是最新的在前
// Order by name: true = reverse. For phone photos and folders named with the year first (e.g. 2026-boston),
// reverse order puts the newest first
export const NEWEST_FIRST = true;

// 可选：相册显示的名字和简介。不写的相册直接显示文件夹名
// Optional: display names and descriptions of albums. Albums not listed show their folder name
export const ALBUMS: Record<string, { title?: string; description?: string }> = {
	// 'boston-2026': { title: '波士顿 2026', description: '' },
};

// 可选：给个别照片加标题，按文件名 / optional captions for individual photos, by file name
export const CAPTIONS: Record<string, string> = {
	// 'IMG_20261120_143522.jpg': '波士顿港的傍晚',
};
