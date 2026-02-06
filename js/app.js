// WEMBA SF Library Tracker - Main Application

// ============================================
// CONFIGURATION - Update this after setup!
// ============================================
const CONFIG = {
    // Google Apps Script Web App URL
    API_URL: 'https://script.google.com/macros/s/AKfycbx72uEUC6oyXgiJbp8kDbLt4b5I67mlq_CsCqNE8ralzUJDgwMKlz_maJqcIwXpdbwc/exec',

    // Open Library API (free, no key required)
    OPEN_LIBRARY_API: 'https://openlibrary.org',

    // Default loan period in days
    DEFAULT_LOAN_DAYS: 14
};

// ============================================
// STATE
// ============================================
let html5QrCode = null;
let currentScannedISBN = null;
let currentBookData = null;
let booksCache = [];
let transactionsCache = [];
let bookInfoCache = {}; // Cache for Open Library data

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initForms();
    initScanner();
    setDefaultDueDate();

    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('Service Worker registered'))
            .catch(err => console.log('Service Worker registration failed:', err));
    }
});

// ============================================
// NAVIGATION
// ============================================
function initNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const viewName = btn.dataset.view;
            switchView(viewName);

            // Update active state
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

function switchView(viewName) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    // Show selected view
    const view = document.getElementById(`${viewName}-view`);
    if (view) {
        view.classList.add('active');

        // Load data for specific views
        if (viewName === 'books') {
            loadBooks();
        } else if (viewName === 'overdue') {
            loadOverdue();
        } else if (viewName === 'scan') {
            resetScanView();
            startScanner();
        }
    }
}

// ============================================
// OPEN LIBRARY API - Book Info & Covers
// ============================================
async function fetchBookFromOpenLibrary(isbn) {
    // Check cache first
    if (bookInfoCache[isbn]) {
        return bookInfoCache[isbn];
    }

    try {
        // Clean ISBN (remove dashes)
        const cleanISBN = isbn.replace(/[-\s]/g, '');

        // Fetch from Open Library
        const response = await fetch(`${CONFIG.OPEN_LIBRARY_API}/api/books?bibkeys=ISBN:${cleanISBN}&format=json&jscmd=data`);
        const data = await response.json();

        const key = `ISBN:${cleanISBN}`;
        if (data[key]) {
            const book = data[key];
            const bookInfo = {
                isbn: isbn,
                title: book.title || 'Unknown Title',
                author: book.authors ? book.authors.map(a => a.name).join(', ') : 'Unknown Author',
                publisher: book.publishers ? book.publishers[0].name : '',
                publishDate: book.publish_date || '',
                pages: book.number_of_pages || '',
                coverUrl: book.cover ? book.cover.medium : null,
                coverUrlLarge: book.cover ? book.cover.large : null,
                coverUrlSmall: book.cover ? book.cover.small : null,
                subjects: book.subjects ? book.subjects.slice(0, 3).map(s => s.name) : [],
                found: true
            };

            // Cache the result
            bookInfoCache[isbn] = bookInfo;
            return bookInfo;
        }

        // Book not found in Open Library
        return {
            isbn: isbn,
            title: 'Unknown Title',
            author: 'Unknown Author',
            coverUrl: null,
            found: false
        };
    } catch (error) {
        console.error('Open Library API error:', error);
        return {
            isbn: isbn,
            title: 'Unknown Title',
            author: 'Unknown Author',
            coverUrl: null,
            found: false
        };
    }
}

// Get cover URL directly by ISBN (faster for lists)
function getCoverUrl(isbn, size = 'M') {
    const cleanISBN = isbn.replace(/[-\s]/g, '');
    return `https://covers.openlibrary.org/b/isbn/${cleanISBN}-${size}.jpg`;
}

// ============================================
// BARCODE SCANNER
// ============================================
function initScanner() {
    html5QrCode = new Html5Qrcode("reader");
    startScanner();
}

function startScanner() {
    const config = {
        fps: 10,
        qrbox: { width: 250, height: 100 },
        aspectRatio: 1.0
    };

    html5QrCode.start(
        { facingMode: "environment" },
        config,
        onScanSuccess,
        onScanError
    ).catch(err => {
        console.log("Scanner start error:", err);
        showToast("Camera access required for scanning", "error");
    });
}

function stopScanner() {
    if (html5QrCode && html5QrCode.isScanning) {
        html5QrCode.stop().catch(err => console.log("Scanner stop error:", err));
    }
}

function onScanSuccess(decodedText, decodedResult) {
    // Vibrate for feedback if supported
    if (navigator.vibrate) {
        navigator.vibrate(100);
    }

    stopScanner();
    currentScannedISBN = decodedText;

    // Check if book exists and its status
    checkBookStatus(decodedText);
}

function onScanError(error) {
    // Ignore scan errors (no barcode in frame)
}

