chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'fetchLikes') {
        fetch(request.url, {
            method: 'GET',
            headers: request.headers,
            credentials: 'include'
        })
        .then(async response => {
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Received data:', data);
            sendResponse({ success: true, data });
        })
        .catch(error => {
            console.error('Fetch error:', error);
            sendResponse({ success: false, error: error.message });
        });
        
        return true; // Keep the message channel open for async response
    }
}); 