const axios = require('axios');
const { Resend } = require('resend');

// 初始化 Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// 你想监控的 Reddit 版块和关键词
// const MONITOR_CONFIG = [
//   { subreddit: 'SaaS', keywords: ['looking for', 'alternative to', 'annoying', 'how to'] },
//   { subreddit: 'smallbusiness', keywords: ['struggling with', 'automate', 'software'] }
// ];
const MONITOR_CONFIG = [
  { subreddit: 'SaaS', keywords: [''] }, // 空字符串意味着匹配所有帖子
  { subreddit: 'programming', keywords: [''] }
];

async function fetchReddit() {
  let foundPosts = [];
  
  for (const config of MONITOR_CONFIG) {
    try {
      // 获取该版块最新的 JSON 数据
      const url = `https://www.reddit.com/r/${config.subreddit}/new.json?limit=10`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpportunityBot/1.0 (by /u/LectureDelicious7788)'
        }
      });
      const posts = response.data.data.children;

      for (const { data: post } of posts) {
        // 匹配标题中的关键词
        const title = post.title.toLowerCase();
        const hasKeyword = config.keywords.some(k => title.includes(k));

        if (hasKeyword) {
          foundPosts.push({
            subreddit: config.subreddit,
            title: post.title,
            url: `https://www.reddit.com${post.permalink}`,
            content: post.selftext.substring(0, 200) + '...'
          });
        }
      }
    } catch (error) {
      console.error(`抓取 ${config.subreddit} 失败:`, error.message);
    }
  }
  return foundPosts;
}

async function run() {
  const posts = await fetchReddit();

  if (posts.length > 0) {
    let htmlContent = `<h2>发现新的潜在商机！</h2>`;
    posts.forEach(p => {
      htmlContent += `
        <div style="margin-bottom: 20px; border-bottom: 1px solid #ccc;">
          <h3>[r/${p.subreddit}] ${p.title}</h3>
          <p>${p.content}</p>
          <a href="${p.url}">查看原帖 (需翻墙)</a>
        </div>
      `;
    });

    await resend.emails.send({
      from: 'Opportunity-Bot <onboarding@resend.dev>',
      to: 'wogeshou888@gmail.com', 
      subject: `🚀 发现 ${posts.length} 个 Reddit 新需求`,
      html: htmlContent
    });
    console.log('邮件已发送！');
  } else {
    console.log('本次扫描未发现匹配需求。');
  }
}

run();
