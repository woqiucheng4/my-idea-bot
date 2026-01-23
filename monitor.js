const axios = require('axios');
const { Resend } = require('resend');
const fs = require('fs');
const { marked } = require('marked'); // Import marked for Markdown to HTML conversion
const { fetchGlobalTopPaid } = require('./appStoreMonitor');

const resend = new Resend(process.env.RESEND_API_KEY);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const HISTORY_FILE = './history.json';
const RANK_HISTORY_FILE = './rank_history.json';

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

// const RSSHUB_BASE = 'https://rsshub.app';
const RSSHUB_BASE = 'https://rsshub.rssforever.com'; // Mirror that works for V2EX
const RSSHUB_CONFIG = [
  {
    name: 'V2EX',
    url: `${RSSHUB_BASE}/v2ex/topics/latest?filter=求推荐|怎么没有|吐槽|痛点`,
    type: 'RSS',
    keywords: ['求推荐', '怎么没有', '吐槽', '痛点']
  },
  {
    name: 'Xiaohongshu (via Bing RSS)',
    // Direct Bing RSS: site:xiaohongshu.com (求推荐 OR 怎么没有 OR 吐槽)
    url: `https://www.bing.com/search?format=rss&q=site%3Axiaohongshu.com+%28%E6%B1%82%E6%8E%A8%E8%8D%90+OR+%E6%80%8E%E4%B9%88%E6%B2%A1%E6%9C%89+OR+%E5%90%90%E6%A7%BD%29`,
    type: 'SEARCH'
  },
  {
    name: 'Zhihu (via Bing RSS)',
    // Direct Bing RSS: site:zhihu.com/question (求推荐 OR 怎么没有 OR 吐槽)
    url: `https://www.bing.com/search?format=rss&q=site%3Azhihu.com%2Fquestion+%28%E6%B1%82%E6%8E%A8%E8%8D%90+OR+%E6%80%8E%E4%B9%88%E6%B2%A1%E6%9C%89+OR+%E5%90%90%E6%A7%BD%29`,
    type: 'SEARCH'
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

let rankHistory = {};
try {
  if (fs.existsSync(RANK_HISTORY_FILE)) {
    rankHistory = JSON.parse(fs.readFileSync(RANK_HISTORY_FILE, 'utf8') || '{}');
  }
} catch (e) { rankHistory = {}; }

// --- AI Analysis ---

async function callDeepSeek(itemOrItems, type = 'REDDIT') {
  if (!DEEPSEEK_API_KEY) return "AI Key 未配置";

  let systemPrompt = "";
  let userContent = "";

  if (type === 'APP') {
    const item = itemOrItems;
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

    userContent = `App Name: ${item.name}
Category: ${item.primaryGenre}
Price: ${item.priceFormatted}
Description: ${item.description ? item.description.slice(0, 500) + "..." : "No description"}
Region: ${item.region}`;

    if (item.rankDelta > 0) userContent += `\nTrend: Rising fast (+${item.rankDelta} positions)`;
    if (item.rating && item.rating < 3.8) userContent += `\nWarning: Low User Rating (${item.rating}/5)`;

  } else if (type === 'SOCIAL_BATCH') {
    // New logic for merging multiple social posts
    const items = itemOrItems;
    systemPrompt = `你是一个资深的产品挖掘专家。我依然给你看一组来自社交媒体（小红书/知乎/V2EX）的相关帖子。这些帖子讨论的可能是同一个软件、同一个痛点或同一类需求。
请你对这组信息进行【合并归纳分析】：

1. **核心话题归纳**：这些帖子在共同吐槽什么，或者在寻找什么样的工具？（用一句话总结）
2. **用户真实痛点**：用户不满意的点到底在哪里？（是太贵、功能缺失、还是体验差？）
3. **商机判断**：
   - 这是一个伪需求还是真刚需？
   - 如果你要做一个独立开发产品来解决这个问题，你会做什么？（给出一个 MVP 方案）

输出格式：请用 Markdown 输出，结构清晰。如果帖子内容完全不相关，请分别简短概括。`;

    userContent = `以下是收集到的相关讨论帖：\n\n`;
    items.forEach((it, idx) => {
      userContent += `[帖子 ${idx + 1}] 标题: ${it.title}\n来源: ${it.source}\n链接: ${it.url}\n\n`;
    });

  } else {
    // Reddit (Single Item)
    const item = itemOrItems;
    systemPrompt = `你是一个毒舌但专业的全栈开发和产品经理。请分析用户在社交媒体（Reddit/小红书/V2EX/知乎）上的吐槽或新需求：
1. 吐槽点/缺失点：用户最讨厌现有工具的哪一个具体功能或缺失？
2. 盈利机会：如果做一个“极简版”或“增强版”，用户愿意付钱吗？
3. 技术实现：给出一个 3 天内能写完的 MVP 功能建议。
请用中文回答。`;
    userContent = `标题: ${item.title}\nSource: ${item.source || item.subreddit}`;
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
      timeout: 60000
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
  let totalScanned = 0;

  for (const config of REDDIT_CONFIG) {
    try {
      // const url = `https://old.reddit.com/r/${config.subreddit}/new.rss`;
      const url = `https://snoo.habedieeh.re/r/${config.subreddit}/rss`; // Using Redlib instance to avoid 403
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        },
        timeout: 10000
      });
      const xml = response.data;
      const entryMatches = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g));

      let subredditMatches = 0;
      totalScanned += entryMatches.length;

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
          subredditMatches++;
        }
      }
      console.log(`[Reddit] r/${config.subreddit}: Scanned ${entryMatches.length} posts, found ${subredditMatches} relevant topics.`);
    } catch (e) {
      console.error(`[Reddit] Error r/${config.subreddit}: ${e.message}`);
    }
  }

  if (foundPosts.length === 0) {
    console.log('[Reddit] No relevant new topics found today.');
  } else {
    console.log(`[Reddit] Discovery finished. Total scanned: ${totalScanned}, Total relevant posts found: ${foundPosts.length}`);
  }

  return foundPosts.slice(0, 3); // Limit to top 3 new posts
}

