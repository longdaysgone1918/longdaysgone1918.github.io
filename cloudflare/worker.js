// tianranl.com 留言和点赞服务（Cloudflare Worker + D1）
// Comments and likes for tianranl.com (Cloudflare Worker + D1)
//
// 需要在 Worker 的设置里配置 / Configure in the Worker's settings:
//   绑定 Bindings:    DB  →  D1 数据库 / D1 database
//   密钥 Secrets:     ADMIN_PASSWORD   管理页面的密码 / password for the admin page
//                     TURNSTILE_SECRET Turnstile 的 Secret Key
//                     IP_SALT          任意一长串随机字符，用来给 IP 加盐 / any long random string, salts the IP hashes
//                     NOTIFY_EMAIL     （可选）新留言通知发到这个邮箱 / (optional) email address for new-comment notices
//                     NTFY_TOKEN       （可选，推荐）ntfy 账号的访问令牌 / (optional, recommended) access token of an ntfy account
//                     NTFY_TOPIC       （可选）ntfy 主题名；不设时自动生成 / (optional) ntfy topic; generated if unset
//
// 网页访问的接口 / Public API:
//   GET  /api/comments?thread=…   已通过的留言 / approved comments
//   POST /api/comments            提交留言（待审核）/ submit a comment (pending)
//   GET  /api/likes?thread=…      点赞数 / like count
//   POST /api/likes               点赞或取消 / like or unlike
// 管理 / Admin:
//   GET  /admin                   管理页面 / admin page
//   /api/admin/*                  需要密码 / password required
//   GET  /act?a=…&id=…&sig=…      通知里的一键操作（只对那一条留言有效）/ one-tap action from a notification (that comment only)

// ===================== 可以调整的设置 / Settings you may adjust =====================
const CONFIG = {
	// 允许调用这个服务的网站 / sites allowed to use this service
	ALLOWED_ORIGINS: ['https://tianranl.com', 'https://www.tianranl.com', 'http://localhost:4321'],
	SITE_URL: 'https://tianranl.com',
	OWNER_NAME: 'Tianran L', // 你回复时显示的名字 / name shown on your replies

	// 留言内容 / comment content
	NAME_MAX: 40,
	BODY_MIN: 2,
	BODY_MAX: 2000,
	REQUEST_MAX_BYTES: 16000,

	// 留言数量限制 / comment limits
	COMMENTS_PER_IP_PER_HOUR: 5, // 同一网络连接每小时最多几条 / per connection per hour
	COMMENTS_PER_IP_PER_DAY: 20, // 同一网络连接每天最多几条 / per connection per day
	COMMENTS_PER_DAY_TOTAL: 200, // 全站每天最多几条 / whole site per day
	PENDING_MAX: 300, // 待审核的留言超过这么多就暂停接收 / stop accepting when this many await review

	// 点赞数量限制 / like limits
	LIKES_PER_IP_PER_DAY: 200,
	LIKES_PER_DAY_TOTAL: 5000,

	// 管理密码输错的限制 / failed admin logins
	ADMIN_FAILURES_PER_HOUR: 10,

	// 审核方式 / moderation
	//   'auto'   = 新留言直接显示，只有可疑的留言（见下面两项）等你审核
	//              new comments show at once; only suspicious ones (see below) wait for review
	//   'review' = 所有留言都要审核 / every comment waits for review
	MODERATION: 'auto',
	LINKS_NEED_REVIEW: true, // 含链接的留言先不显示 / hold comments that contain links
	BLOCKED_WORDS: [], // 含这些词的留言先不显示，例如 ['casino', '代开发票'] / hold comments containing these words

	// 新留言通知：通过 ntfy 发邮件（需要设置 NOTIFY_EMAIL 密钥）/ new-comment notices: email via ntfy (needs NOTIFY_EMAIL)
	NTFY_SERVER: 'https://ntfy.sh',
	WORKER_URL: 'https://comments.tianranl.com', // 这个服务自己的网址，用于通知里的按钮 / this service's own address, for notification buttons
};
// 允许的文章编号格式，与网站的 commentId 一致 / allowed thread ids, matching the site's commentId
const THREAD_PATTERN = /^(essays|reviews|notes|projects|moments)\/[A-Za-z0-9-]{1,100}$/;
// ==================================================================================

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const origin = request.headers.get('Origin') || '';
		const cors = corsHeaders(origin);
		try {
			if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
			if (url.pathname === '/admin') return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
			if (url.pathname.startsWith('/api/admin/')) return await admin(request, env, url);
			if (url.pathname === '/api/comments' && request.method === 'GET') return await listComments(env, url, cors);
			if (url.pathname === '/api/comments' && request.method === 'POST') return await postComment(request, env, origin, cors, ctx);
			if (url.pathname === '/act') return await quickAction(env, url);
			if (url.pathname === '/api/likes' && request.method === 'GET') return await getLikes(request, env, url, cors);
			if (url.pathname === '/api/likes' && request.method === 'POST') return await postLike(request, env, origin, cors);
			if (url.pathname === '/') return new Response('ok', { headers: { 'Content-Type': 'text/plain' } });
			return json({ error: 'not_found' }, 404, cors);
		} catch (err) {
			console.error(err);
			return json({ error: 'server_error' }, 500, cors);
		}
	},
};

