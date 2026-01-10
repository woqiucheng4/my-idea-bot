const axios = require('axios');
const { Resend } = require('resend');
const fs = require('fs');

const resend = new Resend(process.env.RESEND_API_KEY);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const HISTORY_FILE = './history.json';

// --- 配置区 ---
const RECEIVERS = ['chadqiu0721@gmail.com'];

const MONITOR_CONFIG = [
  { 
    subreddit: 'SaaS', 
    keywords: [
      { word: 'alternative to', weight: 3 },
      { word: 'bloated', weight: 3 }, // 吐槽臃肿
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

async function analyzeWithAI(title, subreddit) {
  if (!DEEPSEEK_API_KEY) return "AI Key 未配置";
  try {
    const response = await axios.post('https://api.deepseek.com/chat/completions', {
      model: "deepseek-chat",
      messages: [
        { 
          role: "system", 
          content: `你是一个毒舌但专业的全栈开发和产品经理。请分析用户对现有App的吐槽或新需求：
          1. 吐槽点/缺失点：用户最讨厌现有工具的哪一个具体功能或缺失？
          2. 盈利机会：如果做一个“极简版”或“增强版”，用户愿意付钱吗？
          3. 技术实现：给出一个 3 天内能写完的 MVP 功能建议。
          请用中文回答。` 
        },
        { role: "user", content: `标题: ${title}` }
      ]
    }, {
      headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      timeout: 30000 
    });
    return response.data.choices[0].message.content;
  } catch (e) {
    return "AI 忙碌，请直接看原帖。";
  }
}

async function fetchRedditRSS() {
  let foundPosts = [];
  for (const config of MONITOR_CONFIG) {
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
          foundPosts.push({ id, subreddit: config.subreddit, title, url: link });
        }
      }
    } catch (e) { console.error(`[Error] r/${config.subreddit}: ${e.message}`); }
  }
  return foundPosts;
}

async function run() {
  const posts = await fetchRedditRSS();
  if (posts.length === 0) return console.log('未发现满足权重的吐槽或需求。');

  const targetPosts = posts.slice(0, 3);
  let emailHtml = `<h1 style="color: #e67e22;">🧨 用户槽点与新需求探测</h1>`;

  for (const p of targetPosts) {
    const aiAnalysis = await analyzeWithAI(p.title, p.subreddit);
    emailHtml += `
      <div style="margin-bottom: 30px; padding: 20px; border: 1px solid #e67e22; border-left: 10px solid #e67e22; background-color: #fffaf5;">
        <span style="background: #e67e22; color: white; padding: 2px 8px; border-radius: 3px;">r/${p.subreddit}</span>
        <h2 style="margin-top: 10px;">${p.title}</h2>
        <div style="color: #2c3e50; line-height: 1.6;">${aiAnalysis.replace(/\n/g, '<br>')}</div>
        <p><a href="${p.url}" style="color: #e67e22; font-weight: bold;">去 Reddit 围观吐槽 &rarr;</a></p>
      </div>`;
    history.push(p.id);
  }

  if (history.length > 1000) history = history.slice(-500);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  try {
    await resend.emails.send({
      from: 'Market-Rant-Bot <onboarding@resend.dev>',
      to: RECEIVERS,
      subject: `发现 ${targetPosts.length} 个对现有 App 的吐槽/新需求`,
      html: emailHtml
    });
    console.log('推送成功！');
  } catch (e) {
    console.error('发送失败:', e.message);
  }
}

run();
