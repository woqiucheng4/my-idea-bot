const axios = require('axios');
const { Resend } = require('resend');
const fs = require('fs');
const { fetchGlobalTopPaid } = require('./appStoreMonitor');

const resend = new Resend(process.env.RESEND_API_KEY);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const HISTORY_FILE = './history.json';

// --- 配置区 ---
const RECEIVERS = ['chadqiu0721@gmail.com'];

const REDDIT_CONFIG = [
  {
    subreddit: 'SaaS',
    keywords: [
      { word: 'alternative to', weight: 3 },
      { word: 'bloated', weight: 3 },
      { word: 'too complex', weight: 2 },
      { word: 'missing', weight: 2 }
    ]
  },
  {
    subreddit: 'Productivity',
    keywords: [
      { word: 'too many features', weight: 3 },
      { word: 'simple alternative', weight: 3 },
      { word: 'tired of', weight: 1 },
      { word: 'overwhelming', weight: 2 }
    ]
  },
  {
    subreddit: 'AppIdeas',
    keywords: [
      { word: 'does this exist', weight: 3 },
      { word: 'request', weight: 2 },
      { word: 'someone build', weight: 3 }
    ]
  },
  {
    subreddit: 'Shopify',
    keywords: [
      { word: 'too slow', weight: 2 },
      { word: 'missing feature', weight: 3 },
      { word: 'expensive app', weight: 2 }
    ]
  }
];

const SCORE_THRESHOLD = 3;

// --- 逻辑区 ---

let history = [];
try {
  if (fs.existsSync(HISTORY_FILE)) {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8') || '[]');
  }
} catch (e) { history = []; }

// --- AI Analysis ---

async function callDeepSeek(item, type = 'REDDIT') {
  if (!DEEPSEEK_API_KEY) return "AI Key 未配置";

  let systemPrompt = "";
  let userContent = "";

  if (type === 'APP') {
    systemPrompt = `你是一位拥有 10 年经验的全球化产品经理和全栈开发者。你的任务是分析 App Store 榜单中的潜在商机。
分析维度：
1. 核心痛点 (Core Painpoint)：用一句话说明它解决了什么刚需。
2. 技术门槛 (Tech Difficulty)：打分 $1-10$。如果是个人开发者 1-2 个月能完成的 MVP，分数应 $\\le 5$。
3. 信息差/套利分析 (Global Arbitrage)：
   - 如果是 [US] 区 App：分析其功能是否在中国区有竞品？是否有本地化（如微信集成、中文习惯）的优化空间？
   - 如果是 [CN] 区 App：分析其模式是否可以推向海外（如出海做工具类）。
4. 精简版 MVP 方案：如果只做 20% 的核心功能，你应该做哪一个功能？
5. 盈利建议：建议定价策略（订阅制 vs 买断制）及目标客单价。

输出要求： 语言简练，直击要害，拒绝废话。使用 Markdown 格式。`;

    // Construct rich context for the App
    userContent = `App Name: ${item.name}
Category: ${item.primaryGenre}
Price: ${item.priceFormatted}
Description: ${item.description ? item.description.slice(0, 500) + "..." : "No description"}
Region: ${item.region}`;

  } else {
    // Reddit Prompt
    systemPrompt = `你是一个毒舌但专业的全栈开发和产品经理。请分析用户对现有App的吐槽或新需求：
1. 吐槽点/缺失点：用户最讨厌现有工具的哪一个具体功能或缺失？
2. 盈利机会：如果做一个“极简版”或“增强版”，用户愿意付钱吗？
3. 技术实现：给出一个 3 天内能写完的 MVP 功能建议。
请用中文回答。`;
    userContent = `标题: ${item.title}\nSubreddit: ${item.subreddit}`;
  }

  try {
    const response = await axios.post('https://api.deepseek.com/chat/completions', {
      model: "deepseek-chat",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ]
    }, {
      headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      timeout: 60000 // 60s timeout for longer analysis
    });
    return response.data.choices[0].message.content;
  } catch (e) {
    return `AI 分析失败: ${e.message}`;
  }
}

// --- Reddit Monitor ---

async function runRedditDiscovery() {
  console.log('[Reddit] Starting discovery...');
  let foundPosts = [];
  for (const config of REDDIT_CONFIG) {
    try {
      const url = `https://www.reddit.com/r/${config.subreddit}/new.rss`;
      const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 Reeder/5.0' } });
      const xml = response.data;
      const entryMatches = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g));

      for (const match of entryMatches) {
        const entry = match[1];
        const title = (entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        const link = entry.match(/<link href="([\s\S]*?)"/)?.[1] || '';
        const id = link.split('/').slice(-3, -2)[0] || link;

        if (history.includes(id)) continue;

        const titleLower = title.toLowerCase();
        let currentScore = 0;
        config.keywords.forEach(k => {
          if (titleLower.includes(k.word)) currentScore += k.weight;
        });

        if (currentScore >= SCORE_THRESHOLD) {
          foundPosts.push({ id, subreddit: config.subreddit, title, url: link, type: 'REDDIT' });
        }
      }
    } catch (e) { console.error(`[Reddit] Error r/${config.subreddit}: ${e.message}`); }
  }
  return foundPosts.slice(0, 3); // Limit to top 3 new posts
}

// --- App Store Monitor ---

function calculatePriority(app) {
  // PriorityScore = (200 - Rank) / 200 * PriceFactor
  // PriceFactor: 1.5 if 0 < price < 50, 1.2 if Productivity/Efficiency
  let score = (200 - app.rank) / 200;

  const priceNum = app.price || 0;

  // High quality paid apps often between $0.99 and $10 for tools
  if (priceNum > 0 && priceNum < 10) score *= 1.5;

  if (app.primaryGenre === 'Efficiency' || app.primaryGenre === 'Productivity' || app.primaryGenre === 'Utilities') {
    score *= 1.2;
  }

  return score;
}

