// WEMBA SF Library Tracker - Main Application

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbx72uEUC6oyXgiJbp8kDbLt4b5I67mlq_CsCqNE8ralzUJDgwMKlz_maJqcIwXpdbwc/exec'
};

// ============================================
// STATE
// ============================================
let scanner = null;
let currentBook = {
    isbn: null,
    title: '',
    author: '',
    coverUrl: '',
    inLibrary: false,
    status: null, // 'Available', 'Borrowed', or null
    borrower: null
};

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    loadLibraryBooks();
});

// ============================================
// NAVIGATION
// ============================================
function initNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const viewName = btn.dataset.view;
            switchView(viewName);
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${viewName}-view`).classList.add('active');

    if (viewName !== 'scan') {
        stopScanner();
    }

    if (viewName === 'library') {
        loadLibraryBooks();
    } else if (viewName === 'overdue') {
        loadOverdueBooks();
    } else if (viewName === 'scan') {
        showScanStart();
    }
}

// ============================================
// STEP 1: SCANNER
// ============================================
let isScanning = false;

function showScanStart() {
    document.getElementById('scan-step-1').classList.remove('hidden');
    document.getElementById('scan-step-camera').classList.add('hidden');
    document.getElementById('scan-step-result').classList.add('hidden');
    currentBook = { isbn: null, title: '', author: '', coverUrl: '', inLibrary: false, status: null, borrower: null };
    isScanning = false;
}

function startScanner() {
    document.getElementById('scan-step-1').classList.add('hidden');
    document.getElementById('scan-step-camera').classList.remove('hidden');
    document.getElementById('scan-step-result').classList.add('hidden');
    isScanning = false;

    // Create new scanner instance each time for reliability
    if (scanner) {
        try { scanner.stop(); } catch(e) {}
    }
    scanner = new Html5Qrcode("scanner-reader");

    // Configure for EAN-13 barcodes (ISBN format)
    const config = {
        fps: 5,
        qrbox: { width: 280, height: 80 },
        formatsToSupport: [ Html5QrcodeSupportedFormats.EAN_13 ]
    };

    scanner.start(
        { facingMode: "environment" },
        config,
        handleBarcodeScan,
        () => {} // Ignore scan errors
    ).then(() => {
        showToast("Point camera at ISBN barcode", "success");
    }).catch(err => {
        console.error("Camera error:", err);
        // Try without format restriction
        scanner.start(
            { facingMode: "environment" },
            { fps: 5, qrbox: { width: 280, height: 80 } },
            handleBarcodeScan,
            () => {}
        ).then(() => {
            showToast("Camera ready", "success");
        }).catch(err2 => {
            showToast("Cannot access camera", "error");
            showScanStart();
        });
    });
}

function stopScanner() {
    if (scanner) {
        try { scanner.stop(); } catch(e) {}
    }
}

// ============================================
// STEP 2: HANDLE BARCODE SCAN
// ============================================
async function handleBarcodeScan(decodedText) {
    // Prevent multiple scans
    if (isScanning) return;

    // Clean the barcode - keep only digits
    const barcode = decodedText.replace(/\D/g, '');

    // Validate: ISBN-13 must be exactly 13 digits starting with 978 or 979
    if (barcode.length !== 13) {
        console.log("Not a valid ISBN-13:", decodedText);
        return; // Keep scanning
    }

    if (!barcode.startsWith('978') && !barcode.startsWith('979')) {
        console.log("Not an ISBN barcode:", barcode);
        return; // Keep scanning
    }

    // Valid ISBN-13 found!
    isScanning = true;
    console.log("Valid ISBN-13 scanned:", barcode);

    // Stop scanner
    stopScanner();

    // Vibrate feedback
    if (navigator.vibrate) navigator.vibrate(200);

    // Show result section
    document.getElementById('scan-step-1').classList.add('hidden');
    document.getElementById('scan-step-camera').classList.add('hidden');
    document.getElementById('scan-step-result').classList.remove('hidden');

    // Display ISBN immediately
    document.getElementById('result-isbn').textContent = barcode;
    document.getElementById('result-title').textContent = 'Looking up book...';
    document.getElementById('result-author').textContent = '';
    document.getElementById('result-status').textContent = '';
    document.getElementById('result-status').className = 'result-status';
    hideAllActions();

    currentBook.isbn = barcode;

    // STEP 3: Look up book info from Google Books / Open Library
    showToast("Searching for book info...", "");
    const bookInfo = await lookupBookInfo(barcode);

    currentBook.title = bookInfo.title;
    currentBook.author = bookInfo.author;
    currentBook.coverUrl = bookInfo.coverUrl;

    // Display book info
    document.getElementById('result-title').textContent = bookInfo.title || 'Unknown Title';
    document.getElementById('result-author').textContent = bookInfo.author || 'Unknown Author';
    document.getElementById('result-cover').src = bookInfo.coverUrl;

    // Pre-fill forms
    document.getElementById('add-title').value = bookInfo.title || '';
    document.getElementById('add-author').value = bookInfo.author || '';

    // STEP 4: Check WEMBA library database
    showToast("Checking library database...", "");
    const libraryStatus = await checkLibraryDatabase(barcode);

    currentBook.inLibrary = libraryStatus.inLibrary;
    currentBook.status = libraryStatus.status;
    currentBook.borrower = libraryStatus.borrower;

    // Display library status
    const statusEl = document.getElementById('result-status');
    if (!libraryStatus.inLibrary) {
        statusEl.textContent = 'Not in library';
        statusEl.className = 'result-status status-not-in-library';
    } else if (libraryStatus.status === 'Available') {
        statusEl.textContent = 'In library - Available';
        statusEl.className = 'result-status status-available';
    } else {
        statusEl.textContent = 'Borrowed by ' + (libraryStatus.borrower || 'someone');
        statusEl.className = 'result-status status-borrowed';
    }

    // STEP 5: Show appropriate actions
    showActions(libraryStatus);

    if (bookInfo.title) {
        showToast("Found: " + bookInfo.title, "success");
    } else {
        showToast("Book not found online - enter details manually", "");
    }
}

// ============================================
// STEP 3: LOOKUP BOOK INFO
// ============================================
async function lookupBookInfo(isbn) {
    const result = { title: '', author: '', coverUrl: '', found: false };

    // Try Google Books first
    try {
        const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
        if (response.ok) {
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                const book = data.items[0].volumeInfo;
                result.title = book.title || '';
                result.author = book.authors ? book.authors.join(', ') : '';
                if (book.imageLinks) {
                    result.coverUrl = (book.imageLinks.thumbnail || '').replace('http://', 'https://');
                }
                result.found = true;
                console.log("Found in Google Books:", result.title);
            }
        }
    } catch (e) {
        console.log("Google Books error:", e.message);
    }

    // Try Open Library if Google Books failed
    if (!result.found) {
        try {
            const response = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
            if (response.ok) {
                const data = await response.json();
                const bookData = data[`ISBN:${isbn}`];
                if (bookData) {
                    result.title = bookData.title || '';
                    result.author = bookData.authors ? bookData.authors.map(a => a.name).join(', ') : '';
                    if (bookData.cover) {
                        result.coverUrl = bookData.cover.medium || bookData.cover.large || '';
                    }
                    result.found = true;
                    console.log("Found in Open Library:", result.title);
                }
            }
        } catch (e) {
            console.log("Open Library error:", e.message);
        }
    }

    // Default cover from Open Library
    if (!result.coverUrl) {
        result.coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
    }

    return result;
}

// ============================================
// STEP 4: CHECK LIBRARY DATABASE
// ============================================
async function checkLibraryDatabase(isbn) {
    const result = { inLibrary: false, status: null, borrower: null };

    try {
        const response = await fetch(`${CONFIG.API_URL}?action=getBook&isbn=${encodeURIComponent(isbn)}`);
        const data = await response.json();

        if (data && !data.error) {
            result.inLibrary = true;
            result.status = data.status || 'Available';
            result.borrower = data.currentBorrower || null;
            console.log("Library status:", result);
        }
    } catch (e) {
        console.log("Library check error:", e.message);
    }

    return result;
}

// ============================================
// STEP 5: SHOW ACTIONS
// ============================================
function hideAllActions() {
    document.getElementById('action-add').classList.add('hidden');
    document.getElementById('action-borrow').classList.add('hidden');
    document.getElementById('action-return').classList.add('hidden');
    document.getElementById('form-add').classList.add('hidden');
    document.getElementById('form-borrow').classList.add('hidden');
}

function showActions(libraryStatus) {
    hideAllActions();

    if (!libraryStatus.inLibrary) {
        // Book not in library - show Add button
        document.getElementById('action-add').classList.remove('hidden');
    } else if (libraryStatus.status === 'Available') {
        // Book available - show Borrow button
        document.getElementById('action-borrow').classList.remove('hidden');
    } else {
        // Book borrowed - show Return button
        document.getElementById('action-return').classList.remove('hidden');
    }
}

// ============================================
// API HELPER - Handle Google Apps Script
// ============================================
async function callAPI(data) {
    console.log("Calling API with:", data);

    // Use GET with parameters to avoid CORS preflight issues
    const params = new URLSearchParams();
    for (const key in data) {
        params.append(key, typeof data[key] === 'object' ? JSON.stringify(data[key]) : data[key]);
    }

    const url = `${CONFIG.API_URL}?${params.toString()}`;
    console.log("API URL:", url);

    try {
        const response = await fetch(url);
        console.log("Response status:", response.status);

        const text = await response.text();
        console.log("Response text:", text);

        try {
            return JSON.parse(text);
        } catch (e) {
            console.log("Could not parse as JSON");
            if (text.toLowerCase().includes('success')) {
                return { success: true };
            }
            return { success: false, error: 'Unexpected response from server' };
        }
    } catch (e) {
        console.error("Fetch error:", e);
        throw e;
    }
}

// ============================================
// STEP 6: ACTION HANDLERS
// ============================================

// Show Add Form
function showAddForm() {
    document.getElementById('form-add').classList.remove('hidden');
    document.getElementById('form-borrow').classList.add('hidden');
}

// Show Borrow Form
function showBorrowForm() {
    document.getElementById('form-borrow').classList.remove('hidden');
    document.getElementById('form-add').classList.add('hidden');
}

// Add book to library
async function submitAddBook() {
    const title = document.getElementById('add-title').value.trim();
    const author = document.getElementById('add-author').value.trim();
    const donor = document.getElementById('add-donor').value.trim();

    if (!title || !author) {
        showToast("Please enter title and author", "error");
        return;
    }

    showToast("Adding to library...", "");

    try {
        const result = await callAPI({
            action: 'addBook',
            isbn: currentBook.isbn,
            title: title,
            author: author,
            donor: donor
        });

        if (result.success) {
            showToast("Book added to library!", "success");
            // Update UI
            currentBook.inLibrary = true;
            currentBook.status = 'Available';
            document.getElementById('result-status').textContent = 'In library - Available';
            document.getElementById('result-status').className = 'result-status status-available';
            hideAllActions();
            document.getElementById('action-borrow').classList.remove('hidden');
            document.getElementById('form-add').classList.add('hidden');
        } else {
            showToast(result.error || "Failed to add book", "error");
        }
    } catch (e) {
        console.error("Add book error:", e);
        showToast("Error: " + e.message, "error");
    }
}

// Borrow book
async function submitBorrow() {
    const name = document.getElementById('borrower-name').value.trim();
    const phone = document.getElementById('borrower-phone').value.trim();

    if (!name || !phone) {
        showToast("Please enter name and phone number", "error");
        return;
    }

    showToast("Processing...", "");

    try {
        const result = await callAPI({
            action: 'borrow',
            isbn: currentBook.isbn,
            title: currentBook.title,
            author: currentBook.author,
            borrowerName: name,
            whatsapp: phone
        });

        if (result.success) {
            showToast("Book borrowed successfully!", "success");
            document.getElementById('borrower-name').value = '';
            document.getElementById('borrower-phone').value = '';
            document.getElementById('form-borrow').classList.add('hidden');
            setTimeout(showScanStart, 1500);
        } else {
            showToast(result.error || "Failed to borrow", "error");
        }
    } catch (e) {
        console.error("Borrow error:", e);
        showToast("Error: " + e.message, "error");
    }
}

// Return book
async function submitReturn() {
    showToast("Processing return...", "");

    try {
        const result = await callAPI({
            action: 'return',
            isbn: currentBook.isbn
        });

        if (result.success) {
            showToast("Book returned successfully!", "success");
            setTimeout(showScanStart, 1500);
        } else {
            showToast(result.error || "Failed to return", "error");
        }
    } catch (e) {
        console.error("Return error:", e);
        showToast("Error: " + e.message, "error");
    }
}

// ============================================
// LIBRARY VIEW
// ============================================
let booksCache = [];

async function loadLibraryBooks() {
    const container = document.getElementById('books-list');
    container.innerHTML = '<p class="loading">Loading books...</p>';

    try {
        const response = await fetch(`${CONFIG.API_URL}?action=getBooks`);
        const data = await response.json();
        booksCache = data.books || [];
        renderBooks(booksCache);
    } catch (e) {
        container.innerHTML = '<p class="empty-state">Failed to load books</p>';
    }
}

function renderBooks(books) {
    const container = document.getElementById('books-list');

    if (!books || books.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No books in library yet</p><p>Go to Scan tab to add books</p></div>';
        return;
    }

    container.innerHTML = `
        <div class="books-grid">
            ${books.map(book => `
                <div class="book-card ${book.status === 'Borrowed' ? 'borrowed' : ''}">
                    <div class="book-cover">
                        <img src="https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg"
                             alt="${book.title}"
                             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22180%22><rect fill=%22%23ddd%22 width=%22120%22 height=%22180%22/><text x=%2260%22 y=%2290%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2212%22>No Cover</text></svg>'">
                        ${book.status === 'Borrowed' ? '<span class="borrowed-badge">Borrowed</span>' : ''}
                    </div>
                    <div class="book-details">
                        <h3>${book.title}</h3>
                        <p class="author">${book.author}</p>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Search
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('book-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const filtered = booksCache.filter(book =>
                book.title.toLowerCase().includes(query) ||
                book.author.toLowerCase().includes(query) ||
                book.isbn.includes(query)
            );
            renderBooks(filtered);
        });
    }
});

// ============================================
// OVERDUE VIEW
// ============================================
async function loadOverdueBooks() {
    const container = document.getElementById('overdue-list');
    container.innerHTML = '<p class="loading">Loading...</p>';

    try {
        const response = await fetch(`${CONFIG.API_URL}?action=getOverdue`);
        const data = await response.json();
        renderOverdue(data.overdue || []);
    } catch (e) {
        container.innerHTML = '<p class="empty-state">Failed to load</p>';
    }
}

function renderOverdue(list) {
    const container = document.getElementById('overdue-list');

    if (!list || list.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No overdue books!</p></div>';
        return;
    }

    container.innerHTML = list.map(item => `
        <div class="overdue-item">
            <img src="https://covers.openlibrary.org/b/isbn/${item.isbn}-S.jpg" alt="" class="overdue-cover" onerror="this.style.display='none'">
            <div class="overdue-info">
                <h3>${item.title}</h3>
                <p>Borrower: ${item.borrowerName}</p>
                <p>Due: ${formatDate(item.dueDate)}</p>
                <p class="days-overdue">${item.daysOverdue} days overdue</p>
                <button class="whatsapp-btn" onclick="sendWhatsAppReminder('${item.whatsapp}', '${item.title}', ${item.daysOverdue})">
                    Send WhatsApp Reminder
                </button>
            </div>
        </div>
    `).join('');
}

function sendWhatsAppReminder(phone, title, days) {
    const message = encodeURIComponent(`Hi! Reminder from WEMBA SF Library: "${title}" is ${days} days overdue. Please return it soon. Thank you!`);
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    window.open(`https://wa.me/${cleanPhone}?text=${message}`, '_blank');
}

// ============================================
// UTILITIES
// ============================================

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
    });
}

function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
}
