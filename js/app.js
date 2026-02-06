// WEMBA SF Library Tracker - Main Application

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    API_URL: 'https://script.google.com/macros/s/AKfycbx72uEUC6oyXgiJbp8kDbLt4b5I67mlq_CsCqNE8ralzUJDgwMKlz_maJqcIwXpdbwc/exec',
    OPEN_LIBRARY_API: 'https://openlibrary.org',
    DEFAULT_LOAN_DAYS: 14
};

// ============================================
// STATE
// ============================================
let scanner = null;
let currentISBN = null;
let currentBookInfo = null;
let currentBookStatus = null; // 'new', 'available', 'borrowed'
let booksCache = [];

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    loadBooks();
    setDefaultDueDate();
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

    // Stop scanner when leaving scan view
    if (viewName !== 'scan') {
        stopScanner();
    }

    // Load data for views
    if (viewName === 'library') {
        loadBooks();
    } else if (viewName === 'overdue') {
        loadOverdue();
    } else if (viewName === 'scan') {
        resetScanView();
    }
}

// ============================================
// SCANNER
// ============================================
function startScanner() {
    console.log("Starting scanner...");

    document.getElementById('scan-step-1').classList.add('hidden');
    document.getElementById('scan-step-camera').classList.remove('hidden');
    document.getElementById('scan-step-2').classList.add('hidden');

    if (!scanner) {
        scanner = new Html5Qrcode("scanner-reader");
    }

    scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 100 } },
        onScanSuccess,
        () => {} // Ignore errors
    ).then(() => {
        showToast("Camera ready - scan barcode", "success");
    }).catch(err => {
        console.error("Scanner error:", err);
        showToast("Camera access denied", "error");
        resetScanView();
    });
}

function stopScanner() {
    if (scanner && scanner.isScanning) {
        scanner.stop().catch(err => console.log("Stop error:", err));
    }
}

function stopAndReset() {
    stopScanner();
    resetScanView();
}

function resetScanView() {
    document.getElementById('scan-step-1').classList.remove('hidden');
    document.getElementById('scan-step-camera').classList.add('hidden');
    document.getElementById('scan-step-2').classList.add('hidden');
    hideActionForms();
    currentISBN = null;
    currentBookInfo = null;
    currentBookStatus = null;
}

async function onScanSuccess(isbn) {
    console.log("Scanned:", isbn);

    if (navigator.vibrate) navigator.vibrate(200);

    stopScanner();

    // Clean ISBN - remove any non-numeric characters except X (for ISBN-10)
    const cleanISBN = isbn.replace(/[^0-9X]/gi, '');
    console.log("Clean ISBN:", cleanISBN);

    currentISBN = cleanISBN;

    showToast("ISBN: " + cleanISBN + " - Looking up...", "");

    // Look up book info
    try {
        await lookupAndDisplayBook(cleanISBN);
    } catch (error) {
        console.error("Lookup error:", error);
        showToast("Error looking up book: " + error.message, "error");
    }
}

// ============================================
// BOOK LOOKUP
// ============================================
async function lookupAndDisplayBook(isbn) {
    console.log("Looking up book for ISBN:", isbn);

    // First check if book exists in our library
    let libraryBook = null;
    try {
        libraryBook = await checkLibraryStatus(isbn);
        console.log("Library status:", libraryBook);
    } catch (e) {
        console.log("Library check failed:", e);
    }

    // Get book details from Open Library / Google Books
    showToast("Searching book databases...", "");
    let bookInfo = await fetchBookInfo(isbn);
    console.log("Book info found:", bookInfo);
    currentBookInfo = bookInfo;

    // Display book info
    document.getElementById('scanned-book-isbn').textContent = isbn;
    document.getElementById('scanned-book-title').textContent = bookInfo.title || 'Unknown Title';
    document.getElementById('scanned-book-author').textContent = bookInfo.author || 'Unknown Author';

    // Set cover image
    const coverImg = document.getElementById('scanned-book-cover');
    if (bookInfo.coverUrl) {
        coverImg.src = bookInfo.coverUrl;
    } else {
        coverImg.src = getCoverUrl(isbn, 'M');
    }

    // Pre-fill add form
    document.getElementById('add-title').value = bookInfo.title || '';
    document.getElementById('add-author').value = bookInfo.author || '';

    // Determine status and show appropriate buttons
    const statusEl = document.getElementById('scanned-book-status');
    const btnAdd = document.getElementById('btn-add-book');
    const btnBorrow = document.getElementById('btn-borrow');
    const btnReturn = document.getElementById('btn-return');

    if (!libraryBook) {
        // Book not in library
        currentBookStatus = 'new';
        statusEl.textContent = 'Not in library yet';
        statusEl.className = 'book-status status-new';
        btnAdd.classList.remove('hidden');
        btnBorrow.classList.add('hidden');
        btnReturn.classList.add('hidden');
    } else if (libraryBook.status === 'Available') {
        // Book available to borrow
        currentBookStatus = 'available';
        statusEl.textContent = 'Available in library';
        statusEl.className = 'book-status status-available';
        btnAdd.classList.add('hidden');
        btnBorrow.classList.remove('hidden');
        btnReturn.classList.add('hidden');
    } else {
        // Book is borrowed
        currentBookStatus = 'borrowed';
        statusEl.textContent = `Borrowed by ${libraryBook.currentBorrower || 'someone'}`;
        statusEl.className = 'book-status status-borrowed';
        btnAdd.classList.add('hidden');
        btnBorrow.classList.add('hidden');
        btnReturn.classList.remove('hidden');
    }

    // Show step 2
    document.getElementById('scan-step-1').classList.add('hidden');
    document.getElementById('scan-step-camera').classList.add('hidden');
    document.getElementById('scan-step-2').classList.remove('hidden');

    if (bookInfo.found) {
        showToast("Book found: " + bookInfo.title, "success");
    } else {
        showToast("Book not in database - enter details manually", "");
    }
}

