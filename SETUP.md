# WEMBA SF Library Tracker - Setup Guide

A simple PWA for tracking book borrowing with barcode scanning and automatic book info lookup.

## Features

- Scan book barcodes using phone camera
- Auto-fetch book info & covers from Open Library (no API key needed)
- Track borrower name, WhatsApp number, borrow/return dates
- View book inventory with cover images
- See overdue books and send WhatsApp reminders
- Works offline as a PWA

## Quick Start (Demo Mode)

1. Open `index.html` in a browser (or use a local server)
2. The app works in demo mode without any backend setup
3. Scan any book barcode to see it auto-fetch book info from Open Library

## Full Setup (with Google Sheets Backend)

### Step 1: Create Google Sheet

1. Go to [Google Sheets](https://sheets.google.com)
2. Create a new spreadsheet
3. Name it "WEMBA Library Tracker"
4. Copy the spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
   ```

### Step 2: Set Up Google Apps Script

1. Go to [Google Apps Script](https://script.google.com)
2. Click "New Project"
3. Delete the default code
4. Copy the contents of `google-apps-script/Code.gs` into the editor
5. Replace `YOUR_SPREADSHEET_ID_HERE` with your actual spreadsheet ID
6. Click "Run" > "setupSheets" to create the required sheets
7. Click "Deploy" > "New deployment"
8. Select type: "Web app"
9. Set:
   - Execute as: "Me"
   - Who has access: "Anyone"
10. Click "Deploy" and copy the Web App URL

### Step 3: Configure the App

1. Open `js/app.js`
2. Replace `YOUR_GOOGLE_APPS_SCRIPT_URL_HERE` with your Web App URL:
   ```javascript
   const CONFIG = {
       API_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
       ...
   };
   ```

### Step 4: Deploy the PWA

**Option A: GitHub Pages (Free)**
1. Push the project to a GitHub repository
2. Go to Settings > Pages
3. Select "main" branch and "/root" folder
4. Your app will be at `https://yourusername.github.io/repo-name`

**Option B: Local Testing**
```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve .
```

Then open `http://localhost:8000` in your browser.

## Usage

### Borrowing a Book
1. Tap "Scan" tab
2. Point camera at book barcode (ISBN)
3. Book info & cover auto-loads from Open Library
4. Enter your name and WhatsApp number
5. Confirm borrow (date auto-logged)

### Returning a Book
1. Scan the same book barcode
2. System recognizes it's borrowed
3. Tap "Confirm Return" (return date auto-logged)

### Viewing Inventory
- Tap "Books" tab to see all books with covers
- Search by title, author, or ISBN
- Borrowed books shown with orange badge

### Overdue Reminders
- Tap "Overdue" tab to see overdue books
- Tap "Send WhatsApp Reminder" to open WhatsApp with pre-filled message

## Google Sheets Structure

The backend creates two sheets:

**Books** (Inventory)
| ISBN | Title | Author | Status | Current Borrower | Borrow Date | Due Date |

**Transactions** (History)
| ISBN | Title | Borrower Name | WhatsApp | Borrow Date | Due Date | Return Date | Status |

## Book Cover Sources

Covers are fetched from [Open Library Covers API](https://openlibrary.org/dev/docs/api/covers):
- No API key required
- Works with any valid ISBN
- Falls back to placeholder if cover not available

## Troubleshooting

**Camera not working?**
- Ensure you're using HTTPS (required for camera access)
- Check browser permissions for camera

**Book info not loading?**
- Some books may not be in Open Library database
- Check if ISBN is correct (try searching on openlibrary.org)

**Google Sheets not updating?**
- Verify the Apps Script deployment is set to "Anyone"
- Check the Apps Script execution logs for errors

## Files Overview

```
wemba-library-tracker/
├── index.html              # Main app page
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
├── css/
│   └── styles.css          # Styling
├── js/
│   └── app.js              # Main application logic
├── google-apps-script/
│   └── Code.gs             # Backend code for Google Sheets
└── icons/
    ├── icon-192.png        # App icon (create your own)
    └── icon-512.png        # App icon large
```

## Creating App Icons

For PWA icons, create PNG images at:
- 192x192 pixels (icon-192.png)
- 512x512 pixels (icon-512.png)

Place them in the `icons/` folder.

## License

Free to use for WEMBA SF Library.
