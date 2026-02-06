/**
 * WEMBA SF Library Tracker - Google Apps Script Backend
 *
 * SETUP INSTRUCTIONS:
 * 1. Go to https://script.google.com
 * 2. Create a new project
 * 3. Copy this entire code into Code.gs
 * 4. Click Deploy > New deployment
 * 5. Select "Web app"
 * 6. Set "Execute as" to "Me"
 * 7. Set "Who has access" to "Anyone"
 * 8. Click Deploy and copy the Web App URL
 * 9. Paste the URL into app.js CONFIG.API_URL
 */

// ============================================
// CONFIGURATION
// ============================================
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // Replace with your Google Sheet ID

// Sheet names
const BOOKS_SHEET = 'Books';
const TRANSACTIONS_SHEET = 'Transactions';

// ============================================
// WEB APP ENTRY POINTS
// ============================================

function doGet(e) {
  const action = e.parameter.action;
  let result;

  try {
    switch (action) {
      case 'getBook':
        result = getBook(e.parameter.isbn);
        break;
      case 'getBooks':
        result = getAllBooks();
        break;
      case 'getOverdue':
        result = getOverdueBooks();
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

function doPost(e) {
  let result;

  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    switch (action) {
      case 'borrow':
        result = borrowBook(data);
        break;
      case 'return':
        result = returnBook(data);
        break;
      case 'addBook':
        result = addBook(data);
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

function getBook(isbn) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const booksSheet = ss.getSheetByName(BOOKS_SHEET);
  const data = booksSheet.getDataRange().getValues();

  // Find book by ISBN (column 0)
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === isbn) {
      return {
        isbn: data[i][0],
        title: data[i][1],
        author: data[i][2],
        status: data[i][3],
        currentBorrower: data[i][4],
        borrowDate: data[i][5],
        dueDate: data[i][6]
      };
    }
  }

  return { error: 'Book not found' };
}

function getAllBooks() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const booksSheet = ss.getSheetByName(BOOKS_SHEET);
  const data = booksSheet.getDataRange().getValues();

  const books = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) { // Skip empty rows
      books.push({
        isbn: data[i][0],
        title: data[i][1],
        author: data[i][2],
        status: data[i][3] || 'Available',
        currentBorrower: data[i][4],
        borrowDate: data[i][5],
        dueDate: data[i][6]
      });
    }
  }

  return { books: books };
}

function addBook(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const booksSheet = ss.getSheetByName(BOOKS_SHEET);

  // Check if book already exists
  const existing = getBook(data.isbn);
  if (!existing.error) {
    return { error: 'Book with this ISBN already exists' };
  }

  // Add new book
  booksSheet.appendRow([
    data.isbn,
    data.title,
    data.author,
    'Available',
    '', // currentBorrower
    '', // borrowDate
    ''  // dueDate
  ]);

  return { success: true, message: 'Book added successfully' };
}

// ============================================
// BORROW/RETURN OPERATIONS
// ============================================

function borrowBook(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const booksSheet = ss.getSheetByName(BOOKS_SHEET);
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  const booksData = booksSheet.getDataRange().getValues();

  // Find book row
  let bookRow = -1;
  for (let i = 1; i < booksData.length; i++) {
    if (booksData[i][0] === data.isbn) {
      bookRow = i + 1; // +1 because sheets are 1-indexed
      break;
    }
  }

  if (bookRow === -1) {
    return { error: 'Book not found' };
  }

  // Check if book is available
  if (booksData[bookRow - 1][3] === 'Borrowed') {
    return { error: 'Book is already borrowed' };
  }

  // Update book status
  booksSheet.getRange(bookRow, 4).setValue('Borrowed');
  booksSheet.getRange(bookRow, 5).setValue(data.borrowerName);
  booksSheet.getRange(bookRow, 6).setValue(data.borrowDate);
  booksSheet.getRange(bookRow, 7).setValue(data.dueDate);

  // Log transaction
  transSheet.appendRow([
    data.isbn,
    booksData[bookRow - 1][1], // title
    data.borrowerName,
    data.whatsapp,
    data.borrowDate,
    data.dueDate,
    '', // returnDate (empty for now)
    'Borrowed'
  ]);

  return { success: true, message: 'Book borrowed successfully' };
}

function returnBook(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const booksSheet = ss.getSheetByName(BOOKS_SHEET);
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  const booksData = booksSheet.getDataRange().getValues();
  const transData = transSheet.getDataRange().getValues();

  // Find book row
  let bookRow = -1;
  for (let i = 1; i < booksData.length; i++) {
    if (booksData[i][0] === data.isbn) {
      bookRow = i + 1;
      break;
    }
  }

  if (bookRow === -1) {
    return { error: 'Book not found' };
  }

  // Update book status
  booksSheet.getRange(bookRow, 4).setValue('Available');
  booksSheet.getRange(bookRow, 5).setValue('');
  booksSheet.getRange(bookRow, 6).setValue('');
  booksSheet.getRange(bookRow, 7).setValue('');

  // Update transaction (find the active borrow for this ISBN)
  for (let i = transData.length - 1; i >= 1; i--) {
    if (transData[i][0] === data.isbn && transData[i][7] === 'Borrowed') {
      transSheet.getRange(i + 1, 7).setValue(data.returnDate);
      transSheet.getRange(i + 1, 8).setValue('Returned');
      break;
    }
  }

  return { success: true, message: 'Book returned successfully' };
}

// ============================================
// OVERDUE BOOKS
// ============================================

function getOverdueBooks() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  const data = transSheet.getDataRange().getValues();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdue = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][7] === 'Borrowed' && data[i][5]) {
      const dueDate = new Date(data[i][5]);
      dueDate.setHours(0, 0, 0, 0);

      if (dueDate < today) {
        const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
        overdue.push({
          isbn: data[i][0],
          title: data[i][1],
          borrowerName: data[i][2],
          whatsapp: data[i][3],
          borrowDate: data[i][4],
          dueDate: data[i][5],
          daysOverdue: daysOverdue
        });
      }
    }
  }

  // Sort by days overdue (most overdue first)
  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);

  return { overdue: overdue };
}

// ============================================
// SETUP HELPER
// ============================================

function setupSheets() {
  // Run this function once to create the required sheets
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Create Books sheet if it doesn't exist
  let booksSheet = ss.getSheetByName(BOOKS_SHEET);
  if (!booksSheet) {
    booksSheet = ss.insertSheet(BOOKS_SHEET);
    booksSheet.appendRow(['ISBN', 'Title', 'Author', 'Status', 'Current Borrower', 'Borrow Date', 'Due Date']);
    booksSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
  }

  // Create Transactions sheet if it doesn't exist
  let transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  if (!transSheet) {
    transSheet = ss.insertSheet(TRANSACTIONS_SHEET);
    transSheet.appendRow(['ISBN', 'Title', 'Borrower Name', 'WhatsApp', 'Borrow Date', 'Due Date', 'Return Date', 'Status']);
    transSheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }

  Logger.log('Sheets setup complete!');
}
