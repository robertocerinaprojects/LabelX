/**************************************************
* CONFIG: concurrency timeout in minutes
* (Feel free to change this default)
**************************************************/
const CLAIM_TIMEOUT_MIN = 10;

/**************************************************
* Utility function to ensure a column exists.
* If it doesn't, create it at the end of the sheet.
* Returns the 1-based column index.
**************************************************/
function ensureColumn(sheet, headerRow, colName) {
  let idx = headerRow.indexOf(colName) + 1;
  if (idx > 0) {
    return idx;
  } else {
    let lastCol = sheet.getLastColumn();
    sheet.getRange(1, lastCol + 1).setValue(colName);
    return lastCol + 1;
  }
}

/**************************************************
* doGet(e):
*   - If ?phase=features => show "SelectFeatures.html"
*   - Else if ?phase=label => show labeling page
*   - Default => showFeatureSelectionPage
**************************************************/
function doGet(e) {
  const phase = e.parameter.phase || "";
  if (phase === "label") {
    return showLabelingPage(e);
  } else {
    // default or phase=features
    return showFeatureSelectionPage();
  }
}

/**************************************************
* showFeatureSelectionPage():
*   Renders the page to pick which features to label
*   Also calculates how many rows are labeled/left
*   using a single batch read of the "Notes" column
**************************************************/
function showFeatureSelectionPage() {
  const template = HtmlService.createTemplateFromFile("SelectFeatures");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("LabelX");
  if (!sheet) {
    return HtmlService.createHtmlOutput("Sheet 'LabelX' not found.");
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    // No data rows
    template.labeledCount = 0;
    template.totalCount = 0;
    return template.evaluate().setTitle("Select Features");
  }

  // Identify the "Notes" column index
  const headerRow = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const colNotes = headerRow.indexOf("Notes") + 1;
  if (colNotes < 1) {
    // If no "Notes" column at all
    template.labeledCount = 0;
    template.totalCount = lastRow - 1;
    return template.evaluate().setTitle("Select Features");
  }

  // Batch-read the "Notes" column (rows 2..lastRow)
  const notesValues = sheet
    .getRange(2, colNotes, lastRow - 1, 1)
    .getValues(); // 2D array

  let labeledCount = 0;
  for (let i = 0; i < notesValues.length; i++) {
    // each row is [notesVal]
    if (notesValues[i][0]) labeledCount++;
  }

  template.labeledCount = labeledCount;
  template.totalCount = lastRow - 1; // minus the header

  return template.evaluate().setTitle("Select Features");
}

