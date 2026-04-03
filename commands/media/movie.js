/**
 * Movie Downloader - Google Drive Links Finder with Debugging
 */

const { chromium } = require('playwright');
const config = require('../../config');

// Cineverse base URL
const CINEVERSE_BASE = "https://cineverse.name.ng";

// Store browser instance (reuse across searches)
let browserInstance = null;

async function getBrowser() {
    if (!browserInstance) {
        console.log('[MOVIE] Launching browser...');
        browserInstance = await chromium.launch({
            headless: true,  // Set to false for debugging
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });
    }
    return browserInstance;
}

async function searchMovie(page, movieName) {
    const searchUrl = `${CINEVERSE_BASE}/search?q=${encodeURIComponent(movieName)}`;
    console.log('[DEBUG] Search URL:', searchUrl);
    
    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    
    // Debug: Save search page HTML
    const searchHtml = await page.content();
    require('fs').writeFileSync('search_page_debug.html', searchHtml);
    console.log('[DEBUG] Search page saved to search_page_debug.html');
    
    const results = await page.evaluate(() => {
        const results = [];
        
        // Try multiple selectors for movie links
        const selectors = [
            'a[href*="/movie/"]',
            'a[href*="/watch/"]',
            'a[href*="/film/"]',
            '.movie-item a',
            '.film-poster a',
            '.poster a',
            '.film-item a',
            '.card a',
            'a[class*="movie"]',
            'a[class*="film"]'
        ];
        
        for (const selector of selectors) {
            const links = document.querySelectorAll(selector);
            console.log(`[DEBUG] Selector ${selector}: found ${links.length} links`);
            
            for (let link of links) {
                const text = link.innerText || link.getAttribute('title') || link.getAttribute('alt') || '';
                const href = link.href;
                const yearMatch = text.match(/\b(19|20)\d{2}\b/);
                
                if (href && (href.includes('/movie/') || href.includes('/watch/') || href.includes('/film/'))) {
                    results.push({
                        title: text.replace(/\d{4}/g, '').trim() || 'Unknown',
                        year: yearMatch ? yearMatch[0] : '',
                        url: href,
                        selector: selector
                    });
                }
            }
        }
        
        // If no results with specific selectors, get all links
        if (results.length === 0) {
            const allLinks = document.querySelectorAll('a');
            for (let link of allLinks) {
                const href = link.href;
                const text = link.innerText;
                if (href && text && text.length > 3 && text.length < 100) {
                    results.push({
                        title: text.trim(),
                        year: '',
                        url: href,
                        selector: 'all_links'
                    });
                }
            }
        }
        
        // Remove duplicates
        const unique = [];
        const seen = new Set();
        for (let r of results) {
            if (!seen.has(r.url)) {
                seen.add(r.url);
                unique.push(r);
            }
        }
        
        return unique.slice(0, 10); // Return top 10 results
    });
    
    console.log('[DEBUG] Search results found:', results.length);
    if (results.length > 0) {
        console.log('[DEBUG] First result:', results[0]);
    }
    
    return results;
}

