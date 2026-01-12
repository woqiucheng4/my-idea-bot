const axios = require('axios');

/**
 * 辅助函数：延迟执行
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 辅助函数：带重试机制的 GET 请求
 */
async function getWithRetry(url, options = {}, retries = 2, delay = 3000) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await axios.get(url, {
                ...options,
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    ...options.headers
                }
            });
        } catch (err) {
            if (i === retries) throw err;
            console.warn(`[Retry] Request failed, retrying in ${delay / 1000}s... (${i + 1}/${retries})`);
            await sleep(delay);
        }
    }
}

async function fetchGlobalTopPaid(region, limit = 100) {
    try {
        console.log(`[AppStore] Fetching Top ${limit} Paid Apps for region: ${region}`);

        // 1. Fetch Top Paid App IDs via RSS V2 API
        // Note: rss.marketingtools.apple.com is the new domain. limit > 100 often causes 500.
        const rssUrl = `https://rss.marketingtools.apple.com/api/v2/${region}/apps/top-paid/${limit}/apps.json`;
        const rssResponse = await getWithRetry(rssUrl);
        const feed = rssResponse.data.feed;
        const apps = feed.results;

        if (!apps || apps.length === 0) {
            console.warn(`[AppStore] No apps found for region: ${region}`);
            return [];
        }

        const appIds = apps.map(app => app.id);
        console.log(`[AppStore] Got ${appIds.length} IDs. Fetching details...`);

        // 2. Batch fetch details via iTunes Lookup API
        const batchSize = 50;
        const detailsMap = new Map();

        for (let i = 0; i < appIds.length; i += batchSize) {
            const batchIds = appIds.slice(i, i + batchSize).join(',');
            try {
                const lookupUrl = `https://itunes.apple.com/lookup?id=${batchIds}&country=${region}`;
                const lookupResponse = await getWithRetry(lookupUrl);

                if (lookupResponse.data && lookupResponse.data.results) {
                    lookupResponse.data.results.forEach(detail => {
                        detailsMap.set(detail.trackId.toString(), detail);
                    });
                }
            } catch (err) {
                console.error(`[AppStore] Lookup failed for batch starting at index ${i}:`, err.message);
            }
        }

        // 3. Merge RSS position with detailed data
        const enrichedApps = apps.map((app, index) => {
            const detail = detailsMap.get(app.id) || {};
            const primaryGenre = detail.primaryGenreName || (app.genres && app.genres[0] ? app.genres[0].name : "");

            return {
                id: app.id,
                name: app.name,
                artistName: app.artistName,
                rank: index + 1,
                iconUrl: app.artworkUrl100,
                appUrl: app.url,
                price: detail.price,
                priceFormatted: detail.formattedPrice,
                currency: detail.currency,
                description: detail.description,
                rating: detail.averageUserRating,
                ratingCount: detail.userRatingCount,
                genres: detail.genres || [],
                primaryGenre: primaryGenre,
                isGame: primaryGenre === 'Games', // 识别是否为游戏
                bundleId: detail.bundleId,
                releaseDate: detail.releaseDate,
                currentVersionReleaseDate: detail.currentVersionReleaseDate
            };
        });

        console.log(`[AppStore] Successfully fetched ${enrichedApps.length} apps for ${region}.`);
        return enrichedApps;

    } catch (error) {
        console.error(`[AppStore] Fatal error fetching ${region}:`, error.message);
        return [];
    }
}

module.exports = { fetchGlobalTopPaid };