/**************************************************
* showLabelingPage(e):
*   - Acquire a lock
*   - Identify concurrency columns
*   - Find an unlabeled, unclaimed (or expired) row
*   - Claim it, store concurrency info
*   - Display the row’s data in the labeling UI
**************************************************/
function showLabelingPage(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("LabelX");
  if (!sheet) {
    return HtmlService.createHtmlOutput("Sheet 'LabelX' not found.");
  }

  // The user’s chosen features come as a comma-separated list
  const featureCodes = (e.parameter.features || "").split(",").filter(x=>x.trim().length>0);

  // Acquire lock
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  let rowToLabel = -1;
  try {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return centeredPage(`<h1>No data rows found.</h1>`);
    }

    // Identify concurrency columns
    const headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const colNotes     = headerRow.indexOf("Notes") + 1;
    const colClaimedBy = headerRow.indexOf("claimed_by") + 1;
    const colClaimedAt = headerRow.indexOf("claimed_at") + 1;

    // If any concurrency column is missing, we can't proceed
    if (colNotes < 1 || colClaimedBy < 1 || colClaimedAt < 1) {
      return centeredPage(`
        <h2>Missing concurrency columns</h2>
        <p>Please ensure "Notes", "claimed_by", and "claimed_at" columns exist.</p>
      `);
    }

    // Batch-read concurrency columns
    const minCol = Math.min(colNotes, colClaimedBy, colClaimedAt);
    const maxCol = Math.max(colNotes, colClaimedBy, colClaimedAt);
    const numCols = maxCol - minCol + 1;

    const concurrencyData = sheet
      .getRange(2, minCol, lastRow - 1, numCols)
      .getValues();  // 2D array

    const notesOffset     = colNotes     - minCol;
    const claimedByOffset = colClaimedBy - minCol;
    const claimedAtOffset = colClaimedAt - minCol;

    // Determine which rows are unlabeled & unclaimed (or expired)
    const now = Date.now();
    const timeoutMs = CLAIM_TIMEOUT_MIN * 60 * 1000;
    const candidateRows = [];

    for (let i = 0; i < concurrencyData.length; i++) {
      const rowData = concurrencyData[i];
      const notesVal = rowData[notesOffset];
      if (notesVal) continue; // already labeled

      const cBy = rowData[claimedByOffset];
      const cAt = rowData[claimedAtOffset];

      let isExpired = false;
      if (cBy) {
        const cAtMs = parseInt(cAt, 10);
        if (isNaN(cAtMs) || (now - cAtMs > timeoutMs)) {
          isExpired = true;
        }
      }
      if (!cBy || isExpired) {
        candidateRows.push(i + 2); // row numbering offset
      }
    }

    if (candidateRows.length === 0) {
      return centeredPage(`
        <h1>All done!</h1>
        <p>No unlabeled rows remain.</p>
      `);
    }

    // Randomize & pick the first
    shuffleArray(candidateRows);
    rowToLabel = candidateRows[0];

    // Claim the row
    let userEmail = "AnonymousUser";
    const currUser = Session.getActiveUser();
    if (currUser && currUser.getEmail()) {
      userEmail = currUser.getEmail();
    }
    sheet.getRange(rowToLabel, colClaimedBy).setValue(userEmail);
    sheet.getRange(rowToLabel, colClaimedAt).setValue(Date.now());

    // Ensure columns for start_time, completed_by, end_time
    const colStartTime    = ensureColumn(sheet, headerRow, "start_time");
    const colCompletedBy  = ensureColumn(sheet, headerRow, "completed_by");
    const colEndTime      = ensureColumn(sheet, headerRow, "end_time");

    // record start_time
    sheet.getRange(rowToLabel, colStartTime).setValue(new Date());

    // Now read the entire row
    const rowData = sheet
      .getRange(rowToLabel, 1, 1, sheet.getLastColumn())
      .getValues()[0];

    // Helper to get 1-based column index
    function colIndex(name) {
      return headerRow.indexOf(name) + 1;
    }

    const colProfile  = colIndex("profile_image_url");
    const colName     = colIndex("name");
    const colUsername = colIndex("username");
    const colLocation = colIndex("location");
    const colDesc     = colIndex("description");

    const rawProfileUrl = (colProfile > 0)  ? (rowData[colProfile - 1]  || "") : "";
    const nameVal       = (colName > 0)     ? (rowData[colName - 1]     || "") : "";
    const usernameVal   = (colUsername > 0) ? (rowData[colUsername - 1] || "") : "";
    const locationVal   = (colLocation > 0) ? (rowData[colLocation - 1] || "") : "";
    const descVal       = (colDesc > 0)     ? (rowData[colDesc - 1]     || "") : "";

    // Gather tweets by scanning for created_at.tweet_X & text.tweet_X
    const tweets = [];
    for (let i = 1; i <= 120; i++) {
      const catName = `created_at.tweet_${i}`;
      const txtName = `text.tweet_${i}`;
      const catCol  = headerRow.indexOf(catName) + 1;
      const txtCol  = headerRow.indexOf(txtName) + 1;

      if (catCol < 1 || txtCol < 1) continue;

      const catVal = rowData[catCol - 1];
      const txtVal = rowData[txtCol - 1];
      if (txtVal) {
        tweets.push({
          createdAt: catVal || "",
          text: txtVal
        });
      }
    }
    // Reverse so newest tweets come first
    tweets.reverse();

    // Count how many labeled overall
    let labeledCount = 0;
    {
      const notesRange = sheet.getRange(2, colNotes, lastRow - 1, 1).getValues();
      for (let i = 0; i < notesRange.length; i++) {
        if (notesRange[i][0]) labeledCount++;
      }
    }
    const totalCount = lastRow - 1;

    // Create the template
    const template = HtmlService.createTemplateFromFile("Index");
    template.rowNumber     = rowToLabel;
    template.profileImg    = rawProfileUrl;
    template.featureCodes  = featureCodes;
    template.colFeatureAns = ensureColumn(sheet, headerRow, "FeatureAnswers");
    template.name          = nameVal;
    template.username      = usernameVal;
    template.location      = locationVal;
    template.desc          = descVal;
    template.tweets        = tweets;
    template.labeledCount  = labeledCount;
    template.totalCount    = totalCount;

    return template.evaluate().setTitle("Label This User");

  } finally {
    lock.releaseLock();
  }
}