async function runAppStoreDiscovery() {
  console.log('[AppStore] Starting discovery...');
  // 1. Fetch data
  const [cnApps, usApps] = await Promise.all([
    fetchGlobalTopPaid('cn', 50),
    fetchGlobalTopPaid('us', 50)
  ]);

  const cnIds = new Set(cnApps.map(a => a.id));

  // 2. Identify Arbitrage Opportunities
  // Logic: High rank in US (Top 100), but NOT in CN Top 200
  const highPotentialArbitrage = usApps
    .filter(app => !app.isGame)
    .filter(app => !cnIds.has(app.id));

  console.log(`[AppStore] Found ${highPotentialArbitrage.length} potential arbitrage apps.`);

  // 3. Select candidates for AI analysis
  // We want a mix: some US Arbitrage apps, some new interesting CN/US apps we haven't seen.
  // For MVP, let's just pick:
  // - Top 1 US Arbitrage App (highest rank)
  // - Top 1 CN Paid App (that we haven't seen)
  // - Top 1 US Paid App (that we haven't seen)

  let candidates = [];

  // Arbitrage Candidate
  const arbitrageCandidate = highPotentialArbitrage.find(app => !history.includes(app.id));
  if (arbitrageCandidate) {
    candidates.push({ ...arbitrageCandidate, region: 'US', isArbitrage: true });
  }

  // Normal Candidates (sort by Priority Score)
  const allApps = [
    ...cnApps.map(a => ({ ...a, region: 'CN' })),
    ...usApps.map(a => ({ ...a, region: 'US' }))
  ];

  // Javascript sort is in-place, create copy
  const sortedApps = allApps
    .filter(a => !a.isGame)
    .filter(a => !history.includes(a.id) && !candidates.find(c => c.id === a.id))
    .map(a => ({ ...a, score: calculatePriority(a) }))
    .sort((a, b) => b.score - a.score);

  // Take top 2 from general pool
  candidates.push(...sortedApps.slice(0, 2));

  return candidates;
}

// --- Main Runner ---

async function run() {
  console.log('--- Global Monitor Started ---');

  // Parallel execution of discovery
  const [redditFindings, appFindings] = await Promise.all([
    runRedditDiscovery(),
    runAppStoreDiscovery()
  ]);

  if (redditFindings.length === 0 && appFindings.length === 0) {
    console.log('No new insights found today.');
    return;
  }

  let emailHtml = `<h1 style="color: #2c3e50;">🌍 全球商业情报日报 (${new Date().toLocaleDateString()})</h1>`;

  // --- Process Reddit ---
  if (redditFindings.length > 0) {
    emailHtml += `<h2 style="color: #e67e22; border-bottom: 2px solid #e67e22; padding-bottom: 5px;">🔥 用户槽点 (Reddit)</h2>`;
    for (const item of redditFindings) {
      console.log(`Analyzing Reddit: ${item.title}`);
      const analysis = await callDeepSeek(item, 'REDDIT');

      emailHtml += `
            <div style="margin-bottom: 30px; padding: 15px; background-color: #fffaf5; border-radius: 8px;">
              <span style="background: #e67e22; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">r/${item.subreddit}</span>
              <h3 style="margin-top: 10px; color: #333;">${item.title}</h3>
              <div style="color: #555; font-size: 14px; line-height: 1.6;">${analysis.replace(/\n/g, '<br>')}</div>
              <p><a href="${item.url}" style="color: #e67e22; font-weight: bold; text-decoration: none;">去 Reddit 围观 &rarr;</a></p>
            </div>`;
      history.push(item.id);
    }
  }

  // --- Process App Store ---
  if (appFindings.length > 0) {
    emailHtml += `<h2 style="color: #2980b9; border-bottom: 2px solid #2980b9; padding-bottom: 5px; margin-top: 40px;">📱 App Store 商机洞察</h2>`;
    for (const app of appFindings) {
      console.log(`Analyzing App: ${app.name} (${app.region})`);
      const analysis = await callDeepSeek(app, 'APP');
      const arbBadge = app.isArbitrage ? `<span style="background: #c0392b; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 5px;">🔥 全球信息差</span>` : "";

      emailHtml += `
            <div style="margin-bottom: 30px; padding: 15px; background-color: #f0f7fb; border-radius: 8px;">
              ${arbBadge}
              <span style="background: #2980b9; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">${app.region} Top Paid</span>
              <h3 style="margin-top: 10px; color: #333;">${app.name} <span style="font-weight: normal; font-size: 0.8em; color: #777;">(${app.primaryGenre} - ${app.priceFormatted})</span></h3>
              <div style="color: #555; font-size: 14px; line-height: 1.6;">${analysis.replace(/\n/g, '<br>')}</div>
              <p><a href="${app.appUrl}" style="color: #2980b9; font-weight: bold; text-decoration: none;">查看 App Store &rarr;</a></p>
            </div>`;
      history.push(app.id);
    }
  }

  // Update History
  if (history.length > 2000) history = history.slice(-1000);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  // Send Email
  try {
    const data = await resend.emails.send({
      from: 'Global-Insight-Bot <onboarding@resend.dev>',
      to: RECEIVERS,
      subject: `[${new Date().toLocaleDateString()}] 全球信息差 & 用户槽点日报`,
      html: emailHtml
    });

    if (data.error) {
      console.error('❌ 邮件发送失败 (Resend Error):', data.error);
    } else {
      console.log('✅ 邮件推送成功！ID:', data.data ? data.data.id : 'N/A');
    }
  } catch (e) {
    console.error('❌ 邮件发送异常:', e.message);
  }
}

run();
