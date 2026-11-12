# 内容模板 / Content templates

新建内容时，复制对应的模板到正确的文件夹，改文件名和内容即可。这个文件夹不会出现在网站上。

To add an entry, copy the matching template into the right folder, then rename it and fill it in. This folder is not part of the website.

| 模板 Template | 复制到 Copy to |
| --- | --- |
| essay.md | src/content/essays/en/ 或 / or src/content/essays/zh/ |
| review.md | src/content/reviews/en/ 或 / or src/content/reviews/zh/ |
| note.md | src/content/notes/en/ 或 / or src/content/notes/zh/ |
| project.md | src/content/projects/en/ 或 / or src/content/projects/zh/ |
| moment.md | src/content/moments/en/ 或 / or src/content/moments/zh/ |

文件名用英文小写字母和连字符，例如 my-first-review.md；中英两个版本用相同的文件名。

Use lowercase letters and hyphens in file names, e.g. my-first-review.md; both language versions share the same file name.

动态没有标题，文件名建议用日期开头，例如 2026-11-11-trip.md。

Moments have no title; start their file names with the date, e.g. 2026-11-11-trip.md.

数学公式用 LaTeX 写法：行内公式写在 $...$ 之间，单独一行的公式写在 $$...$$ 之间，所有板块都可以用。note.md 里有示例。

Math uses LaTeX syntax: inline math between $...$, display math between $$...$$, in any section. See note.md for an example.

注意：开启公式功能后，同一段里出现两个 $ 会被当成公式。要写美元金额，在 $ 前加反斜杠，例如 \$12。

Note: with math enabled, two $ signs in one paragraph are read as a formula. For dollar amounts, put a backslash before the $, e.g. \$12.