// ============================================
// BOOK STATUS CHECK
// ============================================
async function checkBookStatus(isbn) {
    try {
        showToast("Looking up book...", "");

        // First, fetch book info from Open Library (for cover & details)
        const openLibraryData = await fetchBookFromOpenLibrary(isbn);

        // Then check our tracking system for borrow status
        let trackingData = null;
        try {
            const response = await fetch(`${CONFIG.API_URL}?action=getBook&isbn=${encodeURIComponent(isbn)}`);
            trackingData = await response.json();
        } catch (e) {
            // Tracking system not available - that's OK for demo
        }

        // Combine data
        const bookData = {
            ...openLibraryData,
            status: trackingData?.status || 'Available',
            currentBorrower: trackingData?.currentBorrower || null,
            borrowDate: trackingData?.borrowDate || null,
            dueDate: trackingData?.dueDate || null
        };

        currentBookData = bookData;

        if (bookData.status === 'Borrowed') {
            showReturnForm(isbn, bookData);
        } else {
            showBorrowForm(isbn, bookData);
        }
    } catch (error) {
        console.error('Error checking book:', error);

        // Fallback: still try to get book info from Open Library
        const openLibraryData = await fetchBookFromOpenLibrary(isbn);
        currentBookData = { ...openLibraryData, status: 'Available' };
        showBorrowForm(isbn, currentBookData);
    }
}

// ============================================
// BORROW FLOW
// ============================================
function showBorrowForm(isbn, bookData) {
    document.getElementById('scanned-isbn').textContent = isbn;
    document.getElementById('scanned-title').textContent = bookData.title || 'Unknown Title';

    // Show author if available
    const authorEl = document.getElementById('scanned-author');
    if (authorEl) {
        authorEl.textContent = bookData.author || '';
    }

    // Show cover image if available
    const coverEl = document.getElementById('scanned-cover');
    if (coverEl) {
        if (bookData.coverUrl) {
            coverEl.src = bookData.coverUrl;
            coverEl.classList.remove('hidden');
            coverEl.onerror = () => {
                coverEl.src = getCoverUrl(isbn, 'M');
            };
        } else {
            // Try direct cover URL
            coverEl.src = getCoverUrl(isbn, 'M');
            coverEl.classList.remove('hidden');
            coverEl.onerror = () => {
                coverEl.classList.add('hidden');
            };
        }
    }

    document.querySelector('.scan-container').classList.add('hidden');
    document.getElementById('borrow-form').classList.remove('hidden');
    document.getElementById('return-form').classList.add('hidden');
}

function cancelBorrow() {
    resetScanView();
    startScanner();
}

function initForms() {
    // Borrow form submission
    document.getElementById('checkout-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const borrowerName = document.getElementById('borrower-name').value.trim();
        const whatsapp = document.getElementById('whatsapp').value.trim();
        const dueDate = document.getElementById('due-date').value;

        if (!borrowerName || !whatsapp || !dueDate) {
            showToast("Please fill all fields", "error");
            return;
        }

        await submitBorrow(currentScannedISBN, borrowerName, whatsapp, dueDate);
    });

    // Add book form submission (for manual add)
    const addBookForm = document.getElementById('add-book-form');
    if (addBookForm) {
        addBookForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const isbn = document.getElementById('new-isbn').value.trim();
            const title = document.getElementById('new-title').value.trim();
            const author = document.getElementById('new-author').value.trim();

            await addBook(isbn, title, author);
        });
    }

    // Book search
    const searchInput = document.getElementById('book-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterBooks(e.target.value);
        });
    }

    // ISBN lookup for manual add
    const isbnInput = document.getElementById('new-isbn');
    if (isbnInput) {
        isbnInput.addEventListener('blur', async () => {
            const isbn = isbnInput.value.trim();
            if (isbn.length >= 10) {
                showToast("Looking up book info...", "");
                const bookInfo = await fetchBookFromOpenLibrary(isbn);
                if (bookInfo.found) {
                    document.getElementById('new-title').value = bookInfo.title;
                    document.getElementById('new-author').value = bookInfo.author;
                    showToast("Book info found!", "success");
                }
            }
        });
    }
}

async function submitBorrow(isbn, name, whatsapp, dueDate) {
    try {
        showToast("Processing...", "");

        const borrowDate = new Date().toISOString();

        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'borrow',
                isbn: isbn,
                title: currentBookData?.title || 'Unknown',
                author: currentBookData?.author || 'Unknown',
                borrowerName: name,
                whatsapp: whatsapp,
                borrowDate: borrowDate,
                dueDate: dueDate
            })
        });

        const result = await response.json();

        if (result.success) {
            showToast("Book borrowed successfully!", "success");
            document.getElementById('checkout-form').reset();
            setDefaultDueDate();
            resetScanView();
            setTimeout(startScanner, 1500);
        } else {
            showToast(result.error || "Borrow failed", "error");
        }
    } catch (error) {
        console.error('Borrow error:', error);

        // Demo mode
        if (CONFIG.API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            showToast("Book borrowed! (Demo mode)", "success");
            document.getElementById('checkout-form').reset();
            setDefaultDueDate();
            resetScanView();
            setTimeout(startScanner, 1500);
        } else {
            showToast("Connection error", "error");
        }
    }
}

