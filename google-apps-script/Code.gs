/**
 * WEMBA SF Library Tracker - Google Apps Script Backend
 *
 * SHEETS STRUCTURE:
 * Books: ISBN | Title | Author | Status | Donor | Date Added | Current Borrower | Borrow Date | Due Date
 * Transactions: ISBN | Title | Action | Name | Phone | Date | Notes
 */

const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // Replace with your ID
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
      // Also handle write actions via GET to avoid CORS issues
      case 'addBook':
        result = addBook(e.parameter);
        break;
      case 'borrow':
        result = borrowBook(e.parameter);
        break;
      case 'return':
        result = returnBook(e.parameter);
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

function getBook(isbn) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BOOKS_SHEET);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === isbn) {
      return {
        isbn: data[i][0],
        title: data[i][1],
        author: data[i][2],
        status: data[i][3] || 'Available',
        donor: data[i][4],
        dateAdded: data[i][5],
        currentBorrower: data[i][6],
        borrowDate: data[i][7],
        dueDate: data[i][8]
      };
    }
  }

  return { error: 'Book not found' };
}

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
        donor: data[i][4],
        dateAdded: data[i][5],
        currentBorrower: data[i][6],
        borrowDate: data[i][7],
        dueDate: data[i][8]
      });
    }
  }

  return { books: books };
}

function addBook(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BOOKS_SHEET);
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);

  // Check if book already exists
  const existing = getBook(data.isbn);
  if (!existing.error) {
    return { error: 'Book already exists in library' };
  }

  const now = new Date().toISOString();

  // Add to Books sheet
  // ISBN | Title | Author | Status | Donor | Date Added | Current Borrower | Borrow Date | Due Date
  sheet.appendRow([
    data.isbn,
    data.title,
    data.author,
    'Available',
    data.donor || '',
    data.dateAdded || now,
    '', // Current Borrower
    '', // Borrow Date
    ''  // Due Date
  ]);

  // Log transaction
  // ISBN | Title | Action | Name | Phone | Date | Notes
  transSheet.appendRow([
    data.isbn,
    data.title,
    'Added to Library',
    data.donor || 'Unknown',
    '',
    now,
    data.donor ? 'Donated by ' + data.donor : 'Added to collection'
  ]);

  return { success: true, message: 'Book added to library' };
}

// ============================================
// BORROW / RETURN
// ============================================

function borrowBook(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BOOKS_SHEET);
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  const booksData = sheet.getDataRange().getValues();

  const now = new Date().toISOString();

  // Find book row
  let bookRow = -1;
  for (let i = 1; i < booksData.length; i++) {
    if (booksData[i][0] === data.isbn) {
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
      '',
      now,
      data.borrowerName,
      data.borrowDate || now,
      data.dueDate
    ]);

    transSheet.appendRow([
      data.isbn,
      data.title || 'Unknown',
      'Checked Out',
      data.borrowerName,
      data.whatsapp,
      now,
      'Due: ' + data.dueDate
    ]);

    return { success: true, message: 'Book added and checked out' };
  }

  // Check if available
  if (booksData[bookRow - 1][3] === 'Borrowed') {
    return { error: 'Book is already checked out' };
  }

  // Update book status
  sheet.getRange(bookRow, 4).setValue('Borrowed');      // Status
  sheet.getRange(bookRow, 7).setValue(data.borrowerName); // Current Borrower
  sheet.getRange(bookRow, 8).setValue(data.borrowDate || now); // Borrow Date
  sheet.getRange(bookRow, 9).setValue(data.dueDate);    // Due Date

  // Log transaction
  transSheet.appendRow([
    data.isbn,
    booksData[bookRow - 1][1], // Title
    'Checked Out',
    data.borrowerName,
    data.whatsapp,
    now,
    'Due: ' + data.dueDate
  ]);

  return { success: true, message: 'Book checked out successfully' };
}

function returnBook(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(BOOKS_SHEET);
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  const booksData = sheet.getDataRange().getValues();

  const now = new Date().toISOString();

  // Find book row
  let bookRow = -1;
  let bookTitle = '';
  let borrowerName = '';

  for (let i = 1; i < booksData.length; i++) {
    if (booksData[i][0] === data.isbn) {
      bookRow = i + 1;
      bookTitle = booksData[i][1];
      borrowerName = booksData[i][6];
      break;
    }
  }

  if (bookRow === -1) {
    return { error: 'Book not found in library' };
  }

  // Update book status - clear borrower info
  sheet.getRange(bookRow, 4).setValue('Available');  // Status
  sheet.getRange(bookRow, 7).setValue('');           // Current Borrower
  sheet.getRange(bookRow, 8).setValue('');           // Borrow Date
  sheet.getRange(bookRow, 9).setValue('');           // Due Date

  // Log transaction
  transSheet.appendRow([
    data.isbn,
    bookTitle,
    'Returned',
    borrowerName || 'Unknown',
    '',
    now,
    'Returned on ' + new Date().toLocaleDateString()
  ]);

  return { success: true, message: 'Book returned successfully' };
}

// ============================================
// OVERDUE
// ============================================

function getOverdueBooks() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  const booksSheet = ss.getSheetByName(BOOKS_SHEET);
  const booksData = booksSheet.getDataRange().getValues();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const overdue = [];

  for (let i = 1; i < booksData.length; i++) {
    if (booksData[i][3] === 'Borrowed' && booksData[i][8]) {
      const dueDate = new Date(booksData[i][8]);
      dueDate.setHours(0, 0, 0, 0);

      if (dueDate < today) {
        const daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
        overdue.push({
          isbn: booksData[i][0],
          title: booksData[i][1],
          borrowerName: booksData[i][6],
          whatsapp: '', // Need to get from transactions
          dueDate: booksData[i][8],
          daysOverdue: daysOverdue
        });
      }
    }
  }

  // Get phone numbers from transactions
  const transData = transSheet.getDataRange().getValues();
  for (let o of overdue) {
    for (let i = transData.length - 1; i >= 1; i--) {
      if (transData[i][0] === o.isbn && transData[i][2] === 'Checked Out') {
        o.whatsapp = transData[i][4];
        break;
      }
    }
  }

  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);

  return { overdue: overdue };
}

// ============================================
// SETUP - Run once
// ============================================

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Books sheet
  let booksSheet = ss.getSheetByName(BOOKS_SHEET);
  if (!booksSheet) {
    booksSheet = ss.insertSheet(BOOKS_SHEET);
    booksSheet.appendRow([
      'ISBN', 'Title', 'Author', 'Status', 'Donor',
      'Date Added', 'Current Borrower', 'Borrow Date', 'Due Date'
    ]);
    booksSheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    booksSheet.setFrozenRows(1);
  }

  // Transactions sheet
  let transSheet = ss.getSheetByName(TRANSACTIONS_SHEET);
  if (!transSheet) {
    transSheet = ss.insertSheet(TRANSACTIONS_SHEET);
    transSheet.appendRow([
      'ISBN', 'Title', 'Action', 'Name', 'Phone', 'Date', 'Notes'
    ]);
    transSheet.getRange(1, 1, 1, 7).setFontWeight('bold');
    transSheet.setFrozenRows(1);
  }

  Logger.log('Sheets setup complete!');
}
