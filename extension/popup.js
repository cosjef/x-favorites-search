
document.addEventListener('DOMContentLoaded', async () => {
    const resultsDiv = document.getElementById('results');
    const { lastSearch } = await chrome.storage.local.get('lastSearch');
    
    if (lastSearch) {
        const searchInput = document.getElementById('searchInput');
        searchInput.value = lastSearch.term;
        resultsDiv.innerHTML = lastSearch.html;
        
        // Reattach "Load More" button handler if it existed
        if (lastSearch.reachedLimit) {
            attachLoadMoreHandler();
        }
    }


    // Enable Enter key search and real-time search
    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });
    
    // Optional: Add real-time search with debounce
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const value = searchInput.value.trim();
            if (value.length > 2) { // Only search after 3+ characters
                performSearch();
            } else if (value.length === 0) {
                // Clear results if search is empty
                document.getElementById('results').innerHTML = '';
            }
        }, 500); // 500ms debounce
    });
});

async function performSearch() {
    console.log('=== POPUP SEARCH STARTED ===');
    const searchTerm = document.getElementById('searchInput').value;
    const resultsDiv = document.getElementById('results');
    
    console.log('Search term from popup:', searchTerm);
    
    if (!searchTerm.trim()) {
        resultsDiv.innerHTML = '<div class="error-message">Please enter a search term</div>';
        return;
    }

    // Show loading message with progress
    const updateProgress = (message, count = 0) => {
        resultsDiv.innerHTML = `
            <div class="results-header">
                <div style="margin-bottom: 8px;">🔍 ${message}</div>
                ${count > 0 ? `<div style="font-size: 11px; margin-bottom: 4px; opacity: 0.8;">Found ${count} tweets so far...</div>` : ''}
                <div style="font-size: 11px; opacity: 0.8; line-height: 1.3;">App is automatically scrolling your Twitter likes page</div>
            </div>
        `;
    };
    
    updateProgress("Starting search and auto-scroll...");
    
    console.log('Starting search for:', searchTerm);

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        // Add debug log
        console.log('Current tab:', tab);

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async (term) => {
                try {
                    // Function to wait for elements to appear
                    const waitForElement = (selector, timeout = 5000) => {
                        return new Promise((resolve, reject) => {
                            const startTime = Date.now();
                            const checkElement = () => {
                                const element = document.querySelector(selector);
                                if (element) {
                                    resolve(element);
                                } else if (Date.now() - startTime > timeout) {
                                    reject(new Error(`Timeout waiting for ${selector}`));
                                } else {
                                    setTimeout(checkElement, 100);
                                }
                            };
                            checkElement();
                        });
                    };

                    // Get tweets from the page
                    const getTweets = async (scrollAttempts = 100) => {
                        let allTweets = new Set();
                        let lastTweetCount = 0;
                        let reachedLimit = false;
                        let noNewTweetsCount = 0;
                        
                        console.log('Starting tweet collection...');
                        
                        for (let i = 0; i < scrollAttempts; i++) {
                            const tweetElements = document.querySelectorAll('[data-testid="tweet"]');
                            console.log(`Scroll attempt ${i + 1}: Found ${tweetElements.length} tweet elements on page`);
                            
                            tweetElements.forEach((tweet, index) => {
                                // Try multiple selectors for tweet text since Twitter/X changes them frequently
                                const tweetTextElement = tweet.querySelector('[data-testid="tweetText"]') || 
                                                        tweet.querySelector('[lang]') || 
                                                        tweet.querySelector('div[dir="auto"]') ||
                                                        tweet.querySelector('.css-1rynq56') ||
                                                        tweet.querySelector('span');
                                
                                const authorElement = tweet.querySelector('[data-testid="User-Name"]') ||
                                                    tweet.querySelector('a[role="link"] span') ||
                                                    tweet.querySelector('[data-testid="User-Names"]');
                                
                                const timeElement = tweet.querySelector('time');
                                const linkElement = tweet.querySelector('a[href*="/status/"]');
                                
                                // Try to get text content more aggressively
                                let tweetText = '';
                                if (tweetTextElement) {
                                    tweetText = tweetTextElement.innerText || tweetTextElement.textContent || '';
                                }
                                
                                // If still no text, try to find any text content in the tweet
                                if (!tweetText) {
                                    const textNodes = tweet.querySelectorAll('span, div');
                                    for (const node of textNodes) {
                                        const text = node.innerText || node.textContent || '';
                                        if (text.length > 10 && !text.includes('·') && !text.includes('@')) {
                                            tweetText = text;
                                            break;
                                        }
                                    }
                                }
                                
                                const tweetData = {
                                    text: tweetText,
                                    author: authorElement?.innerText || authorElement?.textContent || '',
                                    date: timeElement?.getAttribute('datetime') || '',
                                    link: linkElement?.href || ''
                                };
                                
                                // Debug logging for first few tweets on first scroll
                                if (index < 5 && i === 0) {
                                    console.log(`=== TWEET ${index} DEBUG ===`);
                                    console.log('Tweet element:', tweet);
                                    console.log('Text element found:', !!tweetTextElement);
                                    console.log('Raw text content:', tweetData.text);
                                    console.log('Text length:', tweetData.text.length);
                                    console.log('Has link:', !!linkElement);
                                    console.log('Link:', linkElement?.href);
                                    console.log('Author:', tweetData.author);
                                    console.log('Will be added to collection:', !!(tweetData.link && tweetData.text && tweetData.text.length > 5));
                                    console.log('=========================');
                                }
                                
                                if (tweetData.link && tweetData.text && tweetData.text.length > 5) {
                                    // Create a clean object to avoid serialization issues
                                    const cleanTweet = {
                                        text: String(tweetData.text),
                                        author: String(tweetData.author),
                                        date: String(tweetData.date),
                                        link: String(tweetData.link)
                                    };
                                    allTweets.add(JSON.stringify(cleanTweet));
                                }
                            });

                            const currentCount = allTweets.size;
                            console.log(`Total unique tweets collected: ${currentCount}`);
                            
                            
                            if (currentCount === lastTweetCount) {
                                noNewTweetsCount++;
                                console.log(`No new tweets found (${noNewTweetsCount}/5)`);
                                if (noNewTweetsCount >= 5) {
                                    console.log('No new tweets for 5 attempts, stopping scroll');
                                    break;
                                }
                            } else {
                                noNewTweetsCount = 0;
                            }
                            
                            lastTweetCount = currentCount;
                            
                            // More aggressive scrolling
                            const currentScrollTop = window.pageYOffset;
                            window.scrollTo({
                                top: document.body.scrollHeight,
                                behavior: 'smooth'
                            });
                            
                            // Wait for content to load
                            await new Promise(resolve => setTimeout(resolve, 800));
                            
                            // Check if we actually scrolled
                            const newScrollTop = window.pageYOffset;
                            if (newScrollTop === currentScrollTop && i > 10) {
                                console.log('Page did not scroll further, likely reached end');
                                break;
                            }

                            if (i === scrollAttempts - 1) {
                                reachedLimit = true;
                            }
                        }

                        return {
                            tweets: Array.from(allTweets).map(tweet => JSON.parse(tweet)),
                            reachedLimit
                        };
                    };

                    // Navigate to likes if not already there
                    const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
                    if (!profileLink) throw new Error('Could not find profile link - make sure you are on Twitter/X');
                    
                    const userId = profileLink.href.split('/').pop();
                    const currentUrl = window.location.href;
                    const likesUrl = `https://x.com/${userId}/likes`;

                    console.log('Current URL:', currentUrl);
                    console.log('Target likes URL:', likesUrl);

                    if (!currentUrl.includes('/likes')) {
                        console.log('Navigating to likes page...');
                        window.location.href = likesUrl;
                        await waitForElement('[data-testid="tweet"]', 10000);
                        console.log('Likes page loaded, starting tweet collection...');
                    } else {
                        console.log('Already on likes page, starting tweet collection...');
                    }

                    // Get tweets and filter them in the content script
                    let tweets = await getTweets();
                    console.log('Found tweets:', tweets.tweets.length);
                    
                    // Filter for matches right here in the content script
                    const matchingTweets = tweets.tweets.filter(tweet => 
                        tweet.text.toLowerCase().includes(term.toLowerCase())
                    );
                    
                    console.log('Matching tweets found:', matchingTweets.length);
                    console.log('Search term was:', term);

                    return {
                        success: true,
                        tweets: tweets.tweets,
                        matchingTweets: matchingTweets, // Pre-filtered matches
                        totalScanned: tweets.tweets.length,
                        debug: { userId },
                        reachedLimit: tweets.reachedLimit
                    };
                } catch (error) {
                    console.error('Script Error:', error);
                    return {
                        success: false,
                        error: error.message,
                        stack: error.stack
                    };
                }
            },
            args: [searchTerm]
        });

        console.log('Script execution results:', results);
        
        if (!results || !results[0]) {
            throw new Error('Script execution failed - no results returned');
        }
        
        if (!results[0].result) {
            throw new Error('Script execution failed - no result in response');
        }

        const apiResult = results[0].result;
        console.log('API result:', apiResult);
        console.log('API result tweets length:', apiResult.tweets?.length);
        console.log('First 3 API result tweets:', apiResult.tweets?.slice(0, 3));

        if (!apiResult.success) {
            throw new Error(`Script error: ${apiResult.error}`);
        }

        // Use pre-filtered matches from content script
        console.log('Total tweets scanned:', apiResult.totalScanned);
        console.log('Pre-filtered matches received:', apiResult.matchingTweets?.length);
        
        const matchingTweets = apiResult.matchingTweets || [];
        
        if (matchingTweets.length > 0) {
            console.log('Sample matching tweet:', matchingTweets[0].text?.substring(0, 100));
        }

        if (matchingTweets.length === 0) {
            resultsDiv.innerHTML = `
                <div class="no-results">
                    <strong>No matches found</strong><br>
                    Searched ${apiResult.totalScanned} tweets for "${searchTerm}"
                </div>
            `;
            return;
        }

        const resultsHtml = `
            <div class="results-header">
                <span>✨ Found ${matchingTweets.length} matches in ${apiResult.totalScanned} tweets</span>
                ${apiResult.reachedLimit ? '<button id="loadMore" class="load-more-btn">Load More</button>' : ''}
            </div>
            ${matchingTweets.map(tweet => `
                <div class="tweet-card">
                    <div class="tweet-text">${escapeHtml(tweet.text)}</div>
                    <div class="tweet-meta">
                        <div>
                            <div class="tweet-author">${escapeHtml(tweet.author)}</div>
                            <div class="tweet-date">${formatDate(tweet.date)}</div>
                        </div>
                        <a href="${tweet.link}" target="_blank" class="tweet-link">View Tweet →</a>
                    </div>
                </div>
            `).join('')}
        `;

        // Store the search results
        await chrome.storage.local.set({
            lastSearch: {
                term: searchTerm,
                html: resultsHtml,
                reachedLimit: apiResult.reachedLimit
            }
        });

        // Display the results
        resultsDiv.innerHTML = resultsHtml;

        // Add load more handler if needed
        if (apiResult.reachedLimit) {
            attachLoadMoreHandler();
        }

    } catch (error) {
        console.error('Search error:', error);
        resultsDiv.innerHTML = `
            <div class="error-message">
                <strong>Search Error</strong><br>
                ${error.message}
            </div>
        `;
    }
}

// Utility functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    if (!dateString) return 'Unknown date';
    try {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) return '1 day ago';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
        
        return date.toLocaleDateString();
    } catch (e) {
        return dateString;
    }
}

function attachLoadMoreHandler() {
    document.getElementById('loadMore')?.addEventListener('click', async () => {
        const loadMoreButton = document.getElementById('loadMore');
        loadMoreButton.disabled = true;
        loadMoreButton.textContent = 'Loading...';
        
        // Execute another search
        const moreResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: getTweets,
            args: [20]
        });

        // ... handle more results ...
        loadMoreButton.remove();
    });
} 