// ============================================
// RETURN FLOW
// ============================================
function showReturnForm(isbn, bookData) {
    document.getElementById('return-isbn').textContent = isbn;
    document.getElementById('return-title').textContent = bookData.title || 'Unknown';
    document.getElementById('return-borrower').textContent = bookData.currentBorrower || 'Unknown';
    document.getElementById('return-borrow-date').textContent = formatDate(bookData.borrowDate);

    // Show cover image
    const coverEl = document.getElementById('return-cover');
    if (coverEl) {
        coverEl.src = bookData.coverUrl || getCoverUrl(isbn, 'M');
        coverEl.classList.remove('hidden');
        coverEl.onerror = () => coverEl.classList.add('hidden');
    }

    document.querySelector('.scan-container').classList.add('hidden');
    document.getElementById('borrow-form').classList.add('hidden');
    document.getElementById('return-form').classList.remove('hidden');
}

function cancelReturn() {
    resetScanView();
    startScanner();
}

async function confirmReturn() {
    try {
        showToast("Processing return...", "");

        const returnDate = new Date().toISOString();

        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'return',
                isbn: currentScannedISBN,
                returnDate: returnDate
            })
        });

        const result = await response.json();

        if (result.success) {
            showToast("Book returned successfully!", "success");
            resetScanView();
            setTimeout(startScanner, 1500);
        } else {
            showToast(result.error || "Return failed", "error");
        }
    } catch (error) {
        console.error('Return error:', error);

        // Demo mode
        if (CONFIG.API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            showToast("Book returned! (Demo mode)", "success");
            resetScanView();
            setTimeout(startScanner, 1500);
        } else {
            showToast("Connection error", "error");
        }
    }
}

// ============================================
// BOOKS INVENTORY (with covers from Open Library)
// ============================================
async function loadBooks() {
    const container = document.getElementById('books-list');
    container.innerHTML = '<p class="loading">Loading books...</p>';

    try {
        const response = await fetch(`${CONFIG.API_URL}?action=getBooks`);
        const data = await response.json();

        booksCache = data.books || [];

        // Enrich with cover URLs
        booksCache = booksCache.map(book => ({
            ...book,
            coverUrl: getCoverUrl(book.isbn, 'M')
        }));

        renderBooks(booksCache);
    } catch (error) {
        console.error('Error loading books:', error);

        // Demo mode with real book ISBNs
        if (CONFIG.API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            booksCache = [
                { isbn: '9780134685991', title: 'Effective Java', author: 'Joshua Bloch', status: 'Available' },
                { isbn: '9780596517748', title: 'JavaScript: The Good Parts', author: 'Douglas Crockford', status: 'Available' },
                { isbn: '9781491950357', title: 'Building Microservices', author: 'Sam Newman', status: 'Borrowed', currentBorrower: 'John Doe' }
            ].map(book => ({ ...book, coverUrl: getCoverUrl(book.isbn, 'M') }));

            renderBooks(booksCache);
            showToast("Demo mode - showing sample books", "");
        } else {
            container.innerHTML = '<p class="empty-state">Failed to load books. Check connection.</p>';
        }
    }
}

