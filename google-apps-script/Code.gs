/**
 * WEMBA SF Library Tracker - Google Apps Script Backend
 *
 * SHEETS STRUCTURE:
 * Books: ISBN | Title | Author | Status | Current Borrower | Borrow Date
 * Transactions: ISBN | Title | Action | Name | Phone | Date
 */

const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // Replace with your ID
const BOOKS_SHEET = 'Books';
const TRANSACTIONS_SHEET = 'Transactions';

// ============================================
// WEB APP ENTRY POINTS
// ============================================

function doGet(e) {
  if (!e || !e.parameter) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'No parameters provided' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const params = e.parameter;
  const action = params.action;
  let result;

  try {
    switch (action) {
      case 'getBook':
        result = getBook(params.isbn);
        break;
      case 'getBooks':
        result = getAllBooks();
        break;
      case 'getOverdue':
        result = getOverdueBooks();
        break;
      case 'addBook':
        result = addBook(params);
        break;
      case 'borrow':
        result = borrowBook(params);
        break;
      case 'return':
        result = returnBook(params);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (error) {
    result = { error: error.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;

  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    switch (action) {
      case 'addBook':
        result = addBook(data);
        break;
      case 'borrow':
        result = borrowBook(data);
        break;
      case 'return':
        result = returnBook(data);
        break;
      default:
        result = { error: 'Unknown action' };
    }
  } catch (error) {
    result = { error: error.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================
// BOOK OPERATIONS
// ============================================

// Get single book by ISBN
function getBook(isbn) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BOOKS_SHEET);
  const data = sheet.getDataRange().getValues();

  // Columns: ISBN | Title | Author | Status | Current Borrower | Borrow Date
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(isbn)) {
      return {
        isbn: data[i][0],
        title: data[i][1],
        author: data[i][2],
        status: data[i][3] || 'Available',
        currentBorrower: data[i][4] || '',
        borrowDate: data[i][5] || ''
      };
    }
  }

  return { error: 'Book not found' };
}

// Get all books
function getAllBooks() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BOOKS_SHEET);
  const data = sheet.getDataRange().getValues();

  const books = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      books.push({
        isbn: data[i][0],
        title: data[i][1],
        author: data[i][2],
        status: data[i][3] || 'Available',
        currentBorrower: data[i][4] || '',
        borrowDate: data[i][5] || ''
      });
    }
  }

  return { books: books };
}

// Add new book to library
function addBook(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BOOKS_SHEET);
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);

  // Check if book already exists
  const existing = getBook(data.isbn);
  if (!existing.error) {
    return { error: 'Book already exists in library' };
  }

  const now = new Date().toLocaleDateString();

  // Add to Books sheet
  // ISBN | Title | Author | Status | Current Borrower | Borrow Date
  sheet.appendRow([
    data.isbn,
    data.title,
    data.author,
    'Available',
    '',  // Current Borrower
    ''   // Borrow Date
  ]);

  // Log transaction
  transSheet.appendRow([
    data.isbn,
    data.title,
    'Added to Library',
    '',
    '',
    now
  ]);

  return { success: true, message: 'Book added to library' };
}

// ============================================
// BORROW / RETURN
// ============================================