async function getGoogleDriveLinks(page, movieUrl) {
    console.log('[DEBUG] Getting download links from:', movieUrl);
    
    await page.goto(movieUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000);
    
    // Debug: Save movie page HTML
    const movieHtml = await page.content();
    require('fs').writeFileSync('movie_page_debug.html', movieHtml);
    console.log('[DEBUG] Movie page saved to movie_page_debug.html');
    
    // Take screenshot
    await page.screenshot({ path: 'movie_page_debug.png', fullPage: true });
    console.log('[DEBUG] Screenshot saved to movie_page_debug.png');
    
    // Try to find and click any download/play buttons
    const buttons = await page.$$('button, a.button, .download-btn, .play-btn, [class*="download"], [class*="play"]');
    console.log('[DEBUG] Found', buttons.length, 'potential buttons');
    
    for (let i = 0; i < Math.min(buttons.length, 5); i++) {
        const btn = buttons[i];
        const text = await btn.innerText().catch(() => '');
        console.log(`[DEBUG] Button ${i}: "${text}"`);
        
        if (text && (text.toLowerCase().includes('download') || 
                     text.toLowerCase().includes('play') || 
                     text.toLowerCase().includes('watch') ||
                     text.toLowerCase().includes('get link'))) {
            console.log(`[DEBUG] Clicking button: "${text}"`);
            await btn.click();
            await page.waitForTimeout(3000);
        }
    }
    
    // Extract all Google Drive links
    const driveLinks = await page.evaluate(() => {
        const links = [];
        
        // Function to extract quality from text
        function extractQuality(text) {
            if (!text) return 'Unknown';
            const match = text.match(/(\d{3,4}p)/i);
            return match ? match[1] : null;
        }
        
        function extractSize(text) {
            if (!text) return 'Unknown';
            const match = text.match(/([\d.]+\s*(?:MB|GB))/i);
            return match ? match[1] : 'Unknown';
        }
        
        // Check all links for Google Drive
        const allLinks = document.querySelectorAll('a');
        console.log(`[DEBUG] Total links on page: ${allLinks.length}`);
        
        for (let link of allLinks) {
            const href = link.href;
            if (href && (href.includes('drive.google.com') || href.includes('googledrive') || href.includes('drive.usercontent.google.com'))) {
                const parentText = link.parentElement?.innerText || '';
                const linkText = link.innerText;
                const combinedText = parentText + ' ' + linkText;
                
                links.push({
                    quality: extractQuality(combinedText) || 'Unknown',
                    size: extractSize(combinedText),
                    url: href,
                    type: 'direct_link',
                    text: combinedText.substring(0, 100)
                });
                console.log(`[DEBUG] Found Google Drive link: ${href}`);
            }
        }
        
        // Check data attributes
        const elementsWithData = document.querySelectorAll('[data-url], [data-link], [data-src], [data-href]');
        console.log(`[DEBUG] Elements with data attributes: ${elementsWithData.length}`);
        
        for (let el of elementsWithData) {
            const url = el.getAttribute('data-url') || 
                       el.getAttribute('data-link') || 
                       el.getAttribute('data-src') ||
                       el.getAttribute('data-href');
            
            if (url && (url.includes('drive.google.com') || url.includes('googledrive'))) {
                links.push({
                    quality: extractQuality(el.innerText),
                    size: extractSize(el.innerText),
                    url: url,
                    type: 'data_attribute',
                    text: el.innerText?.substring(0, 100)
                });
                console.log(`[DEBUG] Found Google Drive in data attribute: ${url}`);
            }
        }
        
        // Check iframes
        const iframes = document.querySelectorAll('iframe');
        for (let iframe of iframes) {
            const src = iframe.src;
            if (src && src.includes('google')) {
                links.push({
                    quality: 'Unknown',
                    size: 'Unknown',
                    url: src,
                    type: 'iframe',
                    text: 'Iframe source'
                });
                console.log(`[DEBUG] Found iframe: ${src}`);
            }
        }
        
        // Check script tags for embedded links
        const scripts = document.querySelectorAll('script');
        for (let script of scripts) {
            const content = script.innerHTML;
            if (content) {
                const driveMatches = content.match(/https?:\/\/[^"'\s]*drive\.google\.com[^"'\s]*/gi);
                if (driveMatches) {
                    for (let match of driveMatches) {
                        links.push({
                            quality: 'Unknown',
                            size: 'Unknown',
                            url: match,
                            type: 'script_embed',
                            text: 'Found in script'
                        });
                        console.log(`[DEBUG] Found Google Drive in script: ${match}`);
                    }
                }
            }
        }
        
        return links;
    });
    
    console.log('[DEBUG] Total Google Drive links found:', driveLinks.length);
    
    // If no Google Drive links, try to get all download links
    if (driveLinks.length === 0) {
        console.log('[DEBUG] No Google Drive links, looking for any download links...');
        
        const allLinks = await page.evaluate(() => {
            const links = [];
            const downloadKeywords = ['download', 'get', 'link', 'stream', 'watch', '.mp4', '.mkv', '.avi'];
            
            const allLinksList = document.querySelectorAll('a');
            for (let link of allLinksList) {
                const href = link.href;
                const text = (link.innerText + ' ' + (link.parentElement?.innerText || '')).toLowerCase();
                
                if (href && downloadKeywords.some(keyword => text.includes(keyword) || href.includes(keyword))) {
                    links.push({
                        url: href,
                        text: text.substring(0, 200),
                        quality: text.match(/\d{3,4}p/)?.[0] || 'Unknown'
                    });
                }
            }
            
            return links;
        });
        
        if (allLinks.length > 0) {
            console.log('[DEBUG] Found alternative download links:', allLinks.length);
            return allLinks.map(link => ({
                quality: link.quality,
                size: 'Unknown',
                url: link.url,
                type: 'alternative',
                text: link.text
            }));
        }
    }
    
    return driveLinks;
}

module.exports = {
    name: 'movie',
    aliases: ['cinema', 'cineverse', 'movielink'],
    description: 'Search movies and get Google Drive download links',
    usage: '.movie <movie name>',
    category: 'media',
    ownerOnly: false,

    async execute(sock, msg, args, context) {
        const { from, reply, react } = context;

        if (args.length === 0) {
            await reply(`🎬 *Movie Link Finder*\n\n` +
                       `Usage: \`${config.prefix}movie <movie name>\`\n\n` +
                       `*Examples:*\n` +
                       `• \`${config.prefix}movie 3 idiots\`\n` +
                       `• \`${config.prefix}movie stranger things\``);
            return;
        }

        const query = args.join(' ');
        
        await react('🔍');
        await reply(`🔍 Searching for *${query}*...`);
        
        let browser = null;
        let page = null;
        
        try {
            browser = await getBrowser();
            page = await browser.newPage();
            
            // Set extra headers to appear like a real browser
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });
            
            const results = await searchMovie(page, query);
            
            if (!results || results.length === 0) {
                await reply(`❌ No results found for "${query}".\n\nTry:\n• Different spelling\n• Adding year (e.g., "3 idiots 2009")\n• Using a shorter name`);
                await react('❌');
                return;
            }
            
            // Show top 5 results to user
            let resultMessage = `🎬 *Found ${results.length} results:*\n\n`;
            for (let i = 0; i < Math.min(results.length, 5); i++) {
                resultMessage += `${i+1}. ${results[i].title}`;
                if (results[i].year) resultMessage += ` (${results[i].year})`;
                resultMessage += `\n`;
            }
            resultMessage += `\n✅ Selecting the best match: *${results[0].title}*`;
            await reply(resultMessage);
            
            const selectedMovie = results[0];
            
            // Get Google Drive links
            await react('⏳');
            await reply(`🔗 Fetching download links for *${selectedMovie.title}*...`);
            
            const driveLinks = await getGoogleDriveLinks(page, selectedMovie.url);
            
            if (!driveLinks || driveLinks.length === 0) {
                await reply(`❌ No download links found for *${selectedMovie.title}*\n\n` +
                           `Possible reasons:\n` +
                           `• Website structure has changed\n` +
                           `• Movie requires premium account\n` +
                           `• Links are protected by Cloudflare\n\n` +
                           `Debug files saved: search_page_debug.html, movie_page_debug.html, movie_page_debug.png\n` +
                           `Please share these files with the developer.`);
                await react('❌');
                return;
            }
            
            // Prepare final message
            let finalMessage = `✅ *${selectedMovie.title}*`;
            if (selectedMovie.year) finalMessage += ` (${selectedMovie.year})`;
            finalMessage += `\n\n`;
            
            let linkCount = 0;
            for (const link of driveLinks) {
                if (link.url && link.url !== '#') {
                    finalMessage += `🎬 *${link.quality}* (${link.size})\n`;
                    finalMessage += `${link.url}\n\n`;
                    linkCount++;
                    
                    // Break if message gets too long (WhatsApp limit)
                    if (finalMessage.length > 1500) {
                        finalMessage += `\n*+${driveLinks.length - linkCount} more links*\n`;
                        break;
                    }
                }
            }
            
            if (linkCount === 0) {
                await reply(`❌ No valid links found for *${selectedMovie.title}*`);
                await react('❌');
                return;
            }
            
            finalMessage += `⚠️ *Note:* Google Drive links may have download quotas. If you see "quota exceeded", save to your own Drive first or try a different quality.\n\n`;
            finalMessage += `📁 *Debug files saved:* Check server for HTML dumps if links don't work.`;
            
            await reply(finalMessage);
            await react('✅');
            
        } catch (error) {
            console.error('[MOVIE] Error:', error);
            await reply(`❌ Failed: ${error.message}\n\nCheck server console for details.`);
            await react('❌');
        } finally {
            if (page) {
                try {
                    await page.close();
                } catch (e) {}
            }
        }
    }
};