// --- RSSHub Monitor ---

async function runRSSHubDiscovery() {
  console.log('[RSSHub] Starting discovery...');
  let foundItems = [];
  let totalScanned = 0;

  for (const config of RSSHUB_CONFIG) {
    try {
      // Use a browser-like user agent to avoid some blockings
      const response = await axios.get(config.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        timeout: 10000
      });
      const xml = response.data;

      // Match <item> (RSS 2.0) or <entry> (Atom)
      // RSSHub usually returns RSS 2.0 for these routes, but let's be safe
      const itemMatches = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g));

      totalScanned += itemMatches.length;
      let relevantCount = 0;

      for (const match of itemMatches) {
        const entry = match[1];
        const title = (entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        const link = (entry.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim();
        const guid = (entry.match(/<guid.*?>([\s\S]*?)<\/guid>/)?.[1] || link).trim();

        if (!title || !link) continue;
        if (history.includes(guid)) continue;

        // Double check keywords if needed (though RSSHub filter/search might have done it)
        // For search results, we trust the engine. For V2EX filter, we trust RSSHub.
        // We can just add them.

        foundItems.push({
          id: guid,
          source: config.name,
          title: title,
          url: link,
          type: 'SOCIAL'
        });
        relevantCount++;
      }
      console.log(`[RSSHub] ${config.name}: Scanned ${itemMatches.length} items, found ${relevantCount} new items.`);
    } catch (e) {
      console.error(`[RSSHub] Error ${config.name}: ${e.message}`);
    }
  }

  // Deduplicate by URL just in case
  const uniqueItems = [];
  const seenUrls = new Set();
  for (const item of foundItems) {
    if (!seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      uniqueItems.push(item);
    }
  }

  return uniqueItems.slice(0, 5); // Limit to top 5 social items
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
  console.log('[AppStore] Starting discovery (Rank Top 100)...');
  const limit = 100; // Apple RSS API max stable limit for V2 is 100. 200/300 often 500s.
  const [cnApps, usApps] = await Promise.all([
    fetchGlobalTopPaid('cn', limit),
    fetchGlobalTopPaid('us', limit)
  ]);

  const allFetched = [
    ...cnApps.map(a => ({ ...a, region: 'CN' })),
    ...usApps.map(a => ({ ...a, region: 'US' }))
  ];

  // 1. Update Rank History & Calculate Deltas
  const currentRanks = {};
  allFetched.forEach(app => {
    const key = `${app.region}_${app.id}`;
    currentRanks[key] = app.rank;
    const prevRank = rankHistory[key] || 301; // Assume it was outside top 300
    app.rankDelta = prevRank - app.rank;
  });

  // Filter for focus area: Rank 50-200 and not a game
  const targetPool = allFetched.filter(a => a.rank >= 50 && !a.isGame);

  // 1.5. Identify Arbitrage (US app not in CN Top 200)
  const cnIds = new Set(cnApps.map(a => a.id));
  targetPool.forEach(app => {
    if (app.region === 'US' && !cnIds.has(app.id)) {
      app.isArbitrage = true;
    }
  });

  // 2. Identify Interesting Apps
  // Filter out apps we've already analyzed
  const unanalyzedPool = targetPool.filter(a => !history.includes(a.id));

  // A. Fast Risers
  const fastRisers = unanalyzedPool
    .filter(a => a.rankDelta > 10) // Jumped more than 10 spots
    .sort((a, b) => b.rankDelta - a.rankDelta)
    .slice(0, 2);

  // B. Potential Complaints (Low Rating but still in Top 200)
  const lowRatingApps = unanalyzedPool
    .filter(a => a.rating > 0 && a.rating < 3.8)
    .filter(a => !fastRisers.find(r => r.id === a.id)) // Avoid duplicates
    .sort((a, b) => a.rating - b.rating)
    .slice(0, 2);

  // C. General High Priority from the rest
  let candidates = [...fastRisers, ...lowRatingApps];

  if (candidates.length < 3) {
    const remaining = unanalyzedPool
      .filter(a => !candidates.find(c => c.id === a.id))
      .map(a => ({ ...a, score: calculatePriority(a) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3 - candidates.length);
    candidates.push(...remaining);
  }

  // Save current ranks for next run (global side effect, but will be written at end of run())
  rankHistory = currentRanks;

  return candidates;
}

// --- Main Runner ---

async function run() {
  console.log('--- Global Monitor Started ---');

  // Parallel execution of discovery
  const [redditFindings, appFindings, rssFindings] = await Promise.all([
    runRedditDiscovery(),
    runAppStoreDiscovery(),
    runRSSHubDiscovery()
  ]);

  console.log(`--- Discovery Summary: Found ${redditFindings.length} Reddit topics, ${rssFindings.length} Social items, and ${appFindings.length} App Store apps. ---`);

  if (redditFindings.length === 0 && appFindings.length === 0 && rssFindings.length === 0) {
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
              <div style="color: #555; font-size: 14px; line-height: 1.6;">${marked.parse(analysis)}</div>
              <p><a href="${item.url}" style="color: #e67e22; font-weight: bold; text-decoration: none;">去 Reddit 围观 &rarr;</a></p>
            </div>`;
      history.push(item.id);
    }
  }

  // --- Process Social Media (RSSHub) ---
  if (rssFindings.length > 0) {
    emailHtml += `<h2 style="color: #8e44ad; border-bottom: 2px solid #8e44ad; padding-bottom: 5px; margin-top: 40px;">💬 社交媒体热议(CN) - 话题聚合</h2>`;

    // Call AI with ALL items at once
    console.log(`Analyzing Social Batch: ${rssFindings.length} items...`);
    const analysis = await callDeepSeek(rssFindings, 'SOCIAL_BATCH');

    // Add the Analysis Report
    emailHtml += `
        <div style="margin-bottom: 30px; padding: 15px; background-color: #fcf6ff; border-radius: 8px;">
            <h3 style="margin-top: 10px; color: #333;">🤖 AI 深度归纳报告</h3>
            <div style="color: #555; font-size: 14px; line-height: 1.6;">${marked.parse(analysis)}</div>
          </div>`;

    // List the individual sources below
    emailHtml += `<h4 style="color: #666; margin-top: 20px;">📌 参考原帖：</h4>`;
    for (const item of rssFindings) {
      emailHtml += `
        <div style="margin-bottom: 10px; padding: 10px; border-left: 3px solid #8e44ad; background-color: #f9f9f9;">
              <span style="background: #8e44ad; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 5px;">${item.source}</span>
              <a href="${item.url}" style="color: #333; text-decoration: none; font-weight: bold;">${item.title}</a>
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
      const trendBadge = app.rankDelta > 0 ? `<span style="background: #27ae60; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 5px;">📈 排名上升(+${app.rankDelta})</span>` : "";
      const complaintBadge = (app.rating && app.rating < 3.8) ? `<span style="background: #d35400; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-right: 5px;">⚠️ 吐槽较多(${app.rating}⭐)</span>` : "";

      emailHtml += `
        <div style="margin-bottom: 30px; padding: 15px; background-color: #f0f7fb; border-radius: 8px;">
          ${arbBadge} ${trendBadge} ${complaintBadge}
              <span style="background: #2980b9; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">${app.region} Rank ${app.rank}</span>
              <h3 style="margin-top: 10px; color: #333;">${app.name} <span style="font-weight: normal; font-size: 0.8em; color: #777;">(${app.primaryGenre} - ${app.priceFormatted})</span></h3>
              <div style="color: #555; font-size: 14px; line-height: 1.6;">${marked.parse(analysis)}</div>
              <p><a href="${app.appUrl}" style="color: #2980b9; font-weight: bold; text-decoration: none;">查看 App Store &rarr;</a></p>
            </div>`;
      history.push(app.id);
    }
  }

  // Update History
  if (history.length > 2000) history = history.slice(-1000);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  fs.writeFileSync(RANK_HISTORY_FILE, JSON.stringify(rankHistory, null, 2));

  // Send Email
  try {
    const data = await resend.emails.send({
      from: 'Global-Insight-Bot <onboarding@resend.dev>',
      to: RECEIVERS,
      subject: `[${new Date().toLocaleDateString()}]全球信息差 & 用户槽点日报`,
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
