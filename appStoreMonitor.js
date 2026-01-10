const axios = require('axios');

async function fetchGlobalTopPaid(region, limit = 200) {
    try {
        console.log(`[AppStore] Fetching Top ${limit} Paid Apps for region: ${region}`);
        
        // 1. Fetch Top Paid App IDs via RSS
        const rssUrl = `https://rss.applemarketingtools.com/api/v2/${region}/apps/top-paid/${limit}/apps.json`;
        const rssResponse = await axios.get(rssUrl);
        const feed = rssResponse.data.feed;
        const apps = feed.results;

        if (!apps || apps.length === 0) {
            console.warn(`[AppStore] No apps found for region: ${region}`);
            return [];
        }

        const appIds = apps.map(app => app.id);
        console.log(`[AppStore] Got ${appIds.length} IDs. Fetching details...`);

        // 2. Batch fetch details via iTunes Lookup API
        // iTunes Lookup API has a limit on URL length, so we batch requests.
        const batchSize = 50;
        const detailsMap = new Map();

        for (let i = 0; i < appIds.length; i += batchSize) {
            const batchIds = appIds.slice(i, i + batchSize).join(',');
            try {
                const lookupUrl = `https://itunes.apple.com/lookup?id=${batchIds}&country=${region}`;
                const lookupResponse = await axios.get(lookupUrl);
                
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
            
            return {
                id: app.id,
                name: app.name, // RSS usually has good names
                artistName: app.artistName,
                rank: index + 1,
                iconUrl: app.artworkUrl100,
                appUrl: app.url,
                // Details from Lookup
                price: detail.price,         // number, e.g. 4.99
                priceFormatted: detail.formattedPrice, // string, e.g. "$4.99"
                currency: detail.currency,
                description: detail.description,
                rating: detail.averageUserRating,
                ratingCount: detail.userRatingCount,
                genres: detail.genres || [], // array of strings
                primaryGenre: detail.primaryGenreName,
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