function renderBooks(books) {
    const container = document.getElementById('books-list');

    if (!books || books.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No books in inventory</p><p>Scan a book to add it</p></div>';
        return;
    }

    container.innerHTML = `
        <div class="books-grid">
            ${books.map(book => `
                <div class="book-card ${book.status === 'Borrowed' ? 'borrowed' : ''}">
                    <div class="book-cover">
                        <img src="${book.coverUrl}"
                             alt="${escapeHtml(book.title)}"
                             onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22180%22><rect fill=%22%23ddd%22 width=%22120%22 height=%22180%22/><text x=%2260%22 y=%2290%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2212%22>No Cover</text></svg>'">
                        ${book.status === 'Borrowed' ? '<span class="borrowed-badge">Borrowed</span>' : ''}
                    </div>
                    <div class="book-details">
                        <h3>${escapeHtml(book.title)}</h3>
                        <p class="author">${escapeHtml(book.author)}</p>
                        ${book.status === 'Borrowed' ? `<p class="borrower">By: ${escapeHtml(book.currentBorrower || 'Unknown')}</p>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function filterBooks(query) {
    const filtered = booksCache.filter(book =>
        book.title.toLowerCase().includes(query.toLowerCase()) ||
        book.author.toLowerCase().includes(query.toLowerCase()) ||
        book.isbn.includes(query)
    );
    renderBooks(filtered);
}

async function addBook(isbn, title, author) {
    try {
        showToast("Adding book...", "");

        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'addBook',
                isbn: isbn,
                title: title,
                author: author
            })
        });

        const result = await response.json();

        if (result.success) {
            showToast("Book added!", "success");
            hideAddBookModal();
            document.getElementById('add-book-form').reset();
            loadBooks();
        } else {
            showToast(result.error || "Failed to add book", "error");
        }
    } catch (error) {
        console.error('Add book error:', error);

        // Demo mode
        if (CONFIG.API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            showToast("Book added! (Demo mode)", "success");
            hideAddBookModal();
            document.getElementById('add-book-form').reset();
        } else {
            showToast("Connection error", "error");
        }
    }
}

// ============================================
// OVERDUE BOOKS
// ============================================
async function loadOverdue() {
    const container = document.getElementById('overdue-list');
    container.innerHTML = '<p class="loading">Loading overdue books...</p>';

    try {
        const response = await fetch(`${CONFIG.API_URL}?action=getOverdue`);
        const data = await response.json();

        const overdueWithCovers = (data.overdue || []).map(item => ({
            ...item,
            coverUrl: getCoverUrl(item.isbn, 'S')
        }));

        renderOverdue(overdueWithCovers);
    } catch (error) {
        console.error('Error loading overdue:', error);

        // Demo mode
        if (CONFIG.API_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            const demoOverdue = [
                {
                    isbn: '9780596517748',
                    title: 'JavaScript: The Good Parts',
                    borrowerName: 'Jane Smith',
                    whatsapp: '+1234567890',
                    dueDate: '2025-01-15',
                    daysOverdue: 5,
                    coverUrl: getCoverUrl('9780596517748', 'S')
                }
            ];
            renderOverdue(demoOverdue);
            showToast("Demo mode - showing sample data", "");
        } else {
            container.innerHTML = '<p class="empty-state">Failed to load. Check connection.</p>';
        }
    }
}

function renderOverdue(overdueList) {
    const container = document.getElementById('overdue-list');

    if (!overdueList || overdueList.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No overdue books!</p><p>All books returned on time</p></div>';
        return;
    }

    container.innerHTML = overdueList.map(item => `
        <div class="list-item overdue-item">
            <img class="overdue-cover" src="${item.coverUrl}" alt=""
                 onerror="this.style.display='none'">
            <div class="list-item-info">
                <h3>${escapeHtml(item.title)}</h3>
                <p>Borrower: ${escapeHtml(item.borrowerName)}</p>
                <p>Due: ${formatDate(item.dueDate)}</p>
                <p class="days-overdue">${item.daysOverdue} days overdue</p>
                <button class="whatsapp-btn" onclick="sendReminder('${escapeHtml(item.whatsapp)}', '${escapeHtml(item.title)}', ${item.daysOverdue})">
                    Send WhatsApp Reminder
                </button>
            </div>
        </div>
    `).join('');
}

function sendReminder(whatsapp, bookTitle, daysOverdue) {
    const message = encodeURIComponent(
        `Hi! This is a reminder from WEMBA SF Library. The book "${bookTitle}" is ${daysOverdue} days overdue. Please return it at your earliest convenience. Thank you!`
    );

    // Clean phone number (remove spaces, dashes)
    const cleanNumber = whatsapp.replace(/[\s\-\(\)]/g, '');

    // Open WhatsApp with pre-filled message
    window.open(`https://wa.me/${cleanNumber}?text=${message}`, '_blank');
}

// ============================================
// MODAL FUNCTIONS
// ============================================
function showAddBookModal() {
    document.getElementById('add-book-modal').classList.remove('hidden');
}

function hideAddBookModal() {
    document.getElementById('add-book-modal').classList.add('hidden');
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function resetScanView() {
    document.querySelector('.scan-container').classList.remove('hidden');
    document.getElementById('borrow-form').classList.add('hidden');
    document.getElementById('return-form').classList.add('hidden');

    // Hide cover images
    const covers = document.querySelectorAll('#scanned-cover, #return-cover');
    covers.forEach(c => c.classList.add('hidden'));

    currentScannedISBN = null;
    currentBookData = null;
}

function setDefaultDueDate() {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + CONFIG.DEFAULT_LOAN_DAYS);
    document.getElementById('due-date').value = dueDate.toISOString().split('T')[0];
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast';
    if (type) toast.classList.add(type);
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

// Close modal on outside click
const addBookModal = document.getElementById('add-book-modal');
if (addBookModal) {
    addBookModal.addEventListener('click', (e) => {
        if (e.target.id === 'add-book-modal') {
            hideAddBookModal();
        }
    });
}