async function fetchBookInfo(isbn) {
    const cleanISBN = isbn.replace(/[-\s]/g, '');
    console.log("Fetching book info for:", cleanISBN);

    // Try Open Library first
    try {
        console.log("Trying Open Library API...");
        const url = `${CONFIG.OPEN_LIBRARY_API}/api/books?bibkeys=ISBN:${cleanISBN}&format=json&jscmd=data`;
        console.log("URL:", url);

        const response = await fetch(url);
        const data = await response.json();
        console.log("Open Library response:", data);

        const key = `ISBN:${cleanISBN}`;

        if (data[key]) {
            const book = data[key];
            console.log("Found in Open Library:", book.title);
            return {
                title: book.title || 'Unknown Title',
                author: book.authors ? book.authors.map(a => a.name).join(', ') : 'Unknown Author',
                coverUrl: book.cover ? book.cover.medium : null,
                found: true
            };
        } else {
            console.log("Not found in Open Library");
        }
    } catch (e) {
        console.error("Open Library error:", e);
    }

    // Try Google Books as fallback
    try {
        console.log("Trying Google Books API...");
        const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanISBN}`;
        console.log("URL:", url);

        const response = await fetch(url);
        const data = await response.json();
        console.log("Google Books response:", data);

        if (data.items && data.items.length > 0) {
            const book = data.items[0].volumeInfo;
            console.log("Found in Google Books:", book.title);
            return {
                title: book.title || 'Unknown Title',
                author: book.authors ? book.authors.join(', ') : 'Unknown Author',
                coverUrl: book.imageLinks ? book.imageLinks.thumbnail.replace('http:', 'https:') : null,
                found: true
            };
        } else {
            console.log("Not found in Google Books");
        }
    } catch (e) {
        console.error("Google Books error:", e);
    }

    console.log("Book not found in any database");
    return { title: 'Unknown Title', author: 'Unknown Author', coverUrl: null, found: false };
}

async function checkLibraryStatus(isbn) {
    try {
        const response = await fetch(`${CONFIG.API_URL}?action=getBook&isbn=${encodeURIComponent(isbn)}`);
        const data = await response.json();
        if (data.error) return null;
        return data;
    } catch (e) {
        console.log("Library check error:", e);
        return null;
    }
}

function getCoverUrl(isbn, size = 'M') {
    return `https://covers.openlibrary.org/b/isbn/${isbn.replace(/[-\s]/g, '')}-${size}.jpg`;
}

// ============================================
// ACTIONS
// ============================================
function showAddForm() {
    hideActionForms();
    document.getElementById('add-form').classList.remove('hidden');
}

function showBorrowForm() {
    hideActionForms();
    document.getElementById('borrow-form').classList.remove('hidden');
}

function hideActionForms() {
    document.getElementById('add-form').classList.add('hidden');
    document.getElementById('borrow-form').classList.add('hidden');
}

async function submitAddBook() {
    const title = document.getElementById('add-title').value.trim();
    const author = document.getElementById('add-author').value.trim();
    const donor = document.getElementById('add-donor').value.trim();

    if (!title || !author) {
        showToast("Please fill in title and author", "error");
        return;
    }

    showToast("Adding book to library...", "");

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'addBook',
                isbn: currentISBN,
                title: title,
                author: author,
                donor: donor || '',
                dateAdded: new Date().toISOString(),
                coverUrl: currentBookInfo?.coverUrl || getCoverUrl(currentISBN, 'M')
            })
        });

        const result = await response.json();

        if (result.success) {
            showToast("Book added to library!", "success");
            hideActionForms();
            // Clear donor field
            document.getElementById('add-donor').value = '';
            // Update status
            currentBookStatus = 'available';
            document.getElementById('scanned-book-status').textContent = 'Available in library';
            document.getElementById('scanned-book-status').className = 'book-status status-available';
            document.getElementById('btn-add-book').classList.add('hidden');
            document.getElementById('btn-borrow').classList.remove('hidden');
        } else {
            showToast(result.error || "Failed to add book", "error");
        }
    } catch (e) {
        console.error("Add book error:", e);
        showToast("Connection error", "error");
    }
}

