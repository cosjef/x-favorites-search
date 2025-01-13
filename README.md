# X Favorites Search

A Chrome extension that lets you search through your liked tweets on X (formerly Twitter).

## Features
- Search through your liked tweets
- View tweet details including author and date
- Click through to original tweets
- Persistent search results
- Load more tweets functionality

## Installation
1. Clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `extension` folder from this repository

## Usage
1. Click the extension icon while on X (Twitter)
2. Enter your search term
3. Click "Search Favorites"
4. View matching tweets and click links to open them

## Known Limitations
- X's API has rate limits that may trigger 429 (Too Many Requests) errors
- If you encounter a rate limit, wait a few minutes before trying again

## Development
Built using:
- Chrome Extensions Manifest V3
- JavaScript
- Chrome Storage API 