// Borrow a book
function borrowBook(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BOOKS_SHEET);
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  const booksData = sheet.getDataRange().getValues();

  const now = new Date().toLocaleDateString();

  // Find book row
  let bookRow = -1;
  for (let i = 1; i < booksData.length; i++) {
    if (String(booksData[i][0]) === String(data.isbn)) {
      bookRow = i + 1;
      break;
    }
  }

  // If book not found, add it first
  if (bookRow === -1) {
    sheet.appendRow([
      data.isbn,
      data.title || 'Unknown',
      data.author || 'Unknown',
      'Borrowed',
      data.borrowerName,
      now
    ]);

    transSheet.appendRow([
      data.isbn,
      data.title || 'Unknown',
      'Borrowed',
      data.borrowerName,
      data.whatsapp || '',
      now
    ]);

    return { success: true, message: 'Book added and borrowed' };
  }

  // Check if available
  if (booksData[bookRow - 1][3] === 'Borrowed') {
    return { error: 'Book is already borrowed by ' + booksData[bookRow - 1][4] };
  }

  // Update book status
  sheet.getRange(bookRow, 4).setValue('Borrowed');        // Status
  sheet.getRange(bookRow, 5).setValue(data.borrowerName); // Current Borrower
  sheet.getRange(bookRow, 6).setValue(now);               // Borrow Date

  // Log transaction
  transSheet.appendRow([
    data.isbn,
    booksData[bookRow - 1][1], // Title
    'Borrowed',
    data.borrowerName,
    data.whatsapp || '',
    now
  ]);

  return { success: true, message: 'Book borrowed successfully' };
}

// Return a book
function returnBook(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BOOKS_SHEET);
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  const booksData = sheet.getDataRange().getValues();

  const now = new Date().toLocaleDateString();

  // Find book row
  let bookRow = -1;
  let bookTitle = '';
  let borrowerName = '';

  for (let i = 1; i < booksData.length; i++) {
    if (String(booksData[i][0]) === String(data.isbn)) {
      bookRow = i + 1;
      bookTitle = booksData[i][1];
      borrowerName = booksData[i][4];
      break;
    }
  }

  if (bookRow === -1) {
    return { error: 'Book not found in library' };
  }

  // Update book status - clear borrower info
  sheet.getRange(bookRow, 4).setValue('Available');  // Status
  sheet.getRange(bookRow, 5).setValue('');           // Current Borrower
  sheet.getRange(bookRow, 6).setValue('');           // Borrow Date

  // Log transaction with return date
  transSheet.appendRow([
    data.isbn,
    bookTitle,
    'Returned',
    borrowerName || 'Unknown',
    '',
    now  // Return Date
  ]);

  return { success: true, message: 'Book returned successfully' };
}

// ============================================
// OVERDUE - Get borrowed books
// ============================================

function getOverdueBooks() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const booksSheet = ss.getSheetByName(BOOKS_SHEET);
  const booksData = booksSheet.getDataRange().getValues();
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  const transData = transSheet.getDataRange().getValues();

  const borrowed = [];

  for (let i = 1; i < booksData.length; i++) {
    if (booksData[i][3] === 'Borrowed') {
      const isbn = booksData[i][0];

      // Find phone number from transactions
      let whatsapp = '';
      for (let j = transData.length - 1; j >= 1; j--) {
        if (String(transData[j][0]) === String(isbn) && transData[j][2] === 'Borrowed') {
          whatsapp = transData[j][4];
          break;
        }
      }

      borrowed.push({
        isbn: isbn,
        title: booksData[i][1],
        borrowerName: booksData[i][4],
        borrowDate: booksData[i][5],
        whatsapp: whatsapp
      });
    }
  }

  return { overdue: borrowed };
}

// ============================================
// SETUP - Run once to create sheets
// ============================================

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Books sheet
  let booksSheet = ss.getSheetByName(BOOKS_SHEET);
  if (!booksSheet) {
    booksSheet = ss.insertSheet(BOOKS_SHEET);
  }
  // Set headers
  booksSheet.getRange(1, 1, 1, 6).setValues([[
    'ISBN', 'Title', 'Author', 'Status', 'Current Borrower', 'Borrow Date'
  ]]);
  booksSheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  booksSheet.setFrozenRows(1);

  // Transactions sheet
  let transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  if (!transSheet) {
    transSheet = ss.insertSheet(TRANSACTIONS_SHEET);
  }
  // Set headers
  transSheet.getRange(1, 1, 1, 6).setValues([[
    'ISBN', 'Title', 'Action', 'Name', 'Phone', 'Date'
  ]]);
  transSheet.getRange(1, 1, 1, 6).setFontWeight('bold');
  transSheet.setFrozenRows(1);

  Logger.log('Sheets setup complete!');
}
