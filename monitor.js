const axios = require('axios');
const { Resend } = require('resend');
const fs = require('fs');

// 初始化 API 客户端
const resend = new Resend(process.env.RESEND_API_KEY);
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const HISTORY_FILE = './history.json';

// 1. 细分领域配置
const MONITOR_CONFIG = [
  { subreddit: 'SaaS', keywords: ['alternative to', 'annoying', 'is there an app', 'tired of'] },
  { subreddit: 'smallbusiness', keywords: ['manually', 'spreadsheet', 'automate', 'expensive'] },
  { subreddit: 'RealEstate', keywords: ['software', 'management', 'tool', 'frustrated'] }
];

// 鲁棒加载历史记录
let history = [];
try {
  if (fs.existsSync(HISTORY_FILE)) {
    const content = fs.readFileSync(HISTORY_FILE, 'utf8');
    history = content ? JSON.parse(content) : [];
  }
} catch (e) {
  console.log('[Log] 历史记录读取失败，重置为空');
  history = [];
}

async function analyzeWithAI(title, content) {
  if (!DEEPSEEK_API_KEY) return "（未配置 DeepSeek API Key）";
  
  try {
    console.log(`[AI] 正在分析标题: ${title.substring(0, 30)}...`);
    const response = await axios.post('https://api.deepseek.com/chat/completions', {
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "你是一个资深全栈开发和产品经理。请分析用户发帖内容，用中文总结其核心痛点、现有工具的不足，并给出一个可盈利的小型软件解决方案建议。" },
        { role: "user", content: `标题: ${title}\n内容摘要: ${content}` }
      ]
    }, {
      headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 30000 // 30秒超时
    });
    return response.data.choices[0].message.content;
  } catch (e) {
    console.error(`[AI Error] 失败原因: ${e.message}`);
    return "AI 分析暂时不可用，建议直接查看原帖内容。";
  }
}

async function fetchRedditRSS() {
  let foundPosts = [];
  for (const config of MONITOR_CONFIG) {
    try {
      console.log(`[Fetch] 正在同步 r/${config.subreddit} 的最新动态...`);
      const url = `https://www.reddit.com/r/${config.subreddit}/new.rss`;
      const response = await axios.get(url, { 
         headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Reeder/5.0'
        }
      });
      const xml = response.data;
      const entryMatches = Array.from(xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g));
      
      console.log(`[Log] r/${config.subreddit} 获取到 ${entryMatches.length} 条原始帖子`);

      for (const match of entryMatches) {
        const entry = match[1];
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
        const link = entry.match(/<link href="([\s\S]*?)"/)?.[1] || '';
        const id = link.split('/').slice(-3, -2)[0] || link;

        // 如果 ID 已经在历史记录里，跳过
        if (history.includes(id)) continue;

        const titleLower = title.toLowerCase();
        // 如果命中关键词
        if (config.keywords.some(k => titleLower.includes(k))) {
          foundPosts.push({ id, subreddit: config.subreddit, title, url: link });
        }
      }
    } catch (e) {
      console.error(`[Fetch Error] r/${config.subreddit} 访问受限: ${e.message}`);
    }
  }
  return foundPosts;
}

async function run() {
  console.log('=== 探测任务启动 ===');
  const posts = await fetchRedditRSS();
  
  if (posts.length === 0) {
    console.log('=== 探测结果：没有发现符合条件的新商机 ===');
    return;
  }

  console.log(`[Log] 筛选出 ${posts.length} 个新商机，开始 AI 深度分析...`);
  let emailHtml = `<h1 style="color: #333;">🚀 商机探测简报</h1>`;
  
  // 为了防止 AI 接口并发报错，我们一个一个来
  for (const p of posts) {
    const aiAnalysis = await analyzeWithAI(p.title, "请访问原帖详情");
    emailHtml += `
      <div style="margin-bottom: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 8px; font-family: sans-serif;">
        <h2 style="color: #007bff; border-bottom: 2px solid #007bff; padding-bottom: 5px;">[r/${p.subreddit}] ${p.title}</h2>
        <p><b>🔍 AI 商业透视：</b></p>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; color: #444; line-height: 1.6;">${aiAnalysis.replace(/\n/g, '<br>')}</div>
        <p style="margin-top: 15px;"><a href="${p.url}" style="color: #28a745; font-weight: bold;">查看 Reddit 原帖地址 &rarr;</a></p>
      </div>`;
    history.push(p.id);
  }

  // 限制历史记录数量，保存文件
  if (history.length > 500) history = history.slice(-500);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  console.log('[Log] 历史记录已同步至 local');

  try {
    console.log('[Mail] 正在推送至您的邮箱...');
    const res = await resend.emails.send({
      from: 'Market-Intelligence <onboarding@resend.dev>',
      to: 'chadqiu0721@gmail.com', // 已经为您更新为新邮箱
      subject: `发现 ${posts.length} 个细分市场切入点`,
      html: emailHtml
    });
    console.log('[Success] 邮件推送成功，Resend ID:', res.data?.id);
  } catch (e) {
    console.error('[Mail Error] 推送失败:', e.message);
  }
  console.log('=== 任务圆满完成 ===');
}

run();
