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
});

document.getElementById('searchButton').addEventListener('click', async () => {
    const searchTerm = document.getElementById('searchInput').value;
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = 'Searching...';
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
                    const getTweets = async (scrollAttempts = 20) => {
                        let allTweets = new Set();
                        let lastTweetCount = 0;
                        let reachedLimit = false;
                        
                        for (let i = 0; i < scrollAttempts; i++) {
                            const tweetElements = document.querySelectorAll('[data-testid="tweet"]');
                            tweetElements.forEach(tweet => {
                                const tweetData = {
                                    text: tweet.querySelector('[data-testid="tweetText"]')?.innerText || '',
                                    author: tweet.querySelector('[data-testid="User-Name"]')?.innerText || '',
                                    date: tweet.querySelector('time')?.getAttribute('datetime') || '',
                                    link: tweet.querySelector('a[href*="/status/"]')?.href || ''
                                };
                                
                                if (tweetData.link && tweetData.text) {
                                    allTweets.add(JSON.stringify(tweetData));
                                }
                            });

                            const currentCount = allTweets.size;
                            if (currentCount === lastTweetCount) {
                                console.log('No new tweets found, stopping scroll');
                                break;
                            }
                            
                            lastTweetCount = currentCount;
                            console.log(`Loading tweets... (${currentCount} found)`);
                            
                            window.scrollTo(0, document.body.scrollHeight);
                            await new Promise(resolve => setTimeout(resolve, 1000));

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
                    if (!profileLink) throw new Error('Could not find profile link');
                    
                    const userId = profileLink.href.split('/').pop();
                    const currentUrl = window.location.href;
                    const likesUrl = `https://twitter.com/${userId}/likes`;

                    if (!currentUrl.includes('/likes')) {
                        window.location.href = likesUrl;
                        await waitForElement('[data-testid="tweet"]');
                    }

                    // Get initial tweets
                    let tweets = await getTweets();
                    console.log('Found tweets:', tweets.tweets.length);

                    return {
                        success: true,
                        tweets: tweets.tweets,
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
        
        if (!results || !results[0] || !results[0].result) {
            throw new Error('Script execution failed to return results');
        }

        const apiResult = results[0].result;
        console.log('API result:', apiResult);

        if (!apiResult.success) {
            throw new Error(`Script error: ${apiResult.error}`);
        }

        // Add debug log
        console.log('Tweets before filtering:', apiResult.tweets);

        const matchingTweets = apiResult.tweets
            .filter(tweet => tweet.text.toLowerCase().includes(searchTerm.toLowerCase()));

        // Add debug log
        console.log('Tweets after filtering:', matchingTweets);

        if (matchingTweets.length === 0) {
            resultsDiv.innerHTML = `No matches found in ${apiResult.tweets.length} tweets searched.`;
            return;
        }

        const resultsHtml = `
            <div style="margin-bottom: 10px; font-weight: bold;">
                Found ${matchingTweets.length} matches in ${apiResult.tweets.length} tweets searched:
                ${apiResult.reachedLimit ? '<button id="loadMore" style="margin-left: 10px; margin-top: 10px; padding: 5px 10px;">Load More</button>' : ''}
            </div>
            ${matchingTweets.map(tweet => `
                <div style="border-bottom: 1px solid #ccc; padding: 10px 0;">
                    <p>${tweet.text}</p>
                    <small>
                        By ${tweet.author} 
                        on ${new Date(tweet.date).toLocaleDateString()}
                        <a href="${tweet.link}" target="_blank">View Tweet</a>
                    </small>
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
        resultsDiv.innerHTML = 'Error: ' + error.message;
    }
});

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