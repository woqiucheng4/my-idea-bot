const axios = require('axios');
const { Resend } = require('resend');
const fs = require('fs');

// 初始化 API 客户端
const resend = new Resend(process.env.RESEND_API_KEY);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const HISTORY_FILE = './history.json';

// 1. 细分领域配置：在此处添加你感兴趣的行业版块
const MONITOR_CONFIG = [
  { subreddit: 'SaaS', keywords: ['alternative to', 'annoying', 'is there an app', 'tired of'] },
  { subreddit: 'smallbusiness', keywords: ['manually', 'spreadsheet', 'automate', 'expensive'] },
  { subreddit: 'RealEstate', keywords: ['software', 'management', 'tool', 'frustrated'] },
  { subreddit: 'Shopify', keywords: ['app recommendation', 'missing feature', 'too slow'] }
];

// 加载历史记录
let history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE)) : [];

// 调用 DeepSeek 进行分析
async function analyzeWithAI(title, content) {
  if (!DEEPSEEK_API_KEY) return "（未配置 AI 密钥，仅提供原文）";
  
  try {
    const response = await axios.post('https://api.deepseek.com/chat/completions', {
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: "你是一个资深全栈开发和产品经理。请分析用户发帖内容，用中文总结其核心痛点、现有工具的不足，并给出一个可盈利的小型软件解决方案建议。"
        },
        {
          role: "user",
          content: `标题: ${title}\n内容摘要: ${content}`
        }
      ]
    }, {
      headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }
    });
    return response.data.choices[0].message.content;
  } catch (e) {
    return "AI 分析暂时不可用: " + e.message;
  }
}

async function fetchRedditRSS() {
  let foundPosts = [];
  for (const config of MONITOR_CONFIG) {
    try {
      const url = `https://www.reddit.com/r/${config.subreddit}/new.rss`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Reeder/5.0'
        }
      });
      
      const xml = response.data;
      const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
      
      for (const match of entryMatches) {
        const entry = match[1];
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
        const link = entry.match(/<link href="([\s\S]*?)"/)?.[1] || '';
        const id = link.split('/').slice(-3, -2)[0];

        if (history.includes(id)) continue;

        const titleLower = title.toLowerCase();
        if (config.keywords.some(k => titleLower.includes(k))) {
          foundPosts.push({ id, subreddit: config.subreddit, title, url: link });
        }
      }
    } catch (e) { console.error(`Fetch ${config.subreddit} Error: ${e.message}`); }
  }
  return foundPosts;
}

async function run() {
  const posts = await fetchRedditRSS();
  if (posts.length === 0) return console.log('No new leads found.');

  let emailHtml = `<h1>🚀 细分领域商机日报</h1>`;
  
  for (const p of posts) {
    console.log(`Analyzing: ${p.title}`);
    const aiAnalysis = await analyzeWithAI(p.title, "请访问原帖查看详情");
    
    emailHtml += `
      <div style="margin-bottom: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
        <h2 style="color: #007bff;">[r/${p.subreddit}] ${p.title}</h2>
        <p><b>分析结果：</b></p>
        <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; white-space: pre-wrap;">${aiAnalysis}</div>
        <p style="margin-top: 15px;"><a href="${p.url}" style="background: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">查看 Reddit 原帖</a></p>
      </div>`;
    history.push(p.id);
  }

  if (history.length > 500) history = history.slice(-500);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));

  await resend.emails.send({
    from: 'Insight-Bot <onboarding@resend.dev>',
    to: 'woqiucheng@163.com',
    subject: `📈 发现 ${posts.length} 个潜在商业切入点`,
    html: emailHtml
  });
  console.log('Commercial report sent successfully!');
}

run();
