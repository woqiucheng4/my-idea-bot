const axios = require('axios');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// 使用 RSS 链接，这通常能绕过 API 的 403 封锁
const MONITOR_CONFIG = [
  { subreddit: 'SaaS' },
  { subreddit: 'programming' }
];

async function fetchRedditRSS() {
  let foundPosts = [];
  
  for (const config of MONITOR_CONFIG) {
    try {
      // 这里的后缀改成了 .rss
      const url = `https://www.reddit.com/r/${config.subreddit}/new.rss`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Reeder/5.0'
        }
      });
      
      const xml = response.data;
      
      // 简单的正则解析 XML 中的标题和链接（不需要安装额外的 XML 解析库）
      const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
      
      for (const match of entryMatches) {
        const entry = match[1];
        const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || 'No Title';
        const link = entry.match(/<link href="([\s\S]*?)"/)?.[1] || '';
        
        // 因为是暴力测试模式，直接存入
        foundPosts.push({
          subreddit: config.subreddit,
          title: title,
          url: link,
          content: 'New post from RSS feed'
        });
        
        // 每个版块只抓前 3 个测试
        if (foundPosts.length >= 3) break;
      }
      console.log(`Successfully fetched ${config.subreddit} via RSS`);
    } catch (error) {
      console.error(`RSS Fetch ${config.subreddit} failed:`, error.message);
    }
  }
  return foundPosts;
}

async function run() {
  console.log('Starting RSS scan...');
  const posts = await fetchRedditRSS();

  if (posts.length > 0) {
    let htmlContent = `<h2>RSS Discovery</h2>`;
    posts.forEach(p => {
      htmlContent += `
        <div style="margin-bottom: 20px; border-bottom: 1px solid #ccc;">
          <h3>[r/${p.subreddit}] ${p.title}</h3>
          <a href="${p.url}">View Post</a>
        </div>
      `;
    });

    try {
      console.log('Sending email via Resend...');
      const result = await resend.emails.send({
        from: 'Opportunity-Bot <onboarding@resend.dev>',
        to: 'woqiucheng@163.com', 
        subject: `RSS Success: ${posts.length} Posts Found`,
        html: htmlContent
      });
      console.log('Resend API Response:', JSON.stringify(result)); // 打印 API 的真实响应
      console.log('Email sent successfully!');
    } catch (e) {
      console.error('Email failed Error Name:', e.name);
      console.error('Email failed Message:', e.message);
    }
  } else {
    console.log('No posts found via RSS.');
  }
}

run();