async function submitBorrow() {
    const name = document.getElementById('borrower-name').value.trim();
    const phone = document.getElementById('borrower-phone').value.trim();
    const dueDate = document.getElementById('due-date').value;

    if (!name || !phone || !dueDate) {
        showToast("Please fill in all fields", "error");
        return;
    }

    showToast("Processing...", "");

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'borrow',
                isbn: currentISBN,
                title: currentBookInfo?.title || 'Unknown',
                author: currentBookInfo?.author || 'Unknown',
                borrowerName: name,
                whatsapp: phone,
                borrowDate: new Date().toISOString(),
                dueDate: dueDate
            })
        });

        const result = await response.json();

        if (result.success) {
            showToast("Book borrowed successfully!", "success");
            // Clear form
            document.getElementById('borrower-name').value = '';
            document.getElementById('borrower-phone').value = '';
            setDefaultDueDate();
            // Reset to scan another
            setTimeout(resetScanView, 1500);
        } else {
            showToast(result.error || "Borrow failed", "error");
        }
    } catch (e) {
        console.error("Borrow error:", e);
        showToast("Connection error", "error");
    }
}

async function confirmReturn() {
    showToast("Processing return...", "");

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'return',
                isbn: currentISBN,
                returnDate: new Date().toISOString()
            })
        });

        const result = await response.json();

        if (result.success) {
            showToast("Book returned successfully!", "success");
            setTimeout(resetScanView, 1500);
        } else {
            showToast(result.error || "Return failed", "error");
        }
    } catch (e) {
        console.error("Return error:", e);
        showToast("Connection error", "error");
    }
}

// ============================================
// LIBRARY VIEW
// ============================================
async function loadBooks() {
    const container = document.getElementById('books-list');
    container.innerHTML = '<p class="loading">Loading books...</p>';

    try {
        const response = await fetch(`${CONFIG.API_URL}?action=getBooks`);
        const data = await response.json();
        booksCache = (data.books || []).map(book => ({
            ...book,
            coverUrl: getCoverUrl(book.isbn, 'M')
        }));
        renderBooks(booksCache);
    } catch (e) {
        console.error("Load books error:", e);
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
                        <img src="${book.coverUrl}" alt="${book.title}"
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

// Search functionality
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
async function loadOverdue() {
    const container = document.getElementById('overdue-list');
    container.innerHTML = '<p class="loading">Loading...</p>';

    try {
        const response = await fetch(`${CONFIG.API_URL}?action=getOverdue`);
        const data = await response.json();
        renderOverdue(data.overdue || []);
    } catch (e) {
        console.error("Load overdue error:", e);
        container.innerHTML = '<p class="empty-state">Failed to load</p>';
    }
}

function renderOverdue(overdueList) {
    const container = document.getElementById('overdue-list');

    if (!overdueList || overdueList.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No overdue books!</p></div>';
        return;
    }

    container.innerHTML = overdueList.map(item => `
        <div class="overdue-item">
            <img src="${getCoverUrl(item.isbn, 'S')}" alt="" class="overdue-cover"
                 onerror="this.style.display='none'">
            <div class="overdue-info">
                <h3>${item.title}</h3>
                <p>Borrower: ${item.borrowerName}</p>
                <p>Due: ${formatDate(item.dueDate)}</p>
                <p class="days-overdue">${item.daysOverdue} days overdue</p>
                <button class="whatsapp-btn" onclick="sendReminder('${item.whatsapp}', '${item.title}', ${item.daysOverdue})">
                    Send WhatsApp Reminder
                </button>
            </div>
        </div>
    `).join('');
}

function sendReminder(phone, title, days) {
    const message = encodeURIComponent(
        `Hi! Reminder from WEMBA SF Library: "${title}" is ${days} days overdue. Please return it soon. Thank you!`
    );
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    window.open(`https://wa.me/${cleanPhone}?text=${message}`, '_blank');
}

// ============================================
// UTILITIES
// ============================================
function setDefaultDueDate() {
    const date = new Date();
    date.setDate(date.getDate() + CONFIG.DEFAULT_LOAN_DAYS);
    const dueDateInput = document.getElementById('due-date');
    if (dueDateInput) {
        dueDateInput.value = date.toISOString().split('T')[0];
    }
}

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