// ---------------- 公共接口 / public API ----------------

async function listComments(env, url, cors) {
	const thread = url.searchParams.get('thread') || '';
	if (!THREAD_PATTERN.test(thread)) return json({ error: 'invalid' }, 400, cors);
	const { results } = await env.DB.prepare(
		`SELECT id, parent_id, name, body, is_owner, created_at FROM comments
		 WHERE thread = ? AND status = 'approved' ORDER BY created_at ASC LIMIT 500`,
	)
		.bind(thread)
		.all();
	return json({ comments: results }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

async function postComment(request, env, origin, cors, ctx) {
	if (!CONFIG.ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden' }, 403, cors);
	const data = await readJson(request);
	if (!data) return json({ error: 'invalid' }, 400, cors);
	const thread = String(data.thread || '');
	const name = clean(data.name, CONFIG.NAME_MAX);
	const body = clean(data.body, CONFIG.BODY_MAX + 1, true);
	const lang = data.lang === 'en' ? 'en' : 'zh';
	if (!THREAD_PATTERN.test(thread) || !name || body.length < CONFIG.BODY_MIN || body.length > CONFIG.BODY_MAX) {
		return json({ error: 'invalid' }, 400, cors);
	}
	const ip = request.headers.get('CF-Connecting-IP') || '';
	// 人机验证 / bot check
	if (!(await verifyTurnstile(env, String(data.token || ''), ip))) return json({ error: 'captcha' }, 400, cors);
	const now = Date.now();
	const ipHash = await hashIp(env, ip);
	// 数量限制（一次查询算出四个数）/ limits, four counts in one query
	const c = await env.DB.prepare(
		`SELECT
		   (SELECT COUNT(*) FROM comments WHERE ip_hash = ?1 AND created_at > ?2) AS ip_hour,
		   (SELECT COUNT(*) FROM comments WHERE ip_hash = ?1 AND created_at > ?3) AS ip_day,
		   (SELECT COUNT(*) FROM comments WHERE created_at > ?3 AND is_owner = 0) AS total_day,
		   (SELECT COUNT(*) FROM comments WHERE status = 'pending') AS pending`,
	)
		.bind(ipHash, now - HOUR, now - DAY)
		.first();
	if (c.ip_hour >= CONFIG.COMMENTS_PER_IP_PER_HOUR || c.ip_day >= CONFIG.COMMENTS_PER_IP_PER_DAY) {
		return json({ error: 'rate_limited' }, 429, cors);
	}
	if (c.total_day >= CONFIG.COMMENTS_PER_DAY_TOTAL) return json({ error: 'daily_limit' }, 429, cors);
	if (c.pending >= CONFIG.PENDING_MAX) return json({ error: 'queue_full' }, 429, cors);
	const status = needsReview(name, body) ? 'pending' : 'approved';
	const res = await env.DB.prepare(
		`INSERT INTO comments (thread, name, body, lang, status, is_owner, ip_hash, created_at)
		 VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
	)
		.bind(thread, name, body, lang, status, ipHash, now)
		.run();
	const id = res.meta?.last_row_id;
	// 通知不耽误访客：在回应之后再发 / notify after responding, without making the visitor wait
	const job = notify(env, { id, thread, name, body, lang, status });
	if (ctx?.waitUntil) ctx.waitUntil(job);
	else await job;
	return json({ ok: true, pending: status === 'pending' }, 200, cors);
}

// 可疑的留言先不显示 / hold suspicious comments for review
function needsReview(name, body) {
	if (CONFIG.MODERATION !== 'auto') return true;
	const text = `${name}\n${body}`.toLowerCase();
	if (CONFIG.LINKS_NEED_REVIEW && /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|info|xyz|top|cn|ru|io|co|me|shop|site|online|link|click)\b)/i.test(text)) return true;
	return CONFIG.BLOCKED_WORDS.some((w) => w && text.includes(String(w).toLowerCase()));
}

// ---------------- 新留言通知 / new-comment notices ----------------
// 通过 ntfy 发送：设置了 NOTIFY_EMAIL 就发邮件；在 ntfy 应用里订阅主题也能收到推送
// Sent through ntfy: an email when NOTIFY_EMAIL is set; subscribing to the topic in the ntfy app also gives a push

async function notifyTopic(env) {
	if (env.NTFY_TOPIC) return env.NTFY_TOPIC;
	const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ntfy|${env.IP_SALT || ''}`));
	return `tianranl-${[...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function notify(env, c) {
	if ((!env.NOTIFY_EMAIL && !env.NTFY_TOPIC) || !c.id) return;
	let result;
	try {
		const page = `${CONFIG.SITE_URL}/${c.lang}/${c.thread}/`;
		const action = c.status === 'pending' ? 'approve' : 'hide';
		const actUrl = `${CONFIG.WORKER_URL}/act?a=${action}&id=${c.id}&sig=${await sign(env, action, c.id)}`;
		const held = c.status === 'pending';
		// 邮件里不一定有按钮，所以把链接也写进正文 / emails may not show buttons, so the links are in the text too
		const message = [
			`${c.name}：${c.body.slice(0, 1000)}`,
			'',
			held ? '这条留言含链接，正在等待审核。' : '这条留言已经显示在网站上。',
			`文章：${page}`,
			`${held ? '一键通过' : '一键隐藏'}：${actUrl}`,
			`管理页面：${CONFIG.WORKER_URL}/admin`,
		].join('\n');
		const payload = {
			topic: await notifyTopic(env),
			title: held ? `新留言待审核：${c.thread}` : `新留言：${c.thread}`,
			message,
			tags: [held ? 'warning' : 'speech_balloon'],
			click: page,
			actions: [
				{ action: 'view', label: held ? '通过' : '隐藏', url: actUrl, clear: true },
				{ action: 'view', label: '管理页面', url: `${CONFIG.WORKER_URL}/admin` },
			],
		};
		if (env.NOTIFY_EMAIL) payload.email = env.NOTIFY_EMAIL;
		const headers = { 'Content-Type': 'application/json' };
		if (env.NTFY_TOKEN) headers.Authorization = `Bearer ${env.NTFY_TOKEN}`;
		const r = await fetch(CONFIG.NTFY_SERVER, { method: 'POST', headers, body: JSON.stringify(payload) });
		result = { ok: r.ok, status: r.status, at: Date.now() };
		if (!r.ok) console.error('notify failed', r.status, await r.text().catch(() => ''));
	} catch (err) {
		console.error('notify failed', err);
		result = { ok: false, status: 0, at: Date.now() };
	}
	// 记下最近一次通知是否成功，管理页面会显示 / remember the last result; the admin page shows it
	try {
		await env.DB.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').bind('last_notify', JSON.stringify(result)).run();
	} catch {
		/* 没有 kv 表时忽略 / ignore if the kv table is missing */
	}
}

// 一键操作的签名：只对这一条留言、这一个动作有效 / signature for one action on one comment
async function sign(env, action, id) {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`act|${env.ADMIN_PASSWORD || ''}|${env.IP_SALT || ''}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${action}:${id}`));
	return [...new Uint8Array(mac)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 通知里的按钮：通过或隐藏一条留言 / notification buttons: approve or hide one comment
async function quickAction(env, url) {
	const action = url.searchParams.get('a');
	const id = Number(url.searchParams.get('id'));
	const sig = url.searchParams.get('sig') || '';
	const page = (msg) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>留言</title><body style="font-family:system-ui,sans-serif;max-width:30em;margin:3em auto;padding:0 1em;line-height:1.6"><p>${msg}</p><p><a href="/admin">打开管理页面</a></p></body>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
	if (!['approve', 'hide'].includes(action) || !Number.isInteger(id) || !env.ADMIN_PASSWORD || !(await sameSecret(sig, await sign(env, action, id)))) {
		return page('这个链接无效。');
	}
	const status = action === 'approve' ? 'approved' : 'pending';
	const r = await env.DB.prepare('UPDATE comments SET status = ? WHERE id = ? AND is_owner = 0').bind(status, id).run();
	if (!r.meta?.changes) return page('这条留言已经不存在了。');
	return page(action === 'approve' ? '已通过，这条留言现在会显示在网站上。' : '已隐藏。它会留在管理页面的“待审核”里，以后可以重新通过或删除。');
}

async function getLikes(request, env, url, cors) {
	const thread = url.searchParams.get('thread') || '';
	if (!THREAD_PATTERN.test(thread)) return json({ error: 'invalid' }, 400, cors);
	const ipHash = await hashIp(env, request.headers.get('CF-Connecting-IP') || '');
	return json(await likeState(env, thread, ipHash), 200, { ...cors, 'Cache-Control': 'no-store' });
}

async function postLike(request, env, origin, cors) {
	if (!CONFIG.ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden' }, 403, cors);
	const data = await readJson(request);
	const thread = String(data?.thread || '');
	if (!THREAD_PATTERN.test(thread)) return json({ error: 'invalid' }, 400, cors);
	const ipHash = await hashIp(env, request.headers.get('CF-Connecting-IP') || '');
	const now = Date.now();
	if (data.like === false) {
		await env.DB.prepare('DELETE FROM likes WHERE thread = ? AND ip_hash = ?').bind(thread, ipHash).run();
	} else {
		const c = await env.DB.prepare(
			`SELECT
			   (SELECT COUNT(*) FROM likes WHERE ip_hash = ?1 AND created_at > ?2) AS ip_day,
			   (SELECT COUNT(*) FROM likes WHERE created_at > ?2) AS total_day`,
		)
			.bind(ipHash, now - DAY)
			.first();
		if (c.ip_day >= CONFIG.LIKES_PER_IP_PER_DAY) return json({ error: 'rate_limited' }, 429, cors);
		if (c.total_day >= CONFIG.LIKES_PER_DAY_TOTAL) return json({ error: 'daily_limit' }, 429, cors);
		await env.DB.prepare('INSERT OR IGNORE INTO likes (thread, ip_hash, created_at) VALUES (?, ?, ?)')
			.bind(thread, ipHash, now)
			.run();
	}
	return json(await likeState(env, thread, ipHash), 200, cors);
}

async function likeState(env, thread, ipHash) {
	const r = await env.DB.prepare(
		`SELECT (SELECT COUNT(*) FROM likes WHERE thread = ?1) AS count,
		        (SELECT COUNT(*) FROM likes WHERE thread = ?1 AND ip_hash = ?2) AS mine`,
	)
		.bind(thread, ipHash)
		.first();
	return { count: r.count, liked: r.mine > 0 };
}

// ---------------- 管理接口 / admin API ----------------

async function admin(request, env, url) {
	const headers = { 'Cache-Control': 'no-store' };
	const ipHash = await hashIp(env, request.headers.get('CF-Connecting-IP') || '');
	const now = Date.now();
	const fails = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_failures WHERE ip_hash = ? AND created_at > ?')
		.bind(ipHash, now - HOUR)
		.first();
	if (fails.n >= CONFIG.ADMIN_FAILURES_PER_HOUR) return json({ error: 'locked' }, 429, headers);
	const auth = request.headers.get('Authorization') || '';
	const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
	if (!env.ADMIN_PASSWORD || !(await sameSecret(given, env.ADMIN_PASSWORD))) {
		await env.DB.prepare('INSERT INTO admin_failures (ip_hash, created_at) VALUES (?, ?)').bind(ipHash, now).run();
		return json({ error: 'unauthorized' }, 401, headers);
	}
	const action = url.pathname.slice('/api/admin/'.length);
	if (action === 'comments' && request.method === 'GET') {
		const status = url.searchParams.get('status') === 'approved' ? 'approved' : 'pending';
		const { results } = await env.DB.prepare(
			`SELECT id, thread, parent_id, name, body, lang, status, is_owner, created_at FROM comments
			 WHERE status = ? ORDER BY created_at DESC LIMIT 200`,
		)
			.bind(status)
			.all();
		const stats = await env.DB.prepare(
			`SELECT (SELECT COUNT(*) FROM comments WHERE status = 'pending') AS pending,
			        (SELECT COUNT(*) FROM comments WHERE status = 'approved') AS approved,
			        (SELECT COUNT(*) FROM likes) AS likes`,
		).first();
		const last = await env.DB.prepare("SELECT v FROM kv WHERE k = 'last_notify'").first().catch(() => null);
		stats.lastNotify = last ? JSON.parse(last.v) : null;
		stats.notifyConfigured = !!(env.NOTIFY_EMAIL || env.NTFY_TOPIC);
		return json({ comments: results, stats, siteUrl: CONFIG.SITE_URL }, 200, headers);
	}
	if (request.method !== 'POST') return json({ error: 'not_found' }, 404, headers);
	const data = (await readJson(request)) || {};
	const id = Number(data.id);
	if (action === 'approve') {
		await env.DB.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").bind(id).run();
		return json({ ok: true }, 200, headers);
	}
	if (action === 'delete') {
		await env.DB.prepare('DELETE FROM comments WHERE id = ? OR parent_id = ?').bind(id, id).run();
		return json({ ok: true }, 200, headers);
	}
	if (action === 'reply') {
		const body = clean(data.body, CONFIG.BODY_MAX, true);
		const parent = await env.DB.prepare('SELECT thread, lang FROM comments WHERE id = ?').bind(id).first();
		if (!parent || !body) return json({ error: 'invalid' }, 400, headers);
		// 回复时顺便通过原留言 / replying also approves the original comment
		await env.DB.batch([
			env.DB.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").bind(id),
			env.DB.prepare(
				`INSERT INTO comments (thread, parent_id, name, body, lang, status, is_owner, ip_hash, created_at)
				 VALUES (?, ?, ?, ?, ?, 'approved', 1, 'owner', ?)`,
			).bind(parent.thread, id, CONFIG.OWNER_NAME, body, parent.lang, now),
		]);
		return json({ ok: true }, 200, headers);
	}
	return json({ error: 'not_found' }, 404, headers);
}

// ---------------- 工具函数 / helpers ----------------

function corsHeaders(origin) {
	if (!CONFIG.ALLOWED_ORIGINS.includes(origin)) return { Vary: 'Origin' };
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};
}

function json(data, status, headers = {}) {
	return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

async function readJson(request) {
	const text = await request.text();
	if (text.length > CONFIG.REQUEST_MAX_BYTES) return null;
	try {
		const data = JSON.parse(text);
		return data && typeof data === 'object' ? data : null;
	} catch {
		return null;
	}
}

// 去掉控制字符和首尾空白，限制长度（保存纯文本，网页显示时也只当文字处理）
// Strip control characters and outer whitespace, cap the length (stored as plain text and shown as text only)
function clean(value, max, multiline = false) {
	let s = String(value ?? '').normalize('NFC');
	s = multiline ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '') : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
	s = s.trim();
	if (multiline) s = s.replace(/\n{3,}/g, '\n\n');
	return s.slice(0, max);
}

async function hashIp(env, ip) {
	const data = new TextEncoder().encode(`${env.IP_SALT || ''}|${ip}`);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 比较密码时不泄露时间差 / compare secrets without leaking timing
async function sameSecret(a, b) {
	const enc = new TextEncoder();
	const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
	const x = new Uint8Array(ha);
	const y = new Uint8Array(hb);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
	return diff === 0 && a.length > 0;
}

async function verifyTurnstile(env, token, ip) {
	if (!token || !env.TURNSTILE_SECRET) return false;
	const form = new FormData();
	form.append('secret', env.TURNSTILE_SECRET);
	form.append('response', token);
	if (ip) form.append('remoteip', ip);
	const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
	if (!r.ok) return false;
	const data = await r.json();
	return data.success === true;
}

// ---------------- 管理页面 / admin page ----------------
const ADMIN_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>留言管理</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;max-width:52em;margin:2em auto;padding:0 1em;color:#222;line-height:1.6}
button{padding:.3em .9em;margin:.15em .4em .15em 0;cursor:pointer}
.c{border:1px solid #ddd;border-radius:6px;padding:.7em 1em;margin:.8em 0}
.meta{color:#666;font-size:.85em}.body{white-space:pre-wrap;margin:.4em 0}
.owner{background:#f4f8ff}.tabs button.on{font-weight:700}
input[type=password]{padding:.4em;width:16em}#msg{color:#b00;min-height:1.4em}
</style></head><body>
<h1>留言管理</h1>
<div id="login"><p>请输入管理密码：</p><input type="password" id="pw"> <button id="go">登录</button></div>
<div id="app" hidden>
<p id="stats" class="meta"></p>
<p class="tabs"><button data-s="pending" class="on">待审核</button><button data-s="approved">已通过</button> <button id="logout">退出</button></p>
<div id="list"></div></div>
<p id="msg"></p>
<script>
const $=s=>document.querySelector(s);let pw=sessionStorage.getItem('pw')||'',status='pending';
async function api(path,body){const r=await fetch('/api/admin/'+path,{method:body?'POST':'GET',headers:{'Authorization':'Bearer '+pw,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 if(r.status===401){sessionStorage.removeItem('pw');pw='';show(false);throw new Error('密码不对');}
 if(r.status===429)throw new Error('密码输错太多次，请一小时后再试');
 if(!r.ok)throw new Error('出错了（'+r.status+'）');return r.json();}
function show(on){$('#login').hidden=on;$('#app').hidden=!on;}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
async function load(){$('#msg').textContent='';try{const d=await api('comments?status='+status);show(true);
 const n=d.stats.lastNotify;const note=!d.stats.notifyConfigured?'未设置邮件通知':(!n?'还没有发过通知':('最近一次通知：'+(n.ok?'成功':'失败（'+n.status+'）')+'，'+new Date(n.at).toLocaleString('zh-CN')));
 $('#stats').textContent='待审核 '+d.stats.pending+' 条 · 已通过 '+d.stats.approved+' 条 · 点赞 '+d.stats.likes+' 个 · '+note;
 const list=$('#list');list.replaceChildren();if(!d.comments.length)list.append(el('p','meta','没有留言。'));
 for(const c of d.comments){const box=el('div','c'+(c.is_owner?' owner':''));
  const link=el('a',null,c.thread+'（'+(c.lang==='en'?'英文版':'中文版')+'）');link.href=d.siteUrl+'/'+c.lang+'/'+c.thread+'/';link.target='_blank';
  const meta=el('div','meta');meta.append((c.is_owner?'你的回复 · ':c.name+' · ')+new Date(c.created_at).toLocaleString('zh-CN')+' · ',link);
  box.append(meta,el('div','body',c.body));
  if(c.status==='pending'){const b=el('button',null,'通过');b.onclick=()=>act('approve',{id:c.id});box.append(b);}
  if(!c.is_owner){const b=el('button',null,'回复');b.onclick=()=>{const t=prompt('回复内容（回复后原留言会一起通过）：');if(t)act('reply',{id:c.id,body:t});};box.append(b);}
  const del=el('button',null,'删除');del.onclick=()=>{if(confirm('删除这条留言（及其回复）？'))act('delete',{id:c.id});};box.append(del);
  list.append(box);}}catch(e){$('#msg').textContent=e.message;}}
async function act(a,b){try{await api(a,b);load();}catch(e){$('#msg').textContent=e.message;}}
$('#go').onclick=()=>{pw=$('#pw').value;sessionStorage.setItem('pw',pw);load();};
$('#pw').onkeydown=e=>{if(e.key==='Enter')$('#go').click();};
$('#logout').onclick=()=>{sessionStorage.removeItem('pw');pw='';show(false);};
document.querySelectorAll('.tabs button[data-s]').forEach(b=>b.onclick=()=>{status=b.dataset.s;document.querySelectorAll('.tabs button[data-s]').forEach(x=>x.classList.toggle('on',x===b));load();});
if(pw)load();
</script></body></html>`;