/**************************************************
* doPost(e):
*  - action=selectFeatures => user picks which features
*  - action=saveLabels => user submits labeling
**************************************************/
function doPost(e) {
  const action = e.parameter.action || "";

  if (action === "selectFeatures") {
    // user picked features
    const chosen = e.parameter.chosenFeatures || "";
    const featuresArr = chosen.split(",").filter(x=>x.trim().length>0);
    let bulletList = "<ul>";
    featuresArr.forEach(feat => {
      bulletList += "<li>" + feat + "</li>";
    });
    bulletList += "</ul>";

    // redirect link
    const nextUrl = ScriptApp.getService().getUrl()
      + "?phase=label&features=" + encodeURIComponent(chosen);

    return centeredPage(`
      <h2>Features selected</h2>
      ${bulletList}
      <p><a href="${nextUrl}" target="_top">Start labeling</a></p>
    `);

  } else if (action === "saveLabels") {
    // user finishing labeling a row
    const rowNumber = parseInt(e.parameter.rowNumber, 10);
    const notesVal  = e.parameter.notesInput || ""; // "Notes"

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName("LabelX");
    if (!sheet) {
      return HtmlService.createHtmlOutput("Sheet 'LabelX' not found in doPost (saveLabels).");
    }

    const headerRow = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
    function colIndex(n) { return headerRow.indexOf(n) + 1; }

    const colNotes     = colIndex("Notes");
    const colClaimedBy = colIndex("claimed_by");
    const colClaimedAt = colIndex("claimed_at");

    let colFeatureAns  = colIndex("FeatureAnswers");
    if (colFeatureAns < 1) {
      colFeatureAns = ensureColumn(sheet, headerRow, "FeatureAnswers");
    }
    let colStartTime   = colIndex("start_time");
    if (colStartTime < 1) {
      colStartTime = ensureColumn(sheet, headerRow, "start_time");
    }
    let colCompletedBy = colIndex("completed_by");
    if (colCompletedBy < 1) {
      colCompletedBy = ensureColumn(sheet, headerRow, "completed_by");
    }
    let colEndTime     = colIndex("end_time");
    if (colEndTime < 1) {
      colEndTime = ensureColumn(sheet, headerRow, "end_time");
    }

    // Store the notes
    if (rowNumber > 1 && colNotes > 0) {
      sheet.getRange(rowNumber, colNotes).setValue(notesVal);
    }

    // Store who completed
    let userEmail = "AnonymousUser";
    const currUser = Session.getActiveUser();
    if (currUser && currUser.getEmail()) {
      userEmail = currUser.getEmail();
    }
    if (rowNumber > 1 && colCompletedBy > 0) {
      sheet.getRange(rowNumber, colCompletedBy).setValue(userEmail);
    }
    if (rowNumber > 1 && colEndTime > 0) {
      sheet.getRange(rowNumber, colEndTime).setValue(new Date());
    }

    // Clear concurrency
    if (rowNumber > 1 && colClaimedBy>0 && colClaimedAt>0) {
      sheet.getRange(rowNumber, colClaimedBy).clearContent();
      sheet.getRange(rowNumber, colClaimedAt).clearContent();
    }

    // Gather feature answers
    const featureCodes = (e.parameter.featureCodes || "").split(",").filter(x=>x.trim().length>0);
    const answersObj = {};
    featureCodes.forEach(fc => {
      // If "STATE", might be a dropdown
      if (fc === "STATE") {
        answersObj[fc] = e.parameter["feat_STATE"] || "";
        return;
      }
      // Normal enumeration
      const ans = e.parameter["feat_" + fc] || "";
      answersObj[fc] = ans;

      // speculation
      const specAns = e.parameter["feat_" + fc + "_speculation"] || "";
      answersObj[fc + "_SPECULATION"] = specAns;
    });

    // store as JSON
    const ansJSON = JSON.stringify(answersObj);
    sheet.getRange(rowNumber, colFeatureAns).setValue(ansJSON);

    // link to next
    const keepFeatures = e.parameter.featureCodes || "";
    const nextUrl = ScriptApp.getService().getUrl()
      + "?phase=label&features=" + encodeURIComponent(keepFeatures);

    let bulletPoints = "<ul>";
    Object.keys(answersObj).forEach(k => {
      bulletPoints += `<li><strong>${k}:</strong> ${answersObj[k]}</li>`;
    });
    bulletPoints += "</ul>";

    return centeredPage(`
      <h2>Label saved</h2>
      <p><strong>Notes:</strong> ${notesVal}</p>
      <p>Feature answers: ${bulletPoints}</p>
      <p><a href="${nextUrl}" target="_top">Label Next Profile</a></p>
    `);
  }

  // fallback
  return HtmlService.createHtmlOutput("Unknown doPost action.");
}

/**************************************************
* shuffleArray(arr):
*   Utility to shuffle elements in-place
**************************************************/
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**************************************************
* centeredPage(innerHtml):
*   Utility to produce a page with centered styling
**************************************************/
function centeredPage(innerHtml) {
  const page = `
    <!DOCTYPE html>
    <html>
      <head>
        <base target="_top">
        <style>
          body {
            font-family: 'Open Sans', sans-serif;
            background-color: #f0f2f5;
            margin: 0; padding: 0;
            display: flex;
            height: 100vh;
            align-items: center;
            justify-content: center;
          }
          .center-box {
            background: #fff;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            max-width: 600px;
            text-align: center;
          }
          .center-box ul {
            text-align: left;
            margin: 0 auto 1em;
            list-style-position: outside;
          }
          a {
            color: #3498db;
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <div class="center-box">
          ${innerHtml}
        </div>
      </body>
    </html>
  `;
  return HtmlService.createHtmlOutput(page);
}
