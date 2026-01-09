const axios = require('axios');
const { Resend } = require('resend');

// 初始化 Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// 暴力测试模式：匹配所有新贴
const MONITOR_CONFIG = [
  { subreddit: 'SaaS', keywords: [''] },
  { subreddit: 'programming', keywords: [''] }
];

async function fetchReddit() {
  let foundPosts = [];
  
  for (const config of MONITOR_CONFIG) {
    try {
      const url = `https://www.reddit.com/r/${config.subreddit}/new.json?limit=10`;
      const response = await axios.get(url, {
        headers: {
          // 彻底去除所有中文和特殊说明，使用最标准的 UA
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebkit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      const posts = response.data.data.children;

      for (const { data: post } of posts) {
        const title = post.title.toLowerCase();
        const hasKeyword = config.keywords.some(k => title.includes(k));

        if (hasKeyword) {
          foundPosts.push({
            subreddit: config.subreddit,
            title: post.title,
            url: `https://www.reddit.com${post.permalink}`,
            content: post.selftext ? (post.selftext.substring(0, 200) + '...') : 'No content'
          });
        }
      }
    } catch (error) {
      // 这里的错误日志能帮我们确认是否依然被封
      console.error(`Fetch ${config.subreddit} failed:`, error.message);
    }
  }
  return foundPosts;
}

async function run() {
  console.log('Starting scan...');
  const posts = await fetchReddit();

  if (posts.length > 0) {
    let htmlContent = `<h2>Found New Opportunities</h2>`;
    posts.forEach(p => {
      htmlContent += `
        <div style="margin-bottom: 20px; border-bottom: 1px solid #ccc;">
          <h3>[r/${p.subreddit}] ${p.title}</h3>
          <p>${p.content}</p>
          <a href="${p.url}">Link</a>
        </div>
      `;
    });

    try {
      await resend.emails.send({
        from: 'Opportunity-Bot <onboarding@resend.dev>',
        to: 'wogeshou888@gmail.com', 
        subject: `Success: Found ${posts.length} Reddit Posts`,
        html: htmlContent
      });
      console.log('Email sent successfully!');
    } catch (e) {
      console.error('Email failed:', e.message);
    }
  } else {
    console.log('No matching posts found this time.');
  }
}

run